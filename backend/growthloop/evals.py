"""Evals, three layers:
1. Agent quality: an LLM judge grades each agent's output in a cycle against that role's rubric.
2. Work product: deterministic checks (policy patterns, spec completeness, build/QA results from the executor).
3. Outcomes: Skeptic calibration (Brier score) and idea-source win rates, computed from experiment results.
"""
from __future__ import annotations

import json
import time

from .db import Store
from .guardrails import deterministic_policy_issues
from .llm import Router
from .roles import ROLE_BY_KEY
from .schemas import Judgement


def record(store: Store, *, cycle_id: str | None, agent: str, suite: str, target_type: str, target_id: str,
           rubric: str, score: float, passed: bool, reasoning: str, judge_model: str = "") -> None:
    store.insert("evals", ts=time.time(), cycle_id=cycle_id, agent=agent, suite=suite, target_type=target_type,
                 target_id=target_id, rubric=rubric, score=round(float(score), 4), passed=int(passed),
                 reasoning=reasoning[:3000], judge_model=judge_model)


def judge_output(store: Store, router: Router, *, cycle_id: str, agent: str, output: dict, task: str) -> None:
    role = ROLE_BY_KEY[agent]
    if not role.rubric:
        return
    rubric = "\n".join(f"- {r}" for r in role.rubric)
    system = ("You are a strict evaluator of AI agents inside a growth team. Grade the output against the rubric. "
              "score is 0..1 (1 = every criterion fully met). passed = score >= 0.7.")
    user = (f"Agent: {role.title}\nTask it was given: {task}\n\nRubric:\n{rubric}\n\n"
            f"Output:\n{json.dumps(output, ensure_ascii=False)[:12000]}")
    res = router.structured(role="judge", model_class="fast", system=system, user=user, schema=Judgement,
                            cycle_id=cycle_id, node="evals")
    j: Judgement = res.data
    record(store, cycle_id=cycle_id, agent=agent, suite="agent_quality", target_type="cycle_output",
           target_id=cycle_id, rubric=rubric, score=j.score, passed=j.passed, reasoning=j.reasoning,
           judge_model=res.model)


def check_spec(store: Store, cycle_id: str, experiment_id: str, spec: dict) -> None:
    missing = [k for k in ("changes", "acceptance_criteria", "instrumentation") if not spec.get(k)]
    score = 1 - len(missing) / 3
    record(store, cycle_id=cycle_id, agent="pm", suite="work_product", target_type="spec", target_id=experiment_id,
           rubric="spec has changes, acceptance criteria and instrumentation", score=score, passed=not missing,
           reasoning=f"missing: {missing}" if missing else "complete")


def check_draft(store: Store, cycle_id: str, approval_id: str, text: str) -> list[str]:
    issues = deterministic_policy_issues(text)
    record(store, cycle_id=cycle_id, agent="marketing", suite="work_product", target_type="draft",
           target_id=approval_id, rubric="no banned patterns (deception, spam, automation)",
           score=0.0 if issues else 1.0, passed=not issues, reasoning=", ".join(issues) or "clean")
    return issues


def record_calibration(store: Store, cycle_id: str, experiment: dict, won: bool) -> None:
    p = experiment.get("confidence")
    if p is None:
        return
    brier = (float(p) - (1.0 if won else 0.0)) ** 2
    record(store, cycle_id=cycle_id, agent="skeptic", suite="calibration", target_type="experiment",
           target_id=experiment["id"], rubric="Brier score of predicted probability of success (lower is better)",
           score=1 - brier, passed=brier < 0.25,
           reasoning=f"predicted p={p:.2f}, outcome={'won' if won else 'not won'}, brier={brier:.3f}")


def summary(store: Store) -> dict:
    per_agent = store.query(
        "SELECT agent, suite, COUNT(*) n, AVG(score) avg, SUM(passed) passed FROM evals GROUP BY agent, suite "
        "ORDER BY agent")
    trend = store.query(
        "SELECT cycle_id, agent, AVG(score) avg, MIN(ts) ts FROM evals WHERE suite='agent_quality' "
        "GROUP BY cycle_id, agent ORDER BY ts")
    calib = store.query("SELECT target_id, score, reasoning, ts FROM evals WHERE suite='calibration' ORDER BY ts")
    sources = store.query(
        "SELECT i.source_agent AS agent, COUNT(*) total, "
        "SUM(CASE WHEN e.status='won' THEN 1 ELSE 0 END) won, "
        "SUM(CASE WHEN e.status IN ('won','lost','inconclusive') THEN 1 ELSE 0 END) finished "
        "FROM experiments e JOIN ideas i ON i.id = e.idea_id GROUP BY i.source_agent")
    return {"per_agent": per_agent, "trend": trend, "calibration": calib, "idea_sources": sources}
