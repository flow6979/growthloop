"""Hard guardrails. These are code, not prompts: no agent (including HR) can change them.

- Risk tiers decide whether an action runs automatically, needs approval, or must be done by the owner.
- Deterministic policy checks block deceptive / spammy content before the LLM Trust & Safety review.
- Untrusted text (web pages, user feedback) is wrapped and stripped of instruction-like markers.
- Loop detection stops agents re-proposing ideas that were already killed.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

from .db import Store

TIER_INFO = {
    "T0": "Internal work: research, ideas, specs, drafts",
    "T1": "Reversible product change: copy, SEO meta, content page, small UI tweak behind a flag",
    "T2": "Significant product change: new feature, auth/data, pricing, removing features",
    "T3": "External/public voice: social posts, community replies, emails, outreach",
    "T4": "Money, legal, identity: spend, buy domain, rename, pivot, change stack",
}

# T3 is ALWAYS done by the owner and T4 ALWAYS needs approval, whatever the settings say.
HARD_FLOORS = {"T3": "owner_posts", "T4": "approve"}

BANNED_PATTERNS = [
    (r"\bfake (review|account|testimonial|user)s?\b", "fake reviews/accounts"),
    (r"\bsock ?puppet", "sockpuppets"),
    (r"\bastroturf", "astroturfing"),
    (r"\b(buy|purchase) (followers|likes|upvotes|reviews)\b", "buying engagement"),
    (r"\bmass[- ]?(dm|message|email)", "mass unsolicited messaging"),
    (r"\b(scrape|harvest) (emails|phone numbers|contacts)\b", "harvesting contact data"),
    (r"\bpretend(ing)? to be (a )?(real )?(user|student|customer)", "impersonation"),
    (r"\bauto[- ]?post(ing)?\b", "automated posting"),
    (r"\bguaranteed (job|offer|placement)\b", "false guarantees"),
]

INJECTION_MARKERS = re.compile(
    r"(ignore (all|any|previous|the above) instructions|system prompt|you are now|<\/?untrusted>|"
    r"disregard (all|previous)|new instructions:)", re.I)


def policy_for(store: Store, tier: str) -> str:
    if tier in HARD_FLOORS:
        return HARD_FLOORS[tier]
    autonomy = store.get_setting("autonomy", {}) or {}
    return autonomy.get(tier, "approve")


def deterministic_policy_issues(text: str) -> list[str]:
    issues = []
    low = text.lower()
    for pattern, label in BANNED_PATTERNS:
        if re.search(pattern, low):
            issues.append(label)
    return issues


def untrusted(text: str, limit: int = 6000) -> str:
    cleaned = INJECTION_MARKERS.sub("[removed]", text or "")[:limit]
    return f"<untrusted>\n{cleaned}\n</untrusted>"


def similar(a: str, b: str) -> float:
    return SequenceMatcher(None, a.lower().strip(), b.lower().strip()).ratio()


def is_repeat_of_killed(store: Store, product_id: str, title: str, threshold: float = 0.85) -> str | None:
    killed = store.query(
        "SELECT title FROM ideas WHERE product_id=? AND status='killed' ORDER BY created_at DESC LIMIT 300",
        (product_id,))
    for row in killed:
        if similar(row["title"], title) >= threshold:
            return row["title"]
    return None


def protected_path_hit(paths: list[str], protected: list[str]) -> list[str]:
    return [p for p in paths if any(p.startswith(pp) for pp in protected)]
