"""Paths and environment. Everything else (model tier, autonomy, channels...) lives in the settings table
so the owner can change it from the UI."""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("GROWTHLOOP_DATA", ROOT / "data"))
PRODUCTS_DIR = Path(os.environ.get("GROWTHLOOP_PRODUCTS", ROOT / "products"))
WORKTREES_DIR = Path(os.environ.get("GROWTHLOOP_WORKTREES", ROOT / "worktrees"))

# Settings the UI writes; these are the defaults until the owner finishes onboarding.
DEFAULT_SETTINGS: dict = {
    "onboarded": False,
    "active_product": "viewinter",
    # Owner capacity & channels (asked in the UI)
    "owner_minutes_per_day": 20,
    "owner_channels": [],
    # Models
    "model_tier": "free",            # free | balanced | max | custom
    "role_model_overrides": {},      # role -> "provider:model"
    "provider_keys_present": {},     # filled at runtime from env, never stores keys
    # Money
    "llm_budget_usd_per_day": 0.0,   # 0 = free-tier only; enforced by the CFO guardrail
    "hosted_ai_allowance": {"decision": "undecided", "monthly_cap_usd": 0},
    # Autonomy: which tiers run without the owner
    "autonomy": {"T0": "auto", "T1": "auto", "T2": "approve", "T3": "owner_posts", "T4": "approve"},
    "dev_executor": "spec_only",     # spec_only | claude_code
    # Loop
    "loop": {"daily_hour": 9, "weekly_day": "mon", "stall_cycles_before_pivot": 3,
             "max_debate_turns": 2, "max_ideas_per_cycle": 12, "max_experiments_per_cycle": 3},
    "runtime_target": "local",       # local | server | serverless
    "kill_switch": False,
    "price_overrides": {},
    "role_active": {},
    "prompt_overrides": {},
}

PROVIDER_ENV = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "google_genai": "GEMINI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
    "ollama": "OLLAMA_HOST",
}


def provider_available(provider: str) -> bool:
    if provider == "mock":
        return True
    if provider == "google_genai":
        return bool(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY"))
    if provider == "ollama":
        return bool(os.environ.get("OLLAMA_HOST"))
    env = PROVIDER_ENV.get(provider)
    return bool(env and os.environ.get(env))
