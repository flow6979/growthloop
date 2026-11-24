# GrowthLoop — full context handoff

Read this first if you are a new person or a new Claude session picking this project up.
Last updated: 2026-11-24. The full design lives in [`docs/PLAN.md`](PLAN.md); this file is the "where are we, and why" summary.

---

## 1. The problem and the ask (from the owner)

- **Viewinter** (https://flow6979.github.io/viewinter, repo `flow6979/viewinter`) is a free interview-prep site for
  software engineers (system design, LLD, Java, DBs, CS fundamentals, behavioural, DSA, agentic AI; Hinglish + English;
  Gemini-based AI mock interviews with a bring-your-own key). It is **not growing**: too few signups, sign-ins and
  daily active users.
- The owner asked for a **separate repo** that runs an **AI company of agents on LangGraph**:
  - The roles are CEO, PM, CTO, developers, QA, marketing, sales, finance, HR and more.
  - **One out-of-the-box thinker** (Maverick).
  - **One with only high-level product context** that throws raw, unpolished ideas (Dreamer, which is "blind" and sees only the product one-liner).
  - **One validator** that analyses whether an idea will work (Skeptic).
- It must **run in a loop, day and night**, with its own feedback loop. It works toward a number ladder: **10 → 100 → 1,000 engaged DAU**, publishing results along the way.
- It must have **guardrails, evals and observability**, plus **frontend pages** for all of them.
- It may change *anything* to win: the product, name, domain, even the language (a pivot is allowed).
- It must be **product-agnostic**. Viewinter is only the test case; later the same system should grow any product.
- The owner wants a website/product for GrowthLoop itself, covering inputs, feedback, observability and evals. That is "Mission Control".

## 2. Owner decisions (locked in)

| # | Topic | Decision |
|---|---|---|
| D1 | LLM tier and budget | Chosen **in the UI**: free (Gemini free tier), balanced, max, or mock. Supports every major provider, with per-role overrides. |
| D2 | Autonomy | **T1 auto-merges** (after QA). **T2 and above need owner approval.** T3 public posts are *always* made by the owner by hand, and T4 always needs approval. These are hard floors in code. |
| D3 | North star | **Engaged DAU**: a unique browser or account that did a meaningful action that day (read more than 30s, a quiz answer, a mock interview, a note, a plan update). |
| D4 | Runtime | Runs **on the Mac for now**. The UI also offers own server/VM (Docker Compose) and serverless (Cloud Run + Postgres + Langfuse). |
| D5 | Owner inputs | Owner minutes per day, owner channels and whether to host a small free Gemini allowance for users are **asked in the UI** (Setup wizard and Settings). |
| D6 | Domain | Use **free hosting first** (Vercel etc.). Buying a domain (~$10/yr) is shown as an analysed **Recommendation**, not an action. |
| D7 | Name | **GrowthLoop** |
| UI | Visual style | Modelled on **bullkarma.com**: a warm cream page, ink borders with hard offset shadows, lilac/sage/peach/lime tints, Plus Jakarta Sans and a lime highlighter on headings. |

Standing rules for whoever continues:
- **Never mix mock LLM output into real runs.** If every real model fails, the cycle fails; it does not quietly fall back to mock.
- Keep every outward or public action owner-gated.
- Ask the owner before enabling the `claude_code` executor or pushing to the product repo.

## 3. Architecture

```
backend/growthloop/
  config.py      paths (DATA_DIR = data/, GROWTHLOOP_DATA env), DEFAULT_SETTINGS
  db.py          SQLite Store (WAL): settings, cycles, events, ideas, experiments, approvals, recommendations,
                 metrics, evals, learnings, guardrail_log, feedback
  llm.py         model router: tiers free/balanced/max/mock, real-model fallback chain, per-provider semaphores,
                 429 backoff, daily budget guard, kill switch, optional Langfuse callback
  schemas.py     Pydantic structured outputs (Idea, Validation, CEODecision, Spec, Draft, Judgement, ...)
  roles.py       22 roles (12 active by default), each = prompt + model class + rubric + context (full / blind)
  guardrails.py  risk tiers T0–T4 + hard floors, banned patterns, loop guard (re-proposing killed ideas),
                 untrusted-content wrapping, protected paths
  evals.py       LLM-judge per role rubric, spec/draft checks, Skeptic calibration (1 − Brier), idea-source win rates
  graph.py       the LangGraph "Company" (see below)
  runner.py      Runner: SqliteSaver checkpoints (data/checkpoints.sqlite), start/retry/resume cycles,
                 30s loop thread (daily metrics sync, daily/weekly/pivot cycles), milestone checks, seeded recommendations
  executor.py    dev executor: spec_only (default) or claude_code (worktree → headless Claude Code with
                 Read/Edit/Write only, scrubbed env, build files protected → QA build → PR → auto-merge only for T1)
  adapters/      product YAML loader + metrics adapters (firestore, manual)
  tools.py       web search (Tavily or Brave, optional keys)
  api.py         FastAPI + SSE; also serves the built UI (path-contained)
backend/tests/test_cycle.py   5 e2e tests on the mock tier
frontend/      React 19 + Vite + react-router, hand-written CSS (src/styles.css), inline-SVG charts, 16 pages
products/viewinter.yaml       the Product Adapter for Viewinter
deploy/serverless.md, Dockerfile, docker-compose.yml
```

**Graph (one cycle):**
1. `readout` (finish due experiments).
2. `sense_metrics` ∥ `sense_market`.
3. `route_gate`: a daily cycle goes straight to evals; weekly and pivot cycles continue.
4. `dreamer` ∥ `maverick` ∥ `pm_ideas` ∥ `marketing_ideas`, then `collect`.
5. `skeptic` ∥ `cto`, then `merge`.
6. `ceo` (picks up to 3 experiments plus recommendations).
7. `request_approvals`, then `await_approvals` (LangGraph `interrupt()`; resumed when the owner acts in the Inbox).
8. `specs`, then `build`.
9. `content` (post drafts only for channels the owner picked, plus Trust & Safety review).
10. `hr` (org review), then `evals`, then `memo` (CEO memo).

**Mission Control pages:** Setup wizard, Overview, Live (SSE agent stream plus pipeline), Boardroom (why each decision was made), Experiments (kanban), Inbox (approvals and drafts), Recommendations (owner-only actions such as buying a domain), Evals, Traces, Costs, Guardrails, Org chart (edit prompts and models per role), Learnings, Feedback, Settings, and Public results (`/public`, the build-in-public page).

## 4. How to run

```bash
make setup     # backend/.venv (Python 3.14) + frontend npm install
make dev       # API on :8600 + UI on :5173   (or: make api / make ui separately)
make test      # e2e tests on the mock tier (no keys needed)
make build && make serve   # built UI served by FastAPI on :8600
```
- Keys go in `.env` (see `.env.example`). `GEMINI_API_KEY` alone is enough for the free tier. `ANTHROPIC_API_KEY` is needed for balanced and max. `TAVILY_API_KEY` or `BRAVE_API_KEY` is optional, for web search. Langfuse keys are optional.
- On this Mac, npm and pip are wrapped by `pmg` (a package-safety tool that blocks very new packages). If an install is blocked, pick an older version.
- The first UI load sends you to `/setup` until onboarding is completed. You can also choose "Skip for now".
- **Runtime data is NOT in git.** `data/` holds the SQLite store, checkpoints and the first real cycle's results, and it is gitignored. On a fresh clone the agents start from zero, so run a weekly cycle again.

## 5. Status as of 2026-11-24

Commits (oldest first):
1. `464a387` GrowthLoop v1: the full system (graph, roles, router, guardrails, evals, executor, UI, Docker, tests).
2. `7a6045a` Security fixes:
   - SPA static-file path traversal is now contained.
   - The developer agent is sandboxed: no shell tools, a scrubbed env, and package.json, lockfiles, CI, scripts and build config are protected.
3. `e6bb854` UI redesign in the bullkarma.com style, with a hero Overview showing a live goal card and a ticker of the agent roles.

**First real cycle** (Gemini free tier, ~9 min, $0):
- It produced 16 ideas, and the Skeptic killed or parked 6.
- The CEO picked three experiments:
  1. **T0, "Implement LocalStorage Event Tracking for DAU Measurement"** (engaged-DAU instrumentation). This **gates everything else**, because without it the loop can't measure anything.
  2. **T1, "Fix SPA Meta Tags and Add Sitemap"** (SEO).
  3. **T1, "Launch Daily Interview Question Widget"** (a retention hook).
- All three sit in the Inbox as `ready_to_build` tasks with PM specs, because the executor is in `spec_only` mode.
- The cycle also produced six recommendations: move to Vercel, buy a domain later, the hosted-AI allowance decision, SEO basics, a CEO item and an HR org review.

**Tests:** 5/5 pass on the mock tier. The frontend type-checks and builds.

## 6. Open questions for the owner

1. **Experiment 1 (engaged-DAU tracking in Viewinter):** should a human or Claude session implement it as a PR in `flow6979/viewinter`, or should the `claude_code` executor be switched on so the agents do it?
   - Note: the Viewinter working tree had uncommitted owner changes. Don't disturb them.
   - Use a branch or worktree.
2. **Metrics source:** the plan is a Firebase service account for the Firestore adapter (`traffic/{day}` docs, project `viewinter-30735`), or manual entry until then.
3. **Search key:** Tavily or Brave, so the Researcher can do live market research. Without one, it reasons from the model's own knowledge.

## 7. Known gaps and next steps

- **Before turning on `claude_code`:** the QA step still runs `npm ci` and the build on agent-written code directly on the host. Move QA into a container first. The owner can also set T1 to "approve" in Settings to review every agent PR.
- **Server and serverless runtime:** add a Postgres store and Postgres checkpointer.
- **SSE:** the stream ignores `Last-Event-ID`, and there is no backward paging.
- **Status:** `busy` is false while a cycle is waiting for approval; the UI uses `current_cycle.status` instead.
- **Custom tier:** `custom` falls back to the free tier.
- **Viewinter hosting:** move it to Vercel (free), per D6.
- **Public results page:** publish it once there is data.

## 8. Where things are

- GrowthLoop repo: https://github.com/flow6979/growthloop (private). Local copy at `~/projects/growthloop`.
- Product repo: https://github.com/flow6979/viewinter. Local copy at `~/projects/viewinter`, referenced as `../viewinter` in `products/viewinter.yaml`.
- Adding another product: copy `products/viewinter.yaml` and set `active_product` in Settings.
