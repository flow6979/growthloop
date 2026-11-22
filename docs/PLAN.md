# GrowthLoop — an AI company that grows a product until it hits a number

> Working name. Status: **v0 plan, for discussion** (2026-11-22). First target product: Viewinter.

## 0. The one-paragraph version

GrowthLoop is a separate repo that runs a LangGraph multi-agent "company" (CEO, PM, CTO, devs, QA,
marketing, sales, finance, HR, plus a wild-ideas agent, a raw-ideas agent and a skeptic). It works in a
**closed loop toward a numeric goal**: measure → ideate → validate → decide → build → ship → measure
again, and it keeps going until it reaches the goal (10 DAU → 100 → 1,000). Every outward or risky
action passes a guardrail tier, and some tiers need your approval. Every agent is scored by evals.
Every run can be traced in a "Mission Control" web UI. The product it grows sits behind a **Product
Adapter**: Viewinter is adapter #1, and any other product can be plugged in later.

---

## 1. What the research says (and why it shapes the design)

| Finding | Implication for us |
|---|---|
| "AI-run company" experiments in 2025–26 (HurumoAI, the CMU simulated company, Grove) mostly failed. Agents "talked themselves to death", stalled on long multi-step work, and one sent 240 cold emails for 1 reply and $0. | **Talk has to be cheap and bounded.** Every cycle must end in a *shipped experiment with a hypothesis and a metric*, not a meeting transcript. Debates get turn caps. The CEO allocates budget; it doesn't chat. |
| Reddit and LinkedIn are using AI to hunt automated and astroturf posting. LinkedIn's API terms forbid automated posting, and Reddit's public API is closing (new requests end Oct 31 2026). | **Agents draft and humans post** on social channels. No fake reviews, no sockpuppets, no unsolicited DMs. That rule is permanent, not a v1 shortcut. |
| LangGraph 1.x is GA, with durable checkpointing (Postgres), interrupts for human approval, and supervisor/subgraph patterns. | Good fit. One run of the graph = one cycle. `interrupt()` drives the approval inbox, and the Postgres checkpointer lets cycles survive restarts. |
| Langfuse is MIT-licensed and self-hostable, with tracing, LLM-as-judge evals and datasets. Phoenix is lighter but uses the Elastic License. | Use **Langfuse** for traces and evals, and build our own Mission Control UI on top for the company-level views (experiments, goals, approvals, org). |
| The interview-prep market is crowded: Exponent ($149/yr), Hello Interview ($79/yr), Codemia (free), designinterviews.in (free "LeetCode for system design"), plus Hindi/Hinglish mentors on Topmate. | Viewinter's moat isn't "more content". It has to be *distribution + a sharp wedge*. Candidates: Hinglish-first, free AI mock interviews, an agentic-AI-engineer track. Validating this is the agents' first job. |

### What I found in Viewinter itself (the likely reason it isn't growing)

1. **Google can barely see it.** It's a client-rendered SPA: `index.html` is an empty `<div id="root">` with `<title>Viewinter</title>`, no meta description, no sitemap, no per-page titles and no OG tags. That leaves 343 high-quality articles invisible to search and unshareable on WhatsApp/LinkedIn (no previews). This is probably the #1 lever, and it's cheap to fix (prerender/SSG at build time).
2. **It lives at `flow6979.github.io/viewinter`.** A subpath on a personal github.io domain has weak brand and SEO authority, and you can't easily verify it in Search Console. An own domain is cheap.
3. **AI features need a BYO Gemini key.** Asking a user to get an API key before mock interviews work is a huge activation cliff. A small hosted free quota (proxy + rate limit) would likely convert far better.
4. **There's no reason to sign up and no reason to come back daily.** Login is "only for sync". There's no streak, no daily question, no email or WhatsApp nudge, and no interview countdown reminder. DAU needs a daily hook.
5. **There's no real DAU metric yet.** `traffic/{day}` counts anonymous browser visits and GA is optional. Agents can't optimize what they can't measure, so step 1 is instrumentation.

These are *my* hypotheses. In the loop they become the seed backlog that the Skeptic agent has to score
like any other idea.

---

## 2. The org (agents)

Agents are grouped into **departments**. Each department is a LangGraph subgraph. Roles are prompts plus tools
plus a memory scope plus an eval rubric. They are not separate processes.

| Dept | Agent | Job | Key tools |
|---|---|---|---|
| **Exec** | **CEO** | Owns the goal. Turns each cycle's evidence into an experiment portfolio within the budget. Proposes pivots. | metrics, ledger, learnings |
| | **CFO / Finance** | Tracks LLM, infra and ad spend against budget. Estimates cost per experiment and blocks anything over budget. | cost ledger |
| | **Chief of Staff** | Runs the meeting protocol (turn caps, agenda), writes the cycle memo, flags agents that loop. | — |
| **Strategy** | **Dreamer (raw ideas)** | Gets only *high-level product context* (one paragraph + the goal), on purpose. Produces 10–20 raw, unpolished ideas a cycle, without data, so it isn't anchored. | none (by design) |
| | **Maverick (out-of-the-box)** | Lateral and contrarian thinking: pivots, new names, new audiences, new business models, "what would make this 10×". It is required to propose at least one idea that breaks an assumption. | web search |
| | **Skeptic / Validator** | Tries to kill ideas: pre-mortem, evidence check, ICE/RICE score, *a predicted metric lift with a confidence level*. Its predictions are scored later (calibration). | metrics, web, learnings |
| | **Market Researcher** | Competitors, pricing, keywords, communities, trends. Reports PMF signals. | web search/fetch, Search Console |
| **Product** | **PM** | Turns the chosen experiments into small specs with a hypothesis, success metric, guardrail metric, rollout and kill criteria. | repo read, analytics |
| | **UX Researcher** | Runs *synthetic user* walkthroughs (personas such as "Tier-2 college fresher, Hinglish, mobile") with Playwright on preview builds. Clearly labeled as **not real data**. | browser |
| | **Designer** | UI copy, layout and visual changes, with screenshots before and after. | browser, repo |
| **Engineering** | **CTO** | Feasibility, architecture and risk tier for each change. Approves the tech approach and can veto. | repo read |
| | **Developers (N)** | Implement specs in a git worktree of the target repo and open a PR. Executor: Claude Agent SDK / Claude Code headless. | repo write (sandboxed), shell |
| | **QA** | Typecheck, build, unit tests, Playwright e2e, Lighthouse/SEO checks and visual diff. Blocks merge on failure. | CI, browser |
| | **SRE / Release** | Deploys, watches error rates after deploy, rolls back automatically. | deploy API, monitoring |
| **Growth** | **Marketing / Content** | SEO pages, blog, YouTube/Shorts scripts, social drafts. Owns the content calendar. | CMS/repo, Search Console |
| | **Community Manager** | Finds the communities where users already are. Drafts *helpful* posts and replies for **human posting**. | web search |
| | **Sales / Partnerships** | B2B angle: college placement cells, bootcamps, communities. Drafts outreach, and a human sends it. | CRM sheet |
| | **Growth Analyst** | Funnels, cohorts and attribution. Computes experiment results and decides win/lose/inconclusive. | analytics DB |
| | **Support / Voice of Customer** | Reads feedback, reviews and emails, and clusters the pain points. | inbox/forms |
| **People & Trust** | **HR / Org Designer** | Reviews agent performance from evals. Proposes prompt changes, new roles or retiring roles. Changes go through the eval gate first. | eval results, prompt registry |
| | **Trust & Safety / Legal** | Checks every external artifact against policy: platform ToS, no fake reviews, no dark patterns, privacy. | policy rules |

That makes 22 roles, but **each cycle activates only the roles it needs**. Phase 1 starts with about 8: CEO, Dreamer, Maverick,
Skeptic, PM, Developer, QA, Growth Analyst. HR adds the others when their absence shows up in evals.

---

## 3. The loop

```
             ┌──────────────── Goal: 10 DAU (then 100, 1k) ─────────────────┐
             ▼                                                               │
  ① SENSE ── Growth Analyst pulls metrics · Researcher scans market · VoC    │
             ▼                                                               │
  ② IDEATE ─ Dreamer (blind) · Maverick · Marketing · PM · Sales  → ideas    │
             ▼                                                               │
  ③ VALIDATE Skeptic scores + predicts lift · CTO feasibility · CFO cost     │
             ▼                                                               │
  ④ DECIDE ─ CEO picks portfolio within budget  ──► [you approve if T2+]    │
             ▼                                                               │
  ⑤ BUILD ── PM spec → Devs (PR) → QA gates → preview deploy                 │
             ▼                                                               │
  ⑥ SHIP ─── Release deploys (auto for T1, approval for T2) · content drafts │
             ▼            to the "post this" inbox for you                   │
  ⑦ MEASURE  after the experiment window: win/lose/inconclusive              │
             ▼                                                               │
  ⑧ LEARN ── learnings memory · Skeptic calibration · HR tunes agents ───────┘
             + public "results" report on each milestone
```

**Cadence.** "Day and night" means the loop never stops, but it follows *how fast data arrives*, not a fixed
timer. At 10 DAU the numbers are tiny and noisy, so running a new strategy debate every hour just burns money.
The proposal:
- **Continuous (event-driven):** build/QA/deploy work, CI fixes, content production, error watching.
- **Daily:** sense, plus a lightweight check on running experiments, then small ships.
- **Weekly:** a full strategy cycle (ideate → decide), plus an HR review.
- **On a milestone or a stall:** if the metric hasn't moved after N weekly cycles, the **Pivot Review** runs. Maverick and Researcher build
  pivot options, which can go as far as a new name, audience, domain or stack. The Skeptic argues against them, and **you** decide.

**Goal ladder.** Each rung has a north star (DAU) plus guardrails such as D7 retention, activation rate,
error rate and cost per active user. Hitting a rung publishes a results report and moves to the next rung.

---

## 4. Guardrails (risk tiers)

| Tier | Examples | Policy |
|---|---|---|
| **T0** internal | Research, ideas, specs, drafts | Fully autonomous |
| **T1** reversible product change | Copy, SEO meta, new content page, small UI tweak behind a flag | Auto-merge if QA and evals pass. Auto-rollback on error spike. |
| **T2** significant product change | New feature, auth/data changes, pricing page, removing features | PR plus **your approval** in the inbox |
| **T3** external/public voice | Social posts, community replies, emails, PR outreach | Agent drafts, **you post**. Never automated. |
| **T4** money, legal, identity | Spend >$X, buy a domain, rename, pivot, change language/stack | **Explicit approval** with a written case from CEO and Skeptic |

Hard rules, which can't be overridden by any agent, including HR:
- Budget caps per day and per cycle on tokens and dollars, with a hard stop, and a kill switch in the UI.
- No astroturfing, fake reviews or personas pretending to be real users. No dark patterns. No scraping that breaks ToS.
- Web content is *data*: researcher output is sanitized and tagged, and it can never call tools. This is the prompt-injection boundary.
- Devs work in a sandboxed worktree with scoped GitHub tokens. Secrets are never in prompts. Protected paths include auth, rules and payments.
- PII stays out: agents see aggregates, never individual user records.
- A loop detector flags repeated tool calls, a debate past its turn cap, or the same idea re-proposed after it was killed.

---

## 5. Evals (three layers)

1. **Agent-quality evals (offline, on every prompt change).** Golden datasets per role, LLM-as-judge rubrics
   (for example, "is this spec testable?", "did the Dreamer actually stay un-anchored?", "did the Skeptic cite evidence?"),
   and pairwise comparison against the previous prompt version. The HR agent's prompt edits **must** beat the baseline to ship.
2. **Work-product evals (every artifact).** Code: build, tests, e2e, Lighthouse/SEO score, bundle size.
   Content: factual-accuracy judge plus a plagiarism/duplication check. External drafts: the T&S policy judge.
3. **Outcome evals (the ones that matter).**
   - Experiment win rate, and lift per $ spent.
   - **Skeptic calibration**: predicted lift vs actual (Brier score). Over time it tells us whether the validator can be trusted.
   - Idea-source attribution: which agent's ideas actually move the metric (Dreamer vs Maverick vs PM).
   - Cost per shipped experiment, cycle time, and how many approvals got rejected.

---

## 6. Observability and frontend ("Mission Control")

- **Tracing:** every LLM and tool call goes to Langfuse (self-hosted), tagged with cycle, agent, experiment and tier.
- **Mission Control (our web app):**
  - **Goal**: DAU vs target, the ladder, guardrail metrics, and a forecast.
  - **Live org**: who is working on what right now, a graph view of the current run, and a stream of agent "thoughts".
  - **Boardroom**: the debate transcripts per cycle (ideas → scores → decision), so you can read *why*.
  - **Experiments**: a board of hypothesis / status / metric / result / learnings.
  - **Approval inbox**: T2/T3/T4 items with diff, preview link and case. Approve, reject or comment, and the reason goes back to the agents.
  - **Evals**: scores per agent over time, calibration plot, prompt versions.
  - **Cost**: spend by agent, cycle and model, against the budget.
  - **Guardrails log**: blocked actions and why.
  - **Learnings**: a searchable memory of what worked and what didn't.
  - **Public results page**: a "build in public" view of milestones. That's a growth channel in itself.

---

## 7. Making it product-agnostic: the Product Adapter

```yaml
# products/viewinter.yaml
name: Viewinter
context: "Free Hinglish/English interview prep: HLD, LLD, Java, DB, agentic AI, AI mock interviews"
repo: github.com/flow6979/viewinter
build: "cd web && npm ci && npm run typecheck && npm run build"
deploy: github-pages          # adapter: github-pages | vercel | cloudrun | ...
metrics:
  source: firestore+ga4       # adapter returns DAU, signups, activation, retention
  north_star: dau
channels: [seo, youtube, linkedin, whatsapp, reddit, colleges]
protected_paths: [web/firestore.rules, web/src/firebase.ts]
budget: { llm_usd_per_day: 5, ads_usd_per_month: 0 }
```

The core never imports Viewinter-specific code. A new product means a new YAML file plus, if needed, a new
metrics or deploy adapter. If the loop pivots Viewinter into a different product, the adapter is what changes.

---

## 8. Tech stack (proposed)

| Layer | Choice | Why |
|---|---|---|
| Orchestration | **Python + LangGraph 1.x**, supervisor + department subgraphs | Your requirement. It's also the best fit for durable, interruptible graphs. |
| State | Postgres: LangGraph checkpointer, plus tables for experiments, ledger, approvals and learnings | One DB, durable |
| Memory | Postgres + pgvector for learnings and research | No extra service |
| Models | Router: a strong model for CEO, Skeptic and Dev; a cheap/fast model for drafting and judges. Multi-provider (Claude, Gemini free tier, ...). | Cost control |
| Dev executor | Claude Agent SDK (or Claude Code headless) called from a LangGraph node, inside a git worktree | Real coding ability, not toy codegen |
| Observability | Langfuse (self-hosted, MIT) + OpenTelemetry | Traces and evals |
| API / UI | FastAPI + React/Vite (the stack you already know) with SSE for the live views | |
| Runtime | Docker Compose locally, then one small VM or Cloud Run with a worker. Scheduler: APScheduler or cron. | Always-on, cheap |
| Viewinter metrics | Firebase Admin (Firestore `traffic`/`users`) + GA4 Data API + Search Console API | Real numbers |

---

## 9. Phased rollout

- **Phase 0 (this discussion):** agree on product, goals, budget, autonomy and stack.
- **Phase 1 (v1, "the company boots"):** repo skeleton, Product Adapter, metrics adapter for Viewinter (defines DAU for real),
  8 core agents, a weekly strategy cycle plus a daily sense cycle, the T0–T4 guardrails, Langfuse, and a minimal Mission Control
  (goal, boardroom, experiments, approval inbox, cost). The first experiments are likely SEO prerender, own domain, a hosted AI quota and a daily hook.
- **Phase 2 ("it ships by itself"):** Dev/QA/Release pipeline with T1 auto-merge, outcome evals, Skeptic calibration, HR agent.
- **Phase 3 ("it can pivot"):** Pivot Review, Maverick + Researcher deep-dives, public results page, a second product adapter.
- **Milestones:** 10 DAU → results report → 100 DAU → report → 1,000 DAU.

---

## 10. Decisions so far (2026-11-22)

| # | Topic | Decision | Design consequence |
|---|---|---|---|
| D1 | LLM budget/provider | **User-selectable in the UI**: Free (Gemini free tier), Balanced (~$100–200/mo mixed), Max (best models). Support every major provider. | A model-router layer with per-role model profiles, a provider registry (Anthropic, OpenAI, Google, OpenRouter, local Ollama), per-role overrides, and live cost estimates in Settings. The daily cap is enforced by the CFO guardrail. |
| D2 | Autonomy | **T1 auto-merge** after QA and evals, with auto-rollback. **T2+ needs approval.** | The autonomy policy is per-tier config, editable in the UI (default: this). |
| D3 | DAU | **Engaged DAU**: a unique browser or account with a meaningful action that day (read >30s, quiz, mock, note, plan). | The first Viewinter experiment is instrumentation: an `active/{day}` rollup and a metrics adapter that reads it. |
| D4 | Runtime | **Local Mac first**, with deploy targets selectable in the UI: local, own server/VM (Docker Compose), or serverless (Cloud Run + managed Postgres + Langfuse Cloud). | A single container image, all config from env, a pluggable checkpointer (SQLite locally, Postgres elsewhere), and a "Runtime" settings page that generates the deploy bundle for each target. |

| D5 | Owner time, channels, hosted AI allowance | **Asked in the UI** (Setup wizard, editable in Settings). The hosted-AI step shows a live feasibility calculator. | Agents read these every cycle: owner minutes cap approvals/drafts, drafts only target chosen channels. |
| D6 | Domain | **Free hosting first** (Vercel/Netlify/Cloudflare Pages). Domain purchase is an analysed **Recommendation**, not an action. | Recommendations page: owner-only actions with analysis, impact/effort/cost. |
| D7 | Name | **GrowthLoop** | — |

## 11. v1 status (2026-11-22)

Built: LangGraph company graph (20 nodes, parallel ideation/validation, interrupt-based approvals, SQLite
checkpoints with retry-from-failure), 22 roles (12 active by default), model router (free/balanced/max/mock,
per-role overrides, real-model fallback chain, per-provider concurrency, budget guard, Langfuse optional), guardrails
(tiers with hard floors, policy patterns, loop guard, untrusted-content wrapping, protected paths), evals (LLM judge
per role rubric, work-product checks, Skeptic calibration, idea-source win rates), executor (spec-only or Claude Code
in a worktree + QA + PR), Mission Control UI (16 pages), Docker/compose/serverless docs, e2e test on mock models.

First real cycle (Gemini free tier, ~9 min, $0): 16 ideas → Skeptic killed 6 → CEO picked (1) engaged-DAU
instrumentation, (2) SPA meta tags + sitemap, (3) daily question widget. Specs are in the Inbox as build tasks.

Next: Postgres store + checkpointer for server/serverless, live web search key, Firestore metrics service account,
turn on `claude_code` executor once you're comfortable, Viewinter instrumentation PR (experiment 1).
