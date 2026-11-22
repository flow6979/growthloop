"""Structured outputs every agent must return. Structured output keeps the debate bounded and machine-checkable:
no free-form chatting between agents."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Tier = Literal["T0", "T1", "T2", "T3", "T4"]
Channel = Literal["product", "seo", "content", "social", "community", "email", "partnerships", "pricing",
                  "brand", "pivot", "infra", "analytics"]


class Situation(BaseModel):
    """Growth Analyst: what the numbers say right now."""
    summary: str = Field(description="3-5 sentences on where the north-star metric stands and why")
    north_star_trend: Literal["up", "flat", "down", "unknown"]
    biggest_bottleneck: str = Field(description="acquisition, activation, retention, referral or revenue, with evidence")
    data_gaps: list[str] = Field(description="metrics we cannot see yet but need")


class MarketScan(BaseModel):
    """Market Researcher: competitors, communities, keywords, PMF signals."""
    summary: str
    competitors: list[str] = Field(description="'name: positioning, price, what they do better/worse'")
    where_users_are: list[str] = Field(description="communities, search queries, channels where target users gather")
    pmf_signals: list[str]


class Idea(BaseModel):
    title: str = Field(description="short, imperative")
    description: str = Field(description="what we would do and why it could move the north star")
    channel: Channel
    tier: Tier = Field(description="T0 internal, T1 reversible product change, T2 significant change, "
                                   "T3 public/external voice, T4 money/legal/identity/pivot")


class IdeaList(BaseModel):
    summary: str = Field(description="one line on the angle you took")
    ideas: list[Idea]


class IdeaScore(BaseModel):
    title: str = Field(description="exact title of the idea being scored")
    impact: int = Field(ge=1, le=10)
    confidence: int = Field(ge=1, le=10)
    ease: int = Field(ge=1, le=10)
    predicted_lift_pct: float = Field(description="predicted % change in the north star within the window if shipped")
    probability_of_success: float = Field(ge=0, le=1)
    premortem: str = Field(description="the most likely reason this fails")
    evidence: str = Field(description="data, research or precedent behind the score; say 'none' if none")
    verdict: Literal["kill", "park", "pursue"]


class Validation(BaseModel):
    summary: str
    scores: list[IdeaScore]


class Feasibility(BaseModel):
    title: str
    feasible: bool
    effort_days: float
    risk_notes: str
    tier: Tier


class CTOReview(BaseModel):
    summary: str
    reviews: list[Feasibility]


class ExperimentPick(BaseModel):
    title: str = Field(description="exact title of the chosen idea")
    hypothesis: str = Field(description="If we X, then METRIC will change by Y because Z")
    metric: str
    guardrail_metric: str
    window_days: int = Field(ge=1, le=60)
    kill_criteria: str


class Recommendation(BaseModel):
    title: str
    category: Literal["domain", "hosting", "spend", "channel", "pricing", "brand", "pivot", "process", "other"]
    analysis: str = Field(description="why, with numbers where possible")
    impact: Literal["low", "medium", "high"]
    effort: Literal["low", "medium", "high"]
    cost: str = Field(description="money cost, e.g. '$0', '~$10/yr'")


class CEODecision(BaseModel):
    memo: str = Field(description="cycle memo to the owner: what we learned, what we bet on, why")
    experiments: list[ExperimentPick]
    owner_recommendations: list[Recommendation] = Field(description="things only the owner can do or decide")
    pivot_flag: bool = Field(description="true only if evidence says the current product/positioning cannot reach the goal")


class Spec(BaseModel):
    title: str
    user_story: str
    changes: list[str] = Field(description="concrete changes to make (files/pages/copy) in the target product")
    acceptance_criteria: list[str]
    instrumentation: list[str] = Field(description="events/metrics needed to measure the experiment")
    rollout: str


class Draft(BaseModel):
    channel: str = Field(description="linkedin, youtube, x, whatsapp, reddit, college-groups, email, blog...")
    title: str
    body: str = Field(description="ready-to-post text, honest, helpful, no fake claims")
    why: str


class DraftList(BaseModel):
    summary: str
    drafts: list[Draft]


class PolicyCheck(BaseModel):
    title: str
    allowed: bool
    issues: list[str]


class PolicyReview(BaseModel):
    summary: str
    checks: list[PolicyCheck]


class Judgement(BaseModel):
    score: float = Field(ge=0, le=1)
    passed: bool
    reasoning: str


class ExperimentReadout(BaseModel):
    title: str
    verdict: Literal["won", "lost", "inconclusive"]
    learning: str


class Readouts(BaseModel):
    summary: str
    readouts: list[ExperimentReadout]


class OrgReview(BaseModel):
    summary: str
    agent_notes: list[str] = Field(description="'role: what to change in its behaviour and why'")
    roles_to_activate: list[str]
    roles_to_pause: list[str]
