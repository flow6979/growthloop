"""The always-on loop. A background thread wakes every 30 seconds and decides whether to:
- sync metrics (daily),
- start a daily cycle (sense + readout) or a weekly strategy cycle,
- switch the weekly cycle to a PIVOT review when the north star has stalled,
- resume a cycle that was waiting for the owner once every approval in it is decided,
- publish a milestone report when a rung of the goal ladder is reached.
Only one cycle runs at a time. The kill switch stops everything immediately after the current LLM call.
"""
from __future__ import annotations

import datetime as dt
import sqlite3
import threading
import time
import traceback

from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command

from .adapters import load_product, metrics_adapter, metrics_snapshot
from .config import DATA_DIR, DEFAULT_SETTINGS
from .db import Store, new_id
from .graph import Company
from .llm import Router

WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class Runner:
    def __init__(self, store: Store):
        self.store = store
        self.router = Router(store)
        self.company = Company(store, self.router)
        conn = sqlite3.connect(DATA_DIR / "checkpoints.sqlite", check_same_thread=False)
        self.checkpointer = SqliteSaver(conn)
        self.graph = self.company.build_graph(self.checkpointer)
        self.cycle_lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.stop_event = threading.Event()
        self._ensure_defaults()

    # ---------- setup ----------
    def _ensure_defaults(self) -> None:
        for k, v in DEFAULT_SETTINGS.items():
            if self.store.get_setting(k) is None:
                self.store.set_setting(k, v)
        if self.store.get_setting("loop_running") is None:
            self.store.set_setting("loop_running", False)
        seed_recommendations(self.store)

    @property
    def product_id(self) -> str:
        return self.store.get_setting("active_product", "viewinter")

    # ---------- cycles ----------
    def busy(self) -> bool:
        return self.cycle_lock.locked()

    def start_cycle(self, kind: str = "weekly", background: bool = True) -> str | None:
        if self.store.get_setting("kill_switch", False):
            return None
        if not self.cycle_lock.acquire(blocking=False):
            return None
        cycle_id = new_id("cyc")
        self.store.insert("cycles", id=cycle_id, product_id=self.product_id, kind=kind, status="running",
                          started_at=time.time(), summary={})
        self.store.event(cycle_id, "system", "info", f"{kind} cycle started", node="start")
        args = (cycle_id, {"cycle_id": cycle_id, "product_id": self.product_id, "kind": kind})
        if background:
            threading.Thread(target=self._run, args=args, daemon=True).start()
        else:
            self._run(*args)
        return cycle_id

    def _run(self, cycle_id: str, payload) -> None:
        try:
            out = self.graph.invoke(payload, {"configurable": {"thread_id": cycle_id}, "recursion_limit": 60})
            self._after(cycle_id, out)
        except Exception as e:
            self.store.update("cycles", cycle_id, status="failed", ended_at=time.time(), error=str(e))
            self.store.event(cycle_id, "system", "error", traceback.format_exc()[-3000:], node="runner")
        finally:
            self.cycle_lock.release()

    def _after(self, cycle_id: str, out: dict) -> None:
        if out and out.get("__interrupt__"):
            self.store.update("cycles", cycle_id, status="waiting_approval")
            self.store.event(cycle_id, "system", "info", "waiting for owner approval", node="await_approvals")
        else:
            self.store.update("cycles", cycle_id, status="done", ended_at=time.time())
            self.check_milestone(cycle_id)

    def retry_cycle(self, cycle_id: str, background: bool = True) -> bool:
        """Durable execution: continue a failed cycle from its last checkpoint (finished nodes are not re-run)."""
        c = self.store.get("cycles", cycle_id)
        if not c or c["status"] != "failed" or not self.cycle_lock.acquire(blocking=False):
            return False
        self.store.update("cycles", cycle_id, status="running", error=None)
        self.store.event(cycle_id, "system", "info", "retrying from last checkpoint", node="runner")
        args = (cycle_id, None)
        if background:
            threading.Thread(target=self._run, args=args, daemon=True).start()
        else:
            self._run(*args)
        return True

    def resume_ready(self, background: bool = True) -> list[str]:
        resumed = []
        for c in self.store.query("SELECT id FROM cycles WHERE status='waiting_approval'"):
            pending = self.store.one("SELECT COUNT(*) n FROM approvals WHERE cycle_id=? AND kind='experiment' "
                                     "AND status='pending'", (c["id"],))["n"]
            if pending or not self.cycle_lock.acquire(blocking=False):
                continue
            self.store.update("cycles", c["id"], status="running")
            self.store.event(c["id"], "system", "info", "owner decided; resuming", node="await_approvals")
            args = (c["id"], Command(resume=True))
            if background:
                threading.Thread(target=self._run, args=args, daemon=True).start()
            else:
                self._run(*args)
            resumed.append(c["id"])
        return resumed

    # ---------- goal ladder ----------
    def check_milestone(self, cycle_id: str) -> None:
        product = load_product(self.product_id)
        snap = metrics_snapshot(self.store, product)
        avg = snap["dau_7d_avg"] or 0
        reached = self.store.get_setting("milestones_reached", []) or []
        for rung in product.get("north_star", {}).get("ladder", []):
            if avg >= rung and rung not in reached:
                reached.append(rung)
                self.store.set_setting("milestones_reached", reached)
                self.store.insert("learnings", id=new_id("lrn"), product_id=product["id"], ts=time.time(),
                                  text=f"MILESTONE: reached {rung} DAU (7-day avg {avg}).", source="milestone",
                                  experiment_id=None, tags=["milestone"])
                self.store.event(cycle_id, "ceo", "info", f"Milestone reached: {rung} DAU", node="milestone")

    def stalled(self) -> bool:
        n = (self.store.get_setting("loop", {}) or {}).get("stall_cycles_before_pivot", 3)
        weekly = self.store.query("SELECT started_at FROM cycles WHERE kind IN ('weekly','pivot') AND status='done' "
                                  "ORDER BY started_at DESC LIMIT ?", (n,))
        if len(weekly) < n:
            return False
        snap = metrics_snapshot(self.store, load_product(self.product_id))
        cur, prev = snap["dau_7d_avg"], snap["dau_prev_7d_avg"]
        return cur is not None and prev is not None and cur <= prev

    # ---------- scheduler ----------
    def tick(self) -> None:
        s = self.store
        if s.get_setting("kill_switch", False) or not s.get_setting("loop_running", False):
            return
        self.resume_ready()
        loop = s.get_setting("loop", {}) or {}
        now = dt.datetime.now()
        today = now.date().isoformat()
        if s.get_setting("last_metrics_sync") != today:
            res = metrics_adapter(load_product(self.product_id), s).sync()
            s.set_setting("last_metrics_sync", today)
            s.event(None, "growth_analyst", "tool", f"metrics sync: {res['detail']}", node="metrics")
        if self.busy() or now.hour < int(loop.get("daily_hour", 9)):
            return
        is_weekly_day = WEEKDAYS[now.weekday()] == loop.get("weekly_day", "mon")
        if is_weekly_day and s.get_setting("last_weekly") != today:
            s.set_setting("last_weekly", today)
            s.set_setting("last_daily", today)
            self.start_cycle("pivot" if self.stalled() else "weekly")
        elif s.get_setting("last_daily") != today:
            s.set_setting("last_daily", today)
            self.start_cycle("daily")

    def start_loop(self) -> None:
        self.store.set_setting("loop_running", True)
        if self.thread and self.thread.is_alive():
            return
        self.stop_event.clear()

        def loop():
            while not self.stop_event.is_set():
                try:
                    self.tick()
                except Exception:
                    self.store.event(None, "system", "error", traceback.format_exc()[-2000:], node="scheduler")
                self.stop_event.wait(30)

        self.thread = threading.Thread(target=loop, daemon=True)
        self.thread.start()

    def pause_loop(self) -> None:
        self.store.set_setting("loop_running", False)


def seed_recommendations(store: Store) -> None:
    """Bootstrap analysis from the initial code review, so the owner sees it before the first cycle runs."""
    if store.get_setting("seeded_recommendations"):
        return
    pid = store.get_setting("active_product", "viewinter")
    recs = [
        ("Move hosting to a free platform root domain (Vercel/Netlify/Cloudflare Pages)", "hosting",
         "Today the site lives at flow6979.github.io/viewinter: a subpath on a personal GitHub domain. A free "
         "*.vercel.app (or pages.dev) root gives a cleaner brand URL, lets you verify it in Google Search Console as "
         "its own property, and supports per-page server/pre-rendering, which a GitHub Pages SPA cannot do. "
         "Cost: $0. Effort: about 1 hour (import repo, set the 4 VITE_FIREBASE_* env vars, base path '/').",
         "high", "low", "$0"),
        ("Buy your own domain once traffic starts (e.g. viewinter.in / .dev)", "domain",
         "A own domain builds trust (people share it on WhatsApp/LinkedIn), keeps all SEO value if you ever move "
         "hosts again, and gives you a professional email for outreach to colleges. Search engines rank by content "
         "quality more than domain, so this is not urgent before the SEO fixes, but every week on a borrowed URL is "
         "SEO value you may have to migrate later. Recommended timing: right after moving off GitHub Pages, before "
         "content promotion starts. Cost: ~$8–15/yr for .in/.dev/.com.", "medium", "low", "~$10/yr"),
        ("Decide on a hosted AI allowance (remove the 'bring your own Gemini key' wall)", "spend",
         "AI mock interviews and Ask-AI need the user's own Gemini key today, which most visitors will not set up. "
         "A small hosted allowance (e.g. 2 mock interviews/day per signed-in user, via a tiny proxy with rate limits) "
         "turns the best feature into a signup reason. Use the calculator in Settings → Hosted AI to see whether the "
         "Gemini free tier covers it at your expected DAU.", "high", "medium", "$0–$20/mo"),
        ("Fix SEO basics: pre-render pages, per-page titles/descriptions, sitemap, Open Graph", "process",
         "The site is a client-rendered SPA: crawlers and WhatsApp/LinkedIn previews see an empty <div id='root'> "
         "and one title for all 343 articles. Pre-rendering each article at build time plus a sitemap is likely the "
         "single biggest acquisition lever. The agents will propose this as a T1 experiment.", "high", "medium", "$0"),
    ]
    for title, cat, analysis, impact, effort, cost in recs:
        store.insert("recommendations", id=new_id("rec"), product_id=pid, title=title, category=cat,
                     analysis=analysis, impact=impact, effort=effort, cost=cost, status="open",
                     source_agent="bootstrap analysis", created_at=time.time())
    store.set_setting("seeded_recommendations", True)
