"""SQLite store for everything the company does: cycles, traces, ideas, experiments, approvals, evals, costs.

One file, no ORM. JSON columns are stored as text and decoded on read. Thread-safe through a single lock
(the loop runs in a background thread while the API serves requests).
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from .config import DATA_DIR

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cycles (
  id TEXT PRIMARY KEY, product_id TEXT, kind TEXT, status TEXT, started_at REAL, ended_at REAL,
  memo TEXT, summary TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id TEXT, ts REAL, agent TEXT, node TEXT, kind TEXT,
  content TEXT, data TEXT, model TEXT, tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0, latency_ms INTEGER DEFAULT 0);
CREATE INDEX IF NOT EXISTS events_cycle ON events(cycle_id, id);
CREATE TABLE IF NOT EXISTS ideas (
  id TEXT PRIMARY KEY, cycle_id TEXT, product_id TEXT, source_agent TEXT, title TEXT, description TEXT,
  channel TEXT, status TEXT, tier TEXT, scores TEXT, predicted_lift REAL, confidence REAL,
  critique TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY, idea_id TEXT, product_id TEXT, cycle_id TEXT, title TEXT, hypothesis TEXT,
  metric TEXT, guardrail_metric TEXT, predicted_lift REAL, confidence REAL, window_days INTEGER,
  status TEXT, spec TEXT, tier TEXT, pr_url TEXT, owner TEXT, started_at REAL, ends_at REAL,
  ended_at REAL, baseline REAL, actual_lift REAL, result TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, cycle_id TEXT, kind TEXT, tier TEXT, title TEXT, body TEXT, channel TEXT,
  payload TEXT, status TEXT, comment TEXT, created_at REAL, decided_at REAL);
CREATE TABLE IF NOT EXISTS recommendations (
  id TEXT PRIMARY KEY, product_id TEXT, title TEXT, category TEXT, analysis TEXT, impact TEXT,
  effort TEXT, cost TEXT, status TEXT, source_agent TEXT, created_at REAL);
CREATE TABLE IF NOT EXISTS metrics (
  product_id TEXT, day TEXT, name TEXT, value REAL, source TEXT, PRIMARY KEY (product_id, day, name));
CREATE TABLE IF NOT EXISTS evals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, cycle_id TEXT, agent TEXT, suite TEXT, target_type TEXT,
  target_id TEXT, rubric TEXT, score REAL, passed INTEGER, reasoning TEXT, judge_model TEXT);
CREATE TABLE IF NOT EXISTS learnings (
  id TEXT PRIMARY KEY, product_id TEXT, ts REAL, text TEXT, source TEXT, experiment_id TEXT, tags TEXT);
CREATE TABLE IF NOT EXISTS guardrail_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, cycle_id TEXT, agent TEXT, rule TEXT, action TEXT,
  detail TEXT);
CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY, ts REAL, author TEXT, text TEXT, rating INTEGER, page TEXT, status TEXT,
  response TEXT);
"""

JSON_COLS = {"data", "summary", "scores", "result", "payload", "tags", "value", "spec"}


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class Store:
    def __init__(self, path: Path | None = None):
        self.path = path or (DATA_DIR / "growthloop.sqlite")
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.lock = threading.RLock()
        with self.lock:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.executescript(SCHEMA)
            self.conn.commit()

    # ---------- generic helpers ----------
    @staticmethod
    def _enc(v: Any) -> Any:
        return json.dumps(v) if isinstance(v, (dict, list)) else v

    @staticmethod
    def _dec(row: sqlite3.Row) -> dict:
        out = dict(row)
        for k in JSON_COLS & out.keys():
            if isinstance(out[k], str):
                try:
                    out[k] = json.loads(out[k])
                except json.JSONDecodeError:
                    pass
        return out

    def insert(self, table: str, **cols: Any) -> dict:
        keys = list(cols)
        with self.lock:
            cur = self.conn.execute(
                f"INSERT INTO {table} ({','.join(keys)}) VALUES ({','.join('?' * len(keys))})",
                [self._enc(cols[k]) for k in keys],
            )
            self.conn.commit()
        if "id" not in cols:
            cols["id"] = cur.lastrowid
        return cols

    def update(self, table: str, id_: Any, **cols: Any) -> None:
        if not cols:
            return
        sets = ",".join(f"{k}=?" for k in cols)
        with self.lock:
            self.conn.execute(f"UPDATE {table} SET {sets} WHERE id=?", [*(self._enc(v) for v in cols.values()), id_])
            self.conn.commit()

    def query(self, sql: str, params: tuple | list = ()) -> list[dict]:
        with self.lock:
            rows = self.conn.execute(sql, params).fetchall()
        return [self._dec(r) for r in rows]

    def one(self, sql: str, params: tuple | list = ()) -> dict | None:
        rows = self.query(sql, params)
        return rows[0] if rows else None

    def get(self, table: str, id_: Any) -> dict | None:
        return self.one(f"SELECT * FROM {table} WHERE id=?", (id_,))

    # ---------- settings ----------
    def get_setting(self, key: str, default: Any = None) -> Any:
        row = self.one("SELECT value FROM settings WHERE key=?", (key,))
        return row["value"] if row else default

    def set_setting(self, key: str, value: Any) -> None:
        with self.lock:
            self.conn.execute(
                "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )
            self.conn.commit()

    # ---------- events (the trace) ----------
    def event(self, cycle_id: str | None, agent: str, kind: str, content: str = "", node: str = "",
              data: dict | None = None, model: str = "", tokens_in: int = 0, tokens_out: int = 0,
              cost_usd: float = 0.0, latency_ms: int = 0) -> dict:
        return self.insert(
            "events", cycle_id=cycle_id, ts=time.time(), agent=agent, node=node, kind=kind, content=content[:20000],
            data=data or {}, model=model, tokens_in=tokens_in, tokens_out=tokens_out, cost_usd=cost_usd,
            latency_ms=latency_ms,
        )

    def spend_since(self, since_ts: float) -> float:
        row = self.one("SELECT COALESCE(SUM(cost_usd),0) AS s FROM events WHERE ts>=?", (since_ts,))
        return float(row["s"]) if row else 0.0

    def guardrail(self, cycle_id: str | None, agent: str, rule: str, action: str, detail: str) -> None:
        self.insert("guardrail_log", ts=time.time(), cycle_id=cycle_id, agent=agent, rule=rule, action=action,
                    detail=detail[:4000])
        self.event(cycle_id, agent, "guardrail", f"[{action}] {rule}: {detail[:300]}", data={"rule": rule})

    # ---------- metrics ----------
    def put_metric(self, product_id: str, day: str, name: str, value: float, source: str = "manual") -> None:
        with self.lock:
            self.conn.execute(
                "INSERT INTO metrics(product_id,day,name,value,source) VALUES(?,?,?,?,?) "
                "ON CONFLICT(product_id,day,name) DO UPDATE SET value=excluded.value, source=excluded.source",
                (product_id, day, name, value, source),
            )
            self.conn.commit()

    def metric_series(self, product_id: str, name: str, days: int = 60) -> list[dict]:
        return self.query(
            "SELECT day, value, source FROM metrics WHERE product_id=? AND name=? ORDER BY day DESC LIMIT ?",
            (product_id, name, days),
        )[::-1]
