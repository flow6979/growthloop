"""Product adapters: load a product YAML, and read its metrics from wherever they live."""
from __future__ import annotations

import datetime as dt
import json
import os
import urllib.request
from pathlib import Path

import yaml

from ..config import PRODUCTS_DIR
from ..db import Store


def list_products() -> list[dict]:
    return [load_product(p.stem) for p in sorted(PRODUCTS_DIR.glob("*.yaml"))]


def load_product(product_id: str) -> dict:
    path = PRODUCTS_DIR / f"{product_id}.yaml"
    data = yaml.safe_load(path.read_text())
    data.setdefault("id", product_id)
    return data


def today() -> str:
    return dt.date.today().isoformat()


class MetricsAdapter:
    name = "base"

    def __init__(self, product: dict, store: Store):
        self.product, self.store = product, store

    def sync(self, days: int = 14) -> dict:
        """Pull recent days into the metrics table. Returns {'ok': bool, 'detail': str}."""
        return {"ok": True, "detail": "manual adapter: enter numbers in the UI"}


class ManualMetrics(MetricsAdapter):
    name = "manual"


class FirestoreMetrics(MetricsAdapter):
    """Reads traffic/{yyyy-mm-dd} docs with a service account (GOOGLE_APPLICATION_CREDENTIALS).
    Uses `dau_field` when present, otherwise the fallback field, and records which one it used."""
    name = "firestore"

    def _token(self) -> str:
        from google.auth.transport.requests import Request
        from google.oauth2 import service_account

        path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
        if not path or not Path(path).exists():
            raise RuntimeError("Set GOOGLE_APPLICATION_CREDENTIALS to a Firebase service-account JSON (read-only use)")
        creds = service_account.Credentials.from_service_account_file(
            path, scopes=["https://www.googleapis.com/auth/datastore"])
        creds.refresh(Request())
        return creds.token

    def sync(self, days: int = 14) -> dict:
        cfg = self.product.get("metrics", {})
        try:
            token = self._token()
        except Exception as e:
            return {"ok": False, "detail": str(e)}
        project, coll = cfg["firebase_project"], cfg.get("collection", "traffic")
        dau_field, fallback = cfg.get("dau_field", "engaged"), cfg.get("dau_fallback_field", "visitors")
        pulled = 0
        for i in range(days):
            day = (dt.date.today() - dt.timedelta(days=i)).isoformat()
            url = (f"https://firestore.googleapis.com/v1/projects/{project}/databases/(default)/documents/"
                   f"{coll}/{day}")
            req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    doc = json.load(resp)
            except urllib.error.HTTPError as e:
                if e.code == 404:
                    continue
                return {"ok": False, "detail": f"Firestore {e.code}: {e.reason}"}
            fields = {k: _num(v) for k, v in doc.get("fields", {}).items()}
            for name in ("visitors", "newVisitors", "sessions", "views", "signups", dau_field):
                if fields.get(name) is not None:
                    self.store.put_metric(self.product["id"], day, name, fields[name], "firestore")
            dau = fields.get(dau_field)
            source = "firestore"
            if dau is None:
                dau, source = fields.get(fallback), f"firestore:{fallback} (proxy)"
            if dau is not None:
                self.store.put_metric(self.product["id"], day, "dau", dau, source)
            pulled += 1
        return {"ok": True, "detail": f"pulled {pulled} day(s)"}


def _num(v: dict):
    for key in ("integerValue", "doubleValue"):
        if key in v:
            return float(v[key])
    return None


def metrics_adapter(product: dict, store: Store) -> MetricsAdapter:
    kind = product.get("metrics", {}).get("adapter", "manual")
    return {"firestore": FirestoreMetrics}.get(kind, ManualMetrics)(product, store)


def metrics_snapshot(store: Store, product: dict, days: int = 28) -> dict:
    pid = product["id"]
    rows = store.query("SELECT day, name, value, source FROM metrics WHERE product_id=? ORDER BY day", (pid,))
    by_day: dict[str, dict] = {}
    for r in rows:
        by_day.setdefault(r["day"], {})[r["name"]] = r["value"]
    recent = dict(list(by_day.items())[-days:])
    dau = [v.get("dau") for v in recent.values() if v.get("dau") is not None]
    last7 = dau[-7:]
    prev7 = dau[-14:-7]
    avg = lambda xs: round(sum(xs) / len(xs), 2) if xs else None  # noqa: E731
    return {
        "days": recent,
        "dau_today": dau[-1] if dau else None,
        "dau_7d_avg": avg(last7),
        "dau_prev_7d_avg": avg(prev7),
        "has_data": bool(dau),
    }
