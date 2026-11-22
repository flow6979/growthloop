# GrowthLoop

An AI company (LangGraph multi-agent) that grows a product until it hits a number: 10 DAU → 100 → 1,000.

It measures, ideates, validates, decides, builds, ships, measures again and learns, in a loop that keeps running.
Risky actions go through guardrail tiers and your approval inbox. Every agent is evaluated, and every LLM call is
traced and costed. **Mission Control** (the web UI) is where you set it up, approve work, post drafts, read the
debates, and see evals, traces, costs and results.

The first product is [Viewinter](https://github.com/flow6979/viewinter). Any product can be added as a YAML file in `products/`.

See [`docs/PLAN.md`](docs/PLAN.md) for the full design and the decisions made so far.

## Quick start (this computer)

```bash
cp .env.example .env        # add at least GEMINI_API_KEY (free) or choose the offline "mock" tier in the UI
make setup
make dev                    # API + loop on :8600, Mission Control on http://localhost:5173
```

The setup wizard asks how much time you have per day, which channels you post on, the model tier and budget,
whether a hosted AI allowance for Viewinter users is affordable, the autonomy per risk tier, and where to run.

```bash
make test                   # end-to-end cycle on the offline mock models
make serve                  # one process on :8600 serving API + built UI
docker compose up -d        # own server / VM
```
Serverless: see [`deploy/serverless.md`](deploy/serverless.md).

## How a cycle works

```
readout ─► sense (metrics ∥ market) ─► ideate (Dreamer ∥ Maverick ∥ PM ∥ Marketing) ─► collect (dedupe, loop guard,
policy) ─► validate (Skeptic ∥ CTO) ─► CEO portfolio ─► approvals (LangGraph interrupt) ─► PM specs ─► build
(spec-only or Claude Code in a worktree + QA) ─► content drafts + Trust & Safety ─► HR org review ─► evals ─► memo
```

- **Daily cycle:** readout and sense only. **Weekly:** the full strategy cycle. **Pivot:** runs automatically when the
  north star stalls for N weekly cycles. Maverick proposes pivots (name, audience, product, domain, stack), and you decide.
- **Durable:** state is checkpointed after every node (SQLite). A cycle waiting on you survives restarts, and a failed
  cycle can be retried from its last checkpoint.
- **Models:** tiers Free (Gemini) / Balanced / Max (Claude) / Mock, with per-role overrides and a real-model fallback
  chain. Mock output never mixes into real runs.

## Layout

```
backend/growthloop/   api.py (FastAPI) · runner.py (loop) · graph.py (LangGraph company) · roles.py (org)
                      llm.py (router, cost) · guardrails.py · evals.py · executor.py (dev/QA) · adapters/ (metrics)
frontend/             Mission Control (React + Vite)
products/             one YAML per product (Viewinter first)
docs/PLAN.md          design + decisions
```
