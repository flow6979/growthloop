// API types (mirroring backend/growthloop/api.py + db.py) and a tiny fetch client.

export type Tier = "T0" | "T1" | "T2" | "T3" | "T4";
export type AutonomyPolicy = "auto" | "approve" | "owner_posts";
export type ModelTier = "free" | "balanced" | "max" | "mock" | "custom";
export type RuntimeTarget = "local" | "server" | "serverless";
export type CycleKind = "daily" | "weekly" | "pivot";

export interface Goal {
  metric: string;
  definition: string;
  ladder: number[];
  target: number;
  current_7d: number | null;
  today: number | null;
  prev_7d: number | null;
  has_data: boolean;
  milestones_reached: number[];
}

export interface Cycle {
  id: string;
  product_id: string;
  kind: CycleKind | string;
  status: "running" | "waiting_approval" | "done" | "failed" | string;
  started_at: number;
  ended_at: number | null;
  memo: string | null;
  summary: CycleSummary | null;
  error: string | null;
  // added by /api/cycles
  cost?: number;
  tokens?: number;
  events?: number;
}

export interface Situation {
  summary: string;
  north_star_trend: "up" | "flat" | "down" | "unknown";
  biggest_bottleneck: string;
  data_gaps: string[];
}

export interface MarketScan {
  summary: string;
  competitors: string[];
  where_users_are: string[];
  pmf_signals: string[];
  sources?: string[];
}

export interface CycleSummary {
  kind?: string;
  ideas?: number;
  experiments?: number;
  notes?: string[];
  situation?: Situation | null;
  market?: MarketScan | null;
}

export interface Status {
  onboarded: boolean;
  loop_running: boolean;
  kill_switch: boolean;
  busy: boolean;
  current_cycle: Cycle | null;
  pending_inbox: number;
  product: { id: string; name: string; url: string | null; one_liner: string | null };
  goal: Goal;
  model_tier: ModelTier | null;
  spend_24h: number;
  budget_per_day: number;
  web_search: boolean;
}

export interface LoopSettings {
  daily_hour: number;
  weekly_day: string;
  stall_cycles_before_pivot: number;
  max_debate_turns?: number;
  max_ideas_per_cycle: number;
  max_experiments_per_cycle: number;
}

export interface HostedAiAllowance {
  decision: "yes" | "no" | "later" | "undecided";
  monthly_cap_usd: number;
}

export interface Settings {
  onboarded: boolean;
  active_product: string;
  owner_minutes_per_day: number;
  owner_channels: string[];
  model_tier: ModelTier;
  role_model_overrides: Record<string, string>;
  provider_keys_present: Record<string, boolean>;
  llm_budget_usd_per_day: number;
  hosted_ai_allowance: HostedAiAllowance;
  autonomy: Record<Tier, AutonomyPolicy>;
  dev_executor: "spec_only" | "claude_code";
  loop: LoopSettings;
  runtime_target: RuntimeTarget;
  kill_switch: boolean;
  price_overrides: Record<string, [number, number]> | null;
  role_active: Record<string, boolean> | null;
  prompt_overrides: Record<string, string> | null;
}

export interface Provider {
  label: string;
  env: string;
  models: string[];
  available: boolean;
}

export interface ProvidersResponse {
  providers: Record<string, Provider>;
  tiers: Record<string, { strong: string; fast: string }>;
  prices: Record<string, [number, number]>;
  price_overrides: Record<string, [number, number]>;
}

export interface Product {
  id: string;
  name: string;
  url?: string;
  repo?: string;
  local_path?: string;
  one_liner?: string;
  context?: string;
  north_star?: { metric: string; definition: string; ladder: number[] };
  guardrail_metrics?: string[];
  build?: { workdir?: string; commands?: string[] };
  deploy?: { kind?: string; free_options?: string[] };
  metrics?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface HostedAiEstimate {
  tokens_per_day: number;
  requests_per_day: number;
  monthly_cost_usd_paid_tier: number;
  fits_free_tier: boolean;
  max_dau_on_free_tier: number;
  verdict: string;
  assumptions: string;
}

export interface HostedAiParams {
  dau: number;
  mocks_per_user: number;
  asks_per_user: number;
  tokens_per_mock: number;
  tokens_per_ask: number;
  turns_per_mock: number;
  price_in: number;
  price_out: number;
  free_requests_per_day: number;
}

export type EventKind =
  | "llm" | "tool" | "info" | "error" | "guardrail" | "decision" | "node_start" | "node_end" | string;

export interface TraceEvent {
  id: number;
  cycle_id: string | null;
  ts: number;
  agent: string;
  node: string;
  kind: EventKind;
  content: string;
  data?: Record<string, unknown> | null; // not present on SSE events
  model: string | null;
  tokens_in?: number;
  tokens_out?: number;
  cost_usd: number;
  latency_ms: number;
}

export interface IdeaRow {
  id: string;
  cycle_id: string;
  product_id: string;
  source_agent: string;
  title: string;
  description: string;
  channel: string;
  status: "proposed" | "killed" | "parked" | "shortlisted" | "selected" | string;
  tier: Tier;
  scores: { impact?: number; confidence?: number; ease?: number } | null;
  predicted_lift: number | null;
  confidence: number | null;
  critique: string | null;
  created_at: number;
}

export interface SpecDoc {
  title: string;
  user_story: string;
  changes: string[];
  acceptance_criteria: string[];
  instrumentation: string[];
  rollout: string;
}

export interface Experiment {
  id: string;
  idea_id: string | null;
  product_id: string;
  cycle_id: string;
  title: string;
  hypothesis: string;
  metric: string;
  guardrail_metric: string | null;
  predicted_lift: number | null;
  confidence: number | null;
  window_days: number | null;
  status: string;
  spec: string | SpecDoc | null; // stored as a JSON string by the backend
  tier: Tier;
  pr_url: string | null;
  owner: string | null;
  started_at: number | null;
  ends_at: number | null;
  ended_at: number | null;
  baseline: number | null;
  actual_lift: number | null;
  result: { kill_criteria?: string; facts?: Record<string, unknown>; learning?: string } | null;
  created_at: number;
}

export interface Approval {
  id: string;
  cycle_id: string;
  kind: "experiment" | "build_task" | "post_draft" | string;
  tier: Tier | string;
  title: string;
  body: string;
  channel: string | null;
  payload: { experiment_id?: string; why?: string } | null;
  status: "pending" | "approved" | "rejected" | "done" | string;
  comment: string | null;
  created_at: number;
  decided_at: number | null;
}

export type DecisionAction = "approve" | "reject" | "posted" | "skipped" | "done";

export interface CycleDetail {
  cycle: Cycle;
  ideas: IdeaRow[];
  experiments: Experiment[];
  approvals: Approval[];
  evals: EvalRow[];
}

export interface Recommendation {
  id: string;
  product_id: string;
  title: string;
  category: string;
  analysis: string;
  impact: "low" | "medium" | "high" | string;
  effort: "low" | "medium" | "high" | string;
  cost: string;
  status: "open" | "accepted" | "dismissed" | "done";
  source_agent: string;
  created_at: number;
}

export interface MetricPoint { day: string; value: number; source: string }

export interface MetricsResponse {
  goal: Goal;
  series: Record<"dau" | "visitors" | "signups" | "views" | "sessions", MetricPoint[]>;
}

export interface EvalRow {
  id: number;
  ts: number;
  cycle_id: string | null;
  agent: string;
  suite: "agent_quality" | "work_product" | "calibration" | string;
  target_type: string;
  target_id: string;
  rubric: string;
  score: number;
  passed: number;
  reasoning: string;
  judge_model: string;
}

export interface EvalSummary {
  per_agent: { agent: string; suite: string; n: number; avg: number; passed: number }[];
  trend: { cycle_id: string; agent: string; avg: number; ts: number }[];
  calibration: { target_id: string; score: number; reasoning: string; ts: number }[];
  idea_sources: { agent: string; total: number; won: number; finished: number }[];
}

export interface CostRow { key: string | null; cost: number; tin: number; tout: number; calls: number }

export interface CostsResponse {
  by_agent: CostRow[];
  by_model: CostRow[];
  by_day: { day: string; cost: number; tokens: number; calls: number }[];
  spend_24h: number;
  budget_per_day: number;
}

export interface GuardrailLogRow {
  id: number; ts: number; cycle_id: string | null; agent: string; rule: string; action: string; detail: string;
}

export interface GuardrailsResponse {
  tiers: Record<Tier, string>;
  hard_floors: Partial<Record<Tier, AutonomyPolicy>>;
  autonomy: Partial<Record<Tier, AutonomyPolicy>>;
  banned_patterns: string[];
  log: GuardrailLogRow[];
}

export interface OrgRole {
  key: string;
  title: string;
  dept: string;
  core: boolean;
  active: boolean;
  context: "full" | "blind" | string;
  model_class: "strong" | "fast" | string;
  model: string;
  model_override: string | null;
  prompt: string;
  prompt_overridden: boolean;
  rubric: string[];
  eval_avg: number | null;
  eval_n: number;
}

export interface Learning {
  id: string; product_id: string; ts: number; text: string; source: string;
  experiment_id: string | null; tags: string[] | null;
}

export interface FeedbackRow {
  id: string; ts: number; author: string; text: string; rating: number | null; page: string;
  status: string; response: string;
}

export interface RuntimeTargets {
  current: RuntimeTarget;
  targets: Record<RuntimeTarget, { label: string; cost: string; how: string; notes: string }>;
}

export interface PublicResults {
  product: string;
  goal: Goal;
  dau: MetricPoint[];
  experiments: Pick<Experiment, "title" | "hypothesis" | "status" | "actual_lift" | "predicted_lift" |
    "window_days" | "created_at">[];
  milestones: { text: string; ts: number }[];
  cycles: number;
  learnings: { text: string; ts: number }[];
}

// ---------------- client ----------------

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** True when the request never reached the backend (backend down / proxy error). */
export function isNetworkError(e: unknown): boolean {
  return e instanceof TypeError || (e instanceof ApiError && (e.status === 502 || e.status === 503 || e.status === 504));
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const j = await res.json();
      if (j && typeof j.detail === "string") msg = j.detail;
      else if (j && j.detail) msg = JSON.stringify(j.detail);
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const api = {
  status: () => request<Status>("GET", "/api/status"),
  settings: () => request<Settings>("GET", "/api/settings"),
  putSettings: (body: Partial<Settings>) => request<Settings>("PUT", "/api/settings", body),
  onboarding: (body: Partial<Settings>) => request<Status>("POST", "/api/onboarding", body),
  providers: () => request<ProvidersResponse>("GET", "/api/providers"),
  products: () => request<Product[]>("GET", "/api/products"),
  hostedEstimate: (p: Partial<HostedAiParams>) =>
    request<HostedAiEstimate>("GET", `/api/hosted-ai/estimate${qs(p as Record<string, number>)}`),

  loopStart: () => request<Status>("POST", "/api/loop/start"),
  loopPause: () => request<Status>("POST", "/api/loop/pause"),
  kill: (on: boolean) => request<Status>("POST", "/api/kill", { on }),
  runCycle: (kind: CycleKind) => request<{ cycle_id: string }>("POST", "/api/cycles/run", { kind }),

  cycles: (limit = 50) => request<Cycle[]>("GET", `/api/cycles${qs({ limit })}`),
  cycle: (id: string) => request<CycleDetail>("GET", `/api/cycles/${encodeURIComponent(id)}`),

  events: (f: { cycle_id?: string; kind?: string; agent?: string; after?: number; limit?: number }) =>
    request<TraceEvent[]>("GET", `/api/events${qs(f)}`),

  ideas: (status?: string) => request<IdeaRow[]>("GET", `/api/ideas${qs({ status })}`),
  experiments: () => request<Experiment[]>("GET", "/api/experiments"),
  patchExperiment: (id: string, body: { status?: string; pr_url?: string }) =>
    request<Experiment>("PATCH", `/api/experiments/${encodeURIComponent(id)}`, body),

  approvals: (status: "pending" | "all" | string = "pending") =>
    request<Approval[]>("GET", `/api/approvals${qs({ status })}`),
  decide: (id: string, action: DecisionAction, comment = "") =>
    request<Approval>("POST", `/api/approvals/${encodeURIComponent(id)}`, { action, comment }),

  recommendations: () => request<Recommendation[]>("GET", "/api/recommendations"),
  updateRecommendation: (id: string, status: Recommendation["status"]) =>
    request<Recommendation>("POST", `/api/recommendations/${encodeURIComponent(id)}`, { status }),

  metrics: () => request<MetricsResponse>("GET", "/api/metrics"),
  addMetric: (m: { day?: string; name?: string; value: number }) => request<MetricsResponse>("POST", "/api/metrics", m),
  syncMetrics: () => request<{ ok: boolean; detail: string }>("POST", "/api/metrics/sync"),

  evalsSummary: () => request<EvalSummary>("GET", "/api/evals/summary"),
  evals: (agent?: string) => request<EvalRow[]>("GET", `/api/evals${qs({ agent })}`),
  costs: () => request<CostsResponse>("GET", "/api/costs"),
  guardrails: () => request<GuardrailsResponse>("GET", "/api/guardrails"),

  org: () => request<OrgRole[]>("GET", "/api/org"),
  updateRole: (role: string, body: { active?: boolean; model?: string; prompt?: string }) =>
    request<OrgRole>("PUT", `/api/org/${encodeURIComponent(role)}`, body),

  learnings: () => request<Learning[]>("GET", "/api/learnings"),
  addLearning: (text: string) => request<Learning>("POST", "/api/learnings", { text }),
  feedback: () => request<FeedbackRow[]>("GET", "/api/feedback"),
  addFeedback: (b: { text: string; rating?: number | null; page?: string }) =>
    request<FeedbackRow>("POST", "/api/feedback", b),

  publicResults: () => request<PublicResults>("GET", "/api/public/results"),
  runtimeTargets: () => request<RuntimeTargets>("GET", "/api/runtime/targets"),
};

// ---------------- helpers ----------------

export function parseSpec(spec: Experiment["spec"]): SpecDoc | null {
  if (!spec) return null;
  if (typeof spec === "object") return spec;
  try {
    const v = JSON.parse(spec);
    return typeof v === "object" && v ? (v as SpecDoc) : null;
  } catch {
    return null;
  }
}

export const CHANNELS = [
  "linkedin", "youtube", "x", "whatsapp", "instagram", "reddit", "college-groups", "telegram", "discord", "email",
  "blog",
] as const;

export const TIERS: Tier[] = ["T0", "T1", "T2", "T3", "T4"];
