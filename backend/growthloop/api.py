"""HTTP API for Mission Control. Run: uvicorn growthloop.api:app --reload --port 8600"""
from __future__ import annotations

import asyncio
import json
import os
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from . import evals
from .adapters import list_products, load_product, metrics_adapter, metrics_snapshot, today
from .config import DEFAULT_SETTINGS, ROOT
from .db import Store, new_id
from .guardrails import BANNED_PATTERNS, HARD_FLOORS, TIER_INFO
from .llm import PRICES, TIERS, provider_status
from .roles import ROLES, active_roles
from .runner import Runner
from .tools import web_search_available

store = Store()
runner = Runner(store)


@asynccontextmanager
async def lifespan(_: FastAPI):
    if store.get_setting("loop_running", False) and os.environ.get("GROWTHLOOP_NO_LOOP") != "1":
        runner.start_loop()
    yield
    runner.stop_event.set()


app = FastAPI(title="GrowthLoop", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

SETTING_KEYS = set(DEFAULT_SETTINGS) | {"price_overrides", "role_active", "prompt_overrides"}


# ---------------- status & settings ----------------
def goal(product: dict) -> dict:
    snap = metrics_snapshot(store, product)
    ladder = product.get("north_star", {}).get("ladder", [10])
    cur = snap["dau_7d_avg"] or 0
    return {"metric": product.get("north_star", {}).get("metric", "dau"),
            "definition": product.get("north_star", {}).get("definition", ""), "ladder": ladder,
            "target": next((x for x in ladder if x > cur), ladder[-1]), "current_7d": snap["dau_7d_avg"],
            "today": snap["dau_today"], "prev_7d": snap["dau_prev_7d_avg"], "has_data": snap["has_data"],
            "milestones_reached": store.get_setting("milestones_reached", []) or []}


@app.get("/api/status")
def status():
    product = load_product(runner.product_id)
    current = store.one("SELECT * FROM cycles ORDER BY started_at DESC LIMIT 1")
    pending = store.one("SELECT COUNT(*) n FROM approvals WHERE status='pending'")["n"]
    return {
        "onboarded": store.get_setting("onboarded", False),
        "loop_running": store.get_setting("loop_running", False),
        "kill_switch": store.get_setting("kill_switch", False),
        "busy": runner.busy(), "current_cycle": current, "pending_inbox": pending,
        "product": {k: product.get(k) for k in ("id", "name", "url", "one_liner")},
        "goal": goal(product), "model_tier": store.get_setting("model_tier"),
        "spend_24h": round(store.spend_since(time.time() - 86400), 4),
        "budget_per_day": store.get_setting("llm_budget_usd_per_day", 0),
        "web_search": web_search_available(),
    }


@app.get("/api/settings")
def get_settings():
    return {k: store.get_setting(k, DEFAULT_SETTINGS.get(k)) for k in SETTING_KEYS}


@app.put("/api/settings")
def put_settings(body: dict[str, Any]):
    for k, v in body.items():
        if k not in SETTING_KEYS:
            raise HTTPException(400, f"unknown setting {k}")
        store.set_setting(k, v)
    store.event(None, "owner", "info", f"settings changed: {', '.join(body)}", node="settings")
    return get_settings()


@app.post("/api/onboarding")
def onboarding(body: dict[str, Any]):
    put_settings({k: v for k, v in body.items() if k in SETTING_KEYS})
    store.set_setting("onboarded", True)
    return status()


@app.get("/api/providers")
def providers():
    return {"providers": provider_status(), "tiers": TIERS, "prices": PRICES,
            "price_overrides": store.get_setting("price_overrides", {}) or {}}


@app.get("/api/products")
def products():
    return list_products()


# ---------------- hosted AI feasibility ----------------
@app.get("/api/hosted-ai/estimate")
def hosted_ai_estimate(dau: float = 10, mocks_per_user: float = 0.5, asks_per_user: float = 3,
                       tokens_per_mock: int = 30000, tokens_per_ask: int = 3000, turns_per_mock: int = 20,
                       price_in: float = 0.10, price_out: float = 0.40, free_requests_per_day: int = 1000):
    tokens_day = dau * (mocks_per_user * tokens_per_mock + asks_per_user * tokens_per_ask)
    requests_day = dau * (mocks_per_user * turns_per_mock + asks_per_user)
    # assume ~80% input / 20% output tokens
    monthly_cost = tokens_day * 30 * (0.8 * price_in + 0.2 * price_out) / 1_000_000
    on_free = requests_day <= free_requests_per_day
    max_dau_free = free_requests_per_day / max(mocks_per_user * turns_per_mock + asks_per_user, 1e-9)
    return {
        "tokens_per_day": round(tokens_day), "requests_per_day": round(requests_day),
        "monthly_cost_usd_paid_tier": round(monthly_cost, 2), "fits_free_tier": on_free,
        "max_dau_on_free_tier": int(max_dau_free),
        "verdict": ("Feasible on the free tier at this DAU. Add per-user daily caps so one user cannot drain it."
                    if on_free else
                    f"Exceeds the free tier; about ${monthly_cost:.2f}/month on the paid tier at this DAU."),
        "assumptions": "Prices and free-tier limits change: verify on Google AI Studio and edit these inputs.",
    }


# ---------------- loop control ----------------
class RunBody(BaseModel):
    kind: str = "weekly"


@app.post("/api/loop/start")
def loop_start():
    runner.start_loop()
    return status()


@app.post("/api/loop/pause")
def loop_pause():
    runner.pause_loop()
    return status()


@app.post("/api/kill")
def kill(body: dict[str, bool]):
    store.set_setting("kill_switch", bool(body.get("on", True)))
    if body.get("on", True):
        runner.pause_loop()
    store.event(None, "owner", "guardrail", f"kill switch {'ON' if body.get('on', True) else 'off'}", node="owner")
    return status()


@app.post("/api/cycles/run")
def run_cycle(body: RunBody):
    if body.kind not in ("daily", "weekly", "pivot"):
        raise HTTPException(400, "kind must be daily, weekly or pivot")
    cid = runner.start_cycle(body.kind)
    if not cid:
        raise HTTPException(409, "a cycle is already running or the kill switch is on")
    return {"cycle_id": cid}


@app.post("/api/cycles/{cycle_id}/retry")
def retry_cycle(cycle_id: str):
    if not runner.retry_cycle(cycle_id):
        raise HTTPException(409, "cycle is not failed, or another cycle is running")
    return {"cycle_id": cycle_id}


@app.get("/api/cycles")
def cycles(limit: int = 50):
    rows = store.query("SELECT * FROM cycles ORDER BY started_at DESC LIMIT ?", (limit,))
    for r in rows:
        agg = store.one("SELECT COALESCE(SUM(cost_usd),0) cost, COALESCE(SUM(tokens_in+tokens_out),0) tokens, "
                        "COUNT(*) events FROM events WHERE cycle_id=?", (r["id"],))
        r.update(agg)
    return rows


@app.get("/api/cycles/{cycle_id}")
def cycle(cycle_id: str):
    c = store.get("cycles", cycle_id)
    if not c:
        raise HTTPException(404)
    return {
        "cycle": c,
        "ideas": store.query("SELECT * FROM ideas WHERE cycle_id=? ORDER BY created_at", (cycle_id,)),
        "experiments": store.query("SELECT * FROM experiments WHERE cycle_id=?", (cycle_id,)),
        "approvals": store.query("SELECT * FROM approvals WHERE cycle_id=?", (cycle_id,)),
        "evals": store.query("SELECT * FROM evals WHERE cycle_id=?", (cycle_id,)),
    }


# ---------------- traces ----------------
@app.get("/api/events")
def events(cycle_id: str | None = None, after: int = 0, limit: int = 300, kind: str | None = None,
           agent: str | None = None):
    sql, params = "SELECT * FROM events WHERE id>?", [after]
    if cycle_id:
        sql += " AND cycle_id=?"
        params.append(cycle_id)
    if kind:
        sql += " AND kind=?"
        params.append(kind)
    if agent:
        sql += " AND agent=?"
        params.append(agent)
    sql += " ORDER BY id DESC LIMIT ?"
    params.append(limit)
    return store.query(sql, params)[::-1]


@app.get("/api/stream")
async def stream(after: int = 0):
    async def gen():
        last = after or (store.one("SELECT COALESCE(MAX(id),0) m FROM events")["m"])
        while True:
            rows = store.query("SELECT id, cycle_id, ts, agent, node, kind, content, model, cost_usd, latency_ms "
                               "FROM events WHERE id>? ORDER BY id LIMIT 100", (last,))
            for r in rows:
                last = r["id"]
                yield {"event": "trace", "id": str(r["id"]), "data": json.dumps(r)}
            await asyncio.sleep(1)
    return EventSourceResponse(gen())


# ---------------- ideas & experiments ----------------
@app.get("/api/ideas")
def ideas(status: str | None = None, limit: int = 200):
    if status:
        return store.query("SELECT * FROM ideas WHERE status=? ORDER BY created_at DESC LIMIT ?", (status, limit))
    return store.query("SELECT * FROM ideas ORDER BY created_at DESC LIMIT ?", (limit,))


@app.get("/api/experiments")
def experiments():
    return store.query("SELECT * FROM experiments ORDER BY created_at DESC")


@app.patch("/api/experiments/{eid}")
def update_experiment(eid: str, body: dict[str, Any]):
    exp = store.get("experiments", eid)
    if not exp:
        raise HTTPException(404)
    fields = {k: v for k, v in body.items() if k in ("status", "pr_url")}
    if fields.get("status") == "live" and not exp.get("started_at"):
        snap = metrics_snapshot(store, load_product(exp["product_id"]))
        fields.update(started_at=time.time(), ends_at=time.time() + 86400 * (exp["window_days"] or 7),
                      baseline=snap["dau_7d_avg"])
    store.update("experiments", eid, **fields)
    if fields.get("status") == "live":  # close the linked build task, if any
        for a in store.query("SELECT id FROM approvals WHERE kind='build_task' AND status='pending' "
                             "AND json_extract(payload,'$.experiment_id')=?", (eid,)):
            store.update("approvals", a["id"], status="done", decided_at=time.time())
    return store.get("experiments", eid)


# ---------------- inbox ----------------
class Decision(BaseModel):
    action: str  # approve | reject | posted | skipped | done
    comment: str = ""


@app.get("/api/approvals")
def approvals(status: str | None = "pending"):
    if status == "all":
        return store.query("SELECT * FROM approvals ORDER BY created_at DESC LIMIT 300")
    return store.query("SELECT * FROM approvals WHERE status=? ORDER BY created_at DESC", (status,))


@app.post("/api/approvals/{aid}")
def decide(aid: str, body: Decision):
    a = store.get("approvals", aid)
    if not a:
        raise HTTPException(404)
    mapping = {"approve": "approved", "reject": "rejected", "posted": "done", "skipped": "rejected",
               "done": "done"}
    if body.action not in mapping:
        raise HTTPException(400, "bad action")
    store.update("approvals", aid, status=mapping[body.action], comment=body.comment, decided_at=time.time())
    store.event(a["cycle_id"], "owner", "decision", f"{body.action}: {a['title']}", node="inbox",
                data={"comment": body.comment})
    if a["kind"] == "build_task" and body.action == "done":
        update_experiment(a["payload"]["experiment_id"], {"status": "live"})
    if a["kind"] == "post_draft" and body.comment:
        store.insert("learnings", id=new_id("lrn"), product_id=runner.product_id, ts=time.time(),
                     text=f"Owner on draft '{a['title']}': {body.comment}", source="owner", experiment_id=None,
                     tags=["owner", "content"])
    runner.resume_ready()
    return store.get("approvals", aid)


# ---------------- recommendations ----------------
@app.get("/api/recommendations")
def recommendations():
    return store.query("SELECT * FROM recommendations ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, "
                       "CASE impact WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, created_at DESC")


@app.post("/api/recommendations/{rid}")
def update_recommendation(rid: str, body: dict[str, str]):
    if body.get("status") not in ("open", "accepted", "dismissed", "done"):
        raise HTTPException(400)
    store.update("recommendations", rid, status=body["status"])
    return store.get("recommendations", rid)


# ---------------- metrics ----------------
class MetricIn(BaseModel):
    day: str | None = None
    name: str = "dau"
    value: float


@app.get("/api/metrics")
def metrics():
    product = load_product(runner.product_id)
    return {"goal": goal(product), "series": {n: store.metric_series(product["id"], n, 90)
                                              for n in ("dau", "visitors", "signups", "views", "sessions")}}


@app.post("/api/metrics")
def add_metric(m: MetricIn):
    store.put_metric(runner.product_id, m.day or today(), m.name, m.value, "manual")
    return metrics()


@app.post("/api/metrics/sync")
def sync_metrics():
    return metrics_adapter(load_product(runner.product_id), store).sync()


# ---------------- evals, cost, guardrails ----------------
@app.get("/api/evals/summary")
def evals_summary():
    return evals.summary(store)


@app.get("/api/evals")
def eval_rows(agent: str | None = None, limit: int = 300):
    if agent:
        return store.query("SELECT * FROM evals WHERE agent=? ORDER BY ts DESC LIMIT ?", (agent, limit))
    return store.query("SELECT * FROM evals ORDER BY ts DESC LIMIT ?", (limit,))


@app.get("/api/costs")
def costs():
    q = "SELECT {g} AS key, SUM(cost_usd) cost, SUM(tokens_in) tin, SUM(tokens_out) tout, COUNT(*) calls " \
        "FROM events WHERE kind='llm' GROUP BY {g} ORDER BY cost DESC"
    by_day = store.query("SELECT date(ts,'unixepoch','localtime') AS day, SUM(cost_usd) cost, "
                         "SUM(tokens_in+tokens_out) tokens, COUNT(*) calls FROM events WHERE kind='llm' "
                         "GROUP BY day ORDER BY day")
    return {"by_agent": store.query(q.format(g="agent")), "by_model": store.query(q.format(g="model")),
            "by_day": by_day, "spend_24h": store.spend_since(time.time() - 86400),
            "budget_per_day": store.get_setting("llm_budget_usd_per_day", 0)}


@app.get("/api/guardrails")
def guardrails():
    return {"tiers": TIER_INFO, "hard_floors": HARD_FLOORS, "autonomy": store.get_setting("autonomy", {}),
            "banned_patterns": [label for _, label in BANNED_PATTERNS],
            "log": store.query("SELECT * FROM guardrail_log ORDER BY ts DESC LIMIT 300")}


# ---------------- org ----------------
@app.get("/api/org")
def org():
    active = active_roles(store)
    overrides = store.get_setting("role_model_overrides", {}) or {}
    prompts = store.get_setting("prompt_overrides", {}) or {}
    scores = {r["agent"]: r for r in store.query(
        "SELECT agent, AVG(score) avg, COUNT(*) n FROM evals WHERE suite='agent_quality' GROUP BY agent")}
    out = []
    for r in ROLES:
        out.append({"key": r.key, "title": r.title, "dept": r.dept, "core": r.core, "active": r.key in active,
                    "context": r.context, "model_class": r.model_class,
                    "model": runner.router.model_for(r.key, r.model_class), "model_override": overrides.get(r.key),
                    "prompt": prompts.get(r.key) or r.prompt, "prompt_overridden": r.key in prompts,
                    "rubric": r.rubric, "eval_avg": scores.get(r.key, {}).get("avg"),
                    "eval_n": scores.get(r.key, {}).get("n", 0)})
    return out


@app.put("/api/org/{role}")
def update_role(role: str, body: dict[str, Any]):
    if role not in {r.key for r in ROLES}:
        raise HTTPException(404)
    if "active" in body:
        ra = store.get_setting("role_active", {}) or {}
        ra[role] = bool(body["active"])
        store.set_setting("role_active", ra)
    if "model" in body:
        mo = store.get_setting("role_model_overrides", {}) or {}
        if body["model"]:
            mo[role] = body["model"]
        else:
            mo.pop(role, None)
        store.set_setting("role_model_overrides", mo)
    if "prompt" in body:
        po = store.get_setting("prompt_overrides", {}) or {}
        if body["prompt"]:
            po[role] = body["prompt"]
        else:
            po.pop(role, None)
        store.set_setting("prompt_overrides", po)
    return next(r for r in org() if r["key"] == role)


# ---------------- learnings & feedback ----------------
@app.get("/api/learnings")
def learnings():
    return store.query("SELECT * FROM learnings ORDER BY ts DESC LIMIT 300")


@app.post("/api/learnings")
def add_learning(body: dict[str, str]):
    return store.insert("learnings", id=new_id("lrn"), product_id=runner.product_id, ts=time.time(),
                        text=body["text"], source="owner", experiment_id=None, tags=["owner"])


@app.get("/api/feedback")
def feedback():
    return store.query("SELECT * FROM feedback ORDER BY ts DESC LIMIT 300")


@app.post("/api/feedback")
def add_feedback(body: dict[str, Any]):
    row = store.insert("feedback", id=new_id("fb"), ts=time.time(), author=body.get("author", "owner"),
                       text=str(body.get("text", ""))[:4000], rating=body.get("rating"), page=body.get("page", ""),
                       status="new", response="")
    # Owner feedback is a learning the agents read every cycle
    store.insert("learnings", id=new_id("lrn"), product_id=runner.product_id, ts=time.time(),
                 text=f"Owner feedback ({row['page'] or 'general'}): {row['text']}", source="owner",
                 experiment_id=None, tags=["feedback"])
    return row


# ---------------- public results ----------------
@app.get("/api/public/results")
def public_results():
    product = load_product(runner.product_id)
    exps = store.query("SELECT title, hypothesis, status, actual_lift, predicted_lift, window_days, created_at "
                       "FROM experiments WHERE product_id=? ORDER BY created_at DESC", (product["id"],))
    return {"product": product["name"], "goal": goal(product), "dau": store.metric_series(product["id"], "dau", 90),
            "experiments": exps,
            "milestones": store.query("SELECT text, ts FROM learnings WHERE source='milestone' ORDER BY ts"),
            "cycles": store.one("SELECT COUNT(*) n FROM cycles WHERE status='done'")["n"],
            "learnings": store.query("SELECT text, ts FROM learnings WHERE source='readout' ORDER BY ts DESC LIMIT 20")}


# ---------------- runtime targets ----------------
@app.get("/api/runtime/targets")
def runtime_targets():
    return {
        "current": store.get_setting("runtime_target", "local"),
        "targets": {
            "local": {"label": "This computer", "cost": "$0",
                      "how": "make dev   # API on :8600 + UI on :5173. Runs while the machine is awake.",
                      "notes": "Data in ./data (SQLite). Good for v1."},
            "server": {"label": "Own server / VM (Docker Compose)", "cost": "~$5–20/mo VM",
                       "how": "docker compose up -d   # on any VM with Docker; set keys in .env",
                       "notes": "Always on. Put it behind HTTPS + auth (e.g. Caddy + basic auth) before exposing."},
            "serverless": {"label": "Serverless (Cloud Run + scheduler)", "cost": "~$0–10/mo at low usage",
                           "how": "see deploy/serverless.md: Cloud Run service for the API/UI, Cloud Scheduler hits "
                                  "POST /api/tick every 15 min, data on a mounted volume or Postgres.",
                           "notes": "No always-on thread: the scheduler drives ticks."},
        },
    }


@app.post("/api/tick")
def tick():
    """For serverless targets: an external scheduler calls this instead of the in-process loop thread."""
    runner.tick()
    return status()


# ---------------- static frontend ----------------
DIST = ROOT / "frontend" / "dist"
if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}")
    def spa(path: str):
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
