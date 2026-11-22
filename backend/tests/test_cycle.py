"""End-to-end: run a weekly cycle on the offline mock models, approve the gated experiments, resume, finish."""
import os
import tempfile
from pathlib import Path

os.environ["GROWTHLOOP_DATA"] = tempfile.mkdtemp()
os.environ["GROWTHLOOP_NO_LOOP"] = "1"

from fastapi.testclient import TestClient  # noqa: E402

from growthloop import api  # noqa: E402

c = TestClient(api.app)


def setup_module():
    c.post("/api/onboarding", json={"model_tier": "mock", "owner_channels": ["linkedin", "whatsapp"],
                                    "owner_minutes_per_day": 30,
                                    "autonomy": {"T0": "auto", "T1": "auto", "T2": "approve", "T3": "owner_posts",
                                                 "T4": "approve"}})
    for d, v in [("2026-11-01", 2), ("2026-11-02", 3), ("2026-11-03", 1)]:
        c.post("/api/metrics", json={"day": d, "name": "dau", "value": v})


def test_status_and_seeds():
    s = c.get("/api/status").json()
    assert s["onboarded"] and s["product"]["name"] == "Viewinter"
    recs = c.get("/api/recommendations").json()
    assert any("domain" in r["title"].lower() for r in recs)


def test_weekly_cycle_with_approvals():
    cid = api.runner.start_cycle("weekly", background=False)
    assert cid
    cyc = c.get(f"/api/cycles/{cid}").json()
    assert cyc["ideas"], "ideas were generated"
    assert cyc["cycle"]["status"] in ("waiting_approval", "done")
    pending = [a for a in c.get("/api/approvals").json() if a["kind"] == "experiment" and a["cycle_id"] == cid]
    for a in pending:
        c.post(f"/api/approvals/{a['id']}", json={"action": "approve"})
    import time
    for _ in range(100):  # the last approval resumes the cycle in a background thread
        cyc = c.get(f"/api/cycles/{cid}").json()
        if cyc["cycle"]["status"] in ("done", "failed"):
            break
        time.sleep(0.1)
    errors = [e["content"] for e in c.get(f"/api/events?cycle_id={cid}&kind=error").json()]
    assert not errors, errors
    assert cyc["cycle"]["status"] == "done", cyc["cycle"]
    assert c.get("/api/evals/summary").json()["per_agent"], "evals recorded"
    kinds = {e["kind"] for e in c.get(f"/api/events?cycle_id={cid}").json()}
    assert {"llm", "node_end"} <= kinds


def test_daily_cycle():
    cid = api.runner.start_cycle("daily", background=False)
    assert c.get(f"/api/cycles/{cid}").json()["cycle"]["status"] == "done"


def test_guardrails_block_banned_draft():
    from growthloop.guardrails import deterministic_policy_issues, policy_for
    assert deterministic_policy_issues("let's post fake reviews and buy upvotes")
    api.store.set_setting("autonomy", {"T3": "auto", "T4": "auto"})
    assert policy_for(api.store, "T3") == "owner_posts" and policy_for(api.store, "T4") == "approve"


def test_hosted_ai_estimate():
    r = c.get("/api/hosted-ai/estimate?dau=10").json()
    assert "fits_free_tier" in r and r["requests_per_day"] > 0
