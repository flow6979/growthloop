"""Model router: picks a model per role from the owner's tier (free / balanced / max / custom), falls back when a
provider key is missing, records every call (tokens, cost, latency) as a trace event, and enforces the daily budget.

A `mock` provider produces schema-valid placeholder output so the whole company can run offline (tests, demos,
no keys). Mock output is always prefixed with "[mock]" so nobody mistakes it for real reasoning.
"""
from __future__ import annotations

import os
import random
import time
import typing
from dataclasses import dataclass
from typing import Any, TypeVar

from pydantic import BaseModel

from .config import provider_available
from .db import Store

T = TypeVar("T", bound=BaseModel)

# Two model classes per tier: "strong" for judgement-heavy roles, "fast" for drafting, ideation and judges.
TIERS: dict[str, dict[str, str]] = {
    "free": {"strong": "google_genai:gemini-flash-latest", "fast": "google_genai:gemini-flash-lite-latest"},
    "balanced": {"strong": "anthropic:claude-sonnet-5-5", "fast": "anthropic:claude-haiku-5-5"},
    "max": {"strong": "anthropic:claude-opus-5-5", "fast": "anthropic:claude-sonnet-5-5"},
    "mock": {"strong": "mock:mock-strong", "fast": "mock:mock-fast"},
}

# When a model is overloaded or down, try these real models next (same provider family first, then the free
# tier). Mock is NEVER used as a fallback for a real run: fake output must not mix with real decisions.
FALLBACKS: dict[str, list[str]] = {
    "google_genai:gemini-flash-latest": ["google_genai:gemini-flash-lite-latest", "google_genai:gemini-pro-latest"],
    "google_genai:gemini-flash-lite-latest": ["google_genai:gemini-flash-latest"],
    "anthropic:claude-opus-5-5": ["anthropic:claude-sonnet-5-5", "google_genai:gemini-flash-latest"],
    "anthropic:claude-sonnet-5-5": ["anthropic:claude-haiku-5-5", "google_genai:gemini-flash-latest"],
    "anthropic:claude-haiku-5-5": ["google_genai:gemini-flash-lite-latest"],
}


class LLMUnavailable(RuntimeError):
    pass


# Free tiers rate-limit per minute, and the graph runs agents in parallel: cap concurrent calls per provider.
import threading  # noqa: E402

CONCURRENCY = {"google_genai": 2, "anthropic": 4, "openai": 4, "openrouter": 4, "ollama": 1}
_SEMAPHORES = {p: threading.Semaphore(n) for p, n in CONCURRENCY.items()}

# USD per 1M tokens (input, output). Editable from Settings via the `price_overrides` setting.
PRICES: dict[str, tuple[float, float]] = {
    "anthropic:claude-opus-5-5": (4.0, 20.0),
    "anthropic:claude-sonnet-5-5": (2.0, 10.0),
    "anthropic:claude-haiku-5-5": (0.10, 0.50),
    "anthropic:claude-fable-5-2": (8.0, 40.0),
    # Gemini free tier costs $0 within quota; paid-tier prices can be set in Settings.
    "google_genai:gemini-flash-latest": (0.0, 0.0),
    "google_genai:gemini-flash-lite-latest": (0.0, 0.0),
    "google_genai:gemini-pro-latest": (0.0, 0.0),
}

PROVIDERS = {
    "anthropic": {"label": "Anthropic (Claude)", "env": "ANTHROPIC_API_KEY",
                  "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-2"]},
    "google_genai": {"label": "Google (Gemini)", "env": "GEMINI_API_KEY",
                     "models": ["gemini-flash-latest", "gemini-flash-lite-latest", "gemini-pro-latest"]},
    "openai": {"label": "OpenAI", "env": "OPENAI_API_KEY", "models": []},
    "openrouter": {"label": "OpenRouter (any model)", "env": "OPENROUTER_API_KEY", "models": []},
    "ollama": {"label": "Ollama (local)", "env": "OLLAMA_HOST", "models": []},
    "mock": {"label": "Offline mock (no AI)", "env": "", "models": ["mock-strong", "mock-fast"]},
}


class BudgetExceeded(RuntimeError):
    pass


@dataclass
class CallResult:
    data: Any
    model: str
    tokens_in: int
    tokens_out: int
    cost: float
    latency_ms: int


def provider_status() -> dict:
    return {p: {**meta, "available": provider_available(p)} for p, meta in PROVIDERS.items()}


class Router:
    def __init__(self, store: Store):
        self.store = store
        self._cache: dict[str, Any] = {}

    # ---------- model choice ----------
    def model_for(self, role: str, model_class: str) -> str:
        overrides = self.store.get_setting("role_model_overrides", {}) or {}
        if role in overrides and overrides[role]:
            spec = overrides[role]
            if provider_available(spec.split(":", 1)[0]):
                return spec
        tier = self.store.get_setting("model_tier", "free")
        for candidate in (tier, "free", "mock"):
            spec = TIERS.get(candidate, TIERS["free"])[model_class]
            if provider_available(spec.split(":", 1)[0]):
                return spec
        return TIERS["mock"][model_class]

    def _chat(self, spec: str):
        if spec in self._cache:
            return self._cache[spec]
        provider, model = spec.split(":", 1)
        from langchain.chat_models import init_chat_model

        kwargs: dict[str, Any] = {"max_retries": 4, "timeout": 120}
        if provider == "google_genai":
            kwargs["api_key"] = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
        if provider == "openrouter":
            provider = "openai"
            kwargs.update(base_url="https://openrouter.ai/api/v1", api_key=os.environ.get("OPENROUTER_API_KEY"))
        if provider == "ollama":
            kwargs["base_url"] = os.environ.get("OLLAMA_HOST")
        chat = init_chat_model(model, model_provider=provider, **kwargs)
        self._cache[spec] = chat
        return chat

    # ---------- budget ----------
    def check_budget(self, cycle_id: str | None, role: str) -> None:
        budget = float(self.store.get_setting("llm_budget_usd_per_day", 0.0) or 0.0)
        tier = self.store.get_setting("model_tier", "free")
        if self.store.get_setting("kill_switch", False):
            raise BudgetExceeded("Kill switch is on")
        if tier in ("free", "mock") or budget <= 0:
            return
        spent = self.store.spend_since(time.time() - 86400)
        if spent >= budget:
            self.store.guardrail(cycle_id, role, "daily_budget", "blocked",
                                 f"Spent ${spent:.2f} of ${budget:.2f} in the last 24h")
            raise BudgetExceeded(f"Daily LLM budget reached (${spent:.2f}/${budget:.2f})")

    def price(self, spec: str) -> tuple[float, float]:
        overrides = self.store.get_setting("price_overrides", {}) or {}
        if spec in overrides:
            return tuple(overrides[spec])  # type: ignore[return-value]
        return PRICES.get(spec, (0.0, 0.0))

    # ---------- the call ----------
    def structured(self, *, role: str, model_class: str, system: str, user: str, schema: type[T],
                   cycle_id: str | None, node: str = "") -> CallResult:
        self.check_budget(cycle_id, role)
        spec = self.model_for(role, model_class)
        t0 = time.time()
        if spec.startswith("mock:"):
            data = mock_instance(schema, role)
            tin, tout = len(system + user) // 4, 200
        else:
            data, spec, tin, tout = self._real_call(spec, role, system, user, schema, cycle_id, node)
        pin, pout = self.price(spec)
        cost = (tin * pin + tout * pout) / 1_000_000
        latency = int((time.time() - t0) * 1000)
        self.store.event(
            cycle_id, role, "llm", _summarize(data), node=node, model=spec, tokens_in=tin, tokens_out=tout,
            cost_usd=cost, latency_ms=latency,
            data={"system": system[:4000], "user": user[:8000], "output": data.model_dump()},
        )
        return CallResult(data, spec, tin, tout, cost, latency)

    def _real_call(self, spec: str, role: str, system: str, user: str, schema: type[T], cycle_id: str | None,
                   node: str) -> tuple[T, str, int, int]:
        chain = [spec] + [f for f in FALLBACKS.get(spec, []) if provider_available(f.split(":", 1)[0])]
        last_err = ""
        for candidate in chain:
            for attempt in range(2):
                sem = _SEMAPHORES.get(candidate.split(":", 1)[0], threading.Semaphore(4))
                try:
                    with sem:
                        runnable = self._chat(candidate).with_structured_output(schema, include_raw=True)
                        out = runnable.invoke([("system", system), ("human", user)],
                                              config=_langfuse_config(role, cycle_id, node))
                except Exception as e:
                    msg = str(e)
                    last_err = f"{candidate}: {msg[:300]}"
                    self.store.event(cycle_id, role, "error", f"{last_err} (attempt {attempt + 1})", node=node,
                                     model=candidate)
                    if "NOT_FOUND" in msg or "404" in msg[:40]:
                        break  # model not available for this key: go to the next candidate
                    rate_limited = "RESOURCE_EXHAUSTED" in msg or "429" in msg
                    time.sleep((20 if rate_limited else 3) * (attempt + 1))
                    continue
                data = out.get("parsed")
                if data is None:
                    last_err = f"{candidate}: unparseable output: {str(out.get('parsing_error'))[:300]}"
                    self.store.event(cycle_id, role, "error", last_err, node=node, model=candidate)
                    continue
                usage = getattr(out.get("raw"), "usage_metadata", None) or {}
                if candidate != spec:
                    self.store.event(cycle_id, role, "info", f"fell back from {spec} to {candidate}", node=node,
                                     model=candidate)
                return data, candidate, int(usage.get("input_tokens", 0)), int(usage.get("output_tokens", 0))
        raise LLMUnavailable(f"All models failed for {role}. Last error: {last_err}")


_LANGFUSE: Any = None


def _langfuse_config(role: str, cycle_id: str | None, node: str) -> dict:
    """Optional: when LANGFUSE_PUBLIC_KEY/SECRET_KEY are set and `langfuse` is installed, every LLM call is also
    traced to Langfuse (self-hosted or cloud), tagged by agent, node and cycle."""
    global _LANGFUSE
    if not os.environ.get("LANGFUSE_PUBLIC_KEY"):
        return {}
    if _LANGFUSE is None:
        try:
            from langfuse.langchain import CallbackHandler
            _LANGFUSE = CallbackHandler()
        except Exception:
            _LANGFUSE = False
    if not _LANGFUSE:
        return {}
    return {"callbacks": [_LANGFUSE], "run_name": f"{role}:{node}",
            "metadata": {"langfuse_session_id": cycle_id or "none", "langfuse_tags": [role, node]}}


def _summarize(obj: BaseModel) -> str:
    d = obj.model_dump()
    for key in ("summary", "memo", "title", "verdict"):
        if isinstance(d.get(key), str):
            return d[key][:500]
    return str(d)[:500]


# ---------- mock generator ----------
def mock_instance(schema: type[T], role: str, depth: int = 0) -> T:
    values: dict[str, Any] = {}
    hints = typing.get_type_hints(schema)
    for name, field in schema.model_fields.items():
        values[name] = _mock_value(hints.get(name, field.annotation), name, role, depth)
    return schema.model_validate(values)


def _mock_value(tp: Any, name: str, role: str, depth: int) -> Any:
    origin = typing.get_origin(tp)
    args = typing.get_args(tp)
    if origin in (typing.Union, getattr(__import__("types"), "UnionType", None)):
        non_none = [a for a in args if a is not type(None)]
        return _mock_value(non_none[0], name, role, depth) if non_none else None
    if origin is typing.Literal:
        return random.choice(args)
    if origin in (list, typing.List):
        n = 3 if depth == 0 else 2
        return [_mock_value(args[0] if args else str, name, role, depth + 1) for _ in range(n)]
    if origin in (dict, typing.Dict):
        return {}
    if isinstance(tp, type) and issubclass(tp, BaseModel):
        return mock_instance(tp, role, depth + 1).model_dump()
    if tp is bool:
        return random.random() > 0.5
    if tp is int:
        return random.randint(1, 10)
    if tp is float:
        return round(random.uniform(0.1, 0.9), 2)
    return f"[mock] {name.replace('_', ' ')} from {role} #{random.randint(100, 999)}"
