"""Developer + QA executor. Two modes (Settings → dev_executor):

- spec_only (default): the PM spec lands in the inbox as a build task; nothing touches the product repo.
- claude_code: Claude Code runs headless in an isolated git worktree of the product repo, then QA runs the
  product's build commands, protected paths are checked, and a PR is opened. A T1 PR is merged only when the
  autonomy policy for T1 is "auto" and QA passed; everything else waits for the owner.
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

from .config import ROOT, WORKTREES_DIR
from .db import Store
from .guardrails import policy_for, protected_path_hit


def _run(cmd: list[str] | str, cwd: Path, timeout: int = 1800) -> tuple[int, str]:
    p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, shell=isinstance(cmd, str))
    return p.returncode, (p.stdout + p.stderr)[-6000:]


def build_prompt(product: dict, exp: dict) -> str:
    spec = json.dumps(exp.get("spec") or {}, indent=2, ensure_ascii=False)
    return (
        f"You are a developer on {product['name']}. Implement this experiment spec with the smallest clean change.\n"
        f"Do not touch these protected paths: {product.get('protected_paths', [])}.\n"
        "Do not add tracking of personal data. Keep the existing style. Add or update tests where the project has them.\n"
        f"Hypothesis: {exp.get('hypothesis')}\n\nSpec (JSON):\n{spec}\n"
    )


def execute(store: Store, product: dict, exp: dict, cycle_id: str) -> dict:
    mode = store.get_setting("dev_executor", "spec_only")
    if mode != "claude_code":
        return {"status": "ready_to_build", "detail": "spec_only mode: build task sent to the inbox"}
    repo = (ROOT / product.get("local_path", "")).resolve()
    if not (repo / ".git").exists():
        return {"status": "blocked", "detail": f"product repo not found at {repo}"}
    if not shutil.which("claude"):
        return {"status": "blocked", "detail": "claude CLI not installed"}
    branch = f"growthloop/{exp['id']}"
    wt = WORKTREES_DIR / exp["id"]
    WORKTREES_DIR.mkdir(parents=True, exist_ok=True)
    code, out = _run(["git", "worktree", "add", "-B", branch, str(wt), "HEAD"], repo)
    if code:
        return {"status": "blocked", "detail": f"worktree failed: {out}"}
    store.event(cycle_id, "developer", "tool", f"claude code started in {wt}", node="build")
    code, out = _run(["claude", "-p", build_prompt(product, exp), "--permission-mode", "acceptEdits",
                      "--allowedTools", "Read,Edit,Write,Glob,Grep,Bash(npm run *),Bash(npm ci)"], wt, timeout=3600)
    store.event(cycle_id, "developer", "tool", out[-3000:], node="build", data={"exit": code})
    _, changed = _run(["git", "status", "--porcelain"], wt)
    paths = [line[3:] for line in changed.splitlines() if line.strip()]
    if not paths:
        return {"status": "blocked", "detail": "developer produced no changes"}
    hits = protected_path_hit(paths, product.get("protected_paths", []))
    if hits:
        store.guardrail(cycle_id, "developer", "protected_paths", "blocked", f"touched {hits}")
        return {"status": "blocked", "detail": f"protected paths touched: {hits}"}
    # QA: product build commands
    workdir = wt / product.get("build", {}).get("workdir", ".")
    for cmd in product.get("build", {}).get("commands", []):
        code, out = _run(cmd, workdir)
        store.event(cycle_id, "qa", "tool", f"$ {cmd} -> exit {code}\n{out[-1500:]}", node="qa")
        if code:
            return {"status": "qa_failed", "detail": f"`{cmd}` failed"}
    _run(["git", "add", "-A"], wt)
    _run(["git", "commit", "-m", f"GrowthLoop experiment: {exp['title']}\n\n{exp.get('hypothesis', '')}"], wt)
    code, out = _run(["git", "push", "-u", "origin", branch], wt)
    if code:
        return {"status": "blocked", "detail": f"push failed: {out[-500:]}"}
    code, out = _run(["gh", "pr", "create", "--fill", "--head", branch], wt)
    pr_url = out.strip().splitlines()[-1] if code == 0 else ""
    if exp.get("tier") == "T1" and policy_for(store, "T1") == "auto" and pr_url:
        _run(["gh", "pr", "merge", pr_url, "--squash", "--delete-branch"], wt)
        return {"status": "live", "pr_url": pr_url, "detail": "T1 auto-merged after QA"}
    return {"status": "awaiting_merge", "pr_url": pr_url, "detail": "PR opened; waiting for owner"}
