import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  api, CHANNELS, TIERS, type AutonomyPolicy, type GuardrailsResponse, type HostedAiEstimate, type HostedAiParams,
  type ModelTier, type ProvidersResponse, type RuntimeTargets, type Settings, type Tier,
} from "../api";
import { errMsg, fmtUsd, useAsync } from "../lib";
import { Badge, ErrorBox, Field, Loading } from "./ui";

export interface FormProps {
  value: Settings;
  onChange: (patch: Partial<Settings>) => void;
}

// ---------------- owner time ----------------
export function OwnerTimeForm({ value, onChange }: FormProps) {
  const mins = value.owner_minutes_per_day ?? 20;
  const approvals = Math.max(0, Math.floor(mins / 5));
  const posts = Math.max(1, Math.min(7, Math.floor(mins / 10)));
  return (
    <div className="stack">
      <Field label="How many minutes a day can you spend on approvals and posting?"
        hint="This caps how many approval and post items the agents create each cycle.">
        <div className="row gap">
          <input type="range" min={5} max={120} step={5} value={mins}
            onChange={(e) => onChange({ owner_minutes_per_day: Number(e.target.value) })} className="grow" />
          <input type="number" min={0} max={480} value={mins} className="w-num"
            onChange={(e) => onChange({ owner_minutes_per_day: Number(e.target.value) || 0 })} />
          <span className="muted">min/day</span>
        </div>
      </Field>
      <div className="callout">
        <div><strong>Rule of thumb the agents use:</strong> ~5 min per approval (T2/T4), ~10 min per post (T3).</div>
        <div className="muted">
          With {mins} min/day: up to ~{approvals} approvals <em>or</em> ~{posts} post draft{posts === 1 ? "" : "s"} per cycle.
          The CEO is told this budget when it picks experiments.
        </div>
      </div>
    </div>
  );
}

// ---------------- channels ----------------
export function ChannelsForm({ value, onChange }: FormProps) {
  const sel = new Set(value.owner_channels ?? []);
  const toggle = (c: string) => {
    const n = new Set(sel);
    if (n.has(c)) n.delete(c);
    else n.add(c);
    onChange({ owner_channels: CHANNELS.filter((x) => n.has(x)) });
  };
  return (
    <div className="stack">
      <p className="muted">
        Pick the channels <strong>you</strong> will personally post on. Agents only <em>draft</em> posts for these
        channels; you copy, post and mark them done in the Inbox. Nothing is ever auto-posted (LinkedIn and Reddit
        actively hunt automated posting, and it would put your accounts at risk).
      </p>
      <div className="choice-grid">
        {CHANNELS.map((c) => (
          <label key={c} className={`choice ${sel.has(c) ? "on" : ""}`}>
            <input type="checkbox" checked={sel.has(c)} onChange={() => toggle(c)} />
            {c}
          </label>
        ))}
      </div>
      {sel.size === 0 && <div className="muted small">No channels selected: the content step is skipped each cycle.</div>}
    </div>
  );
}

// ---------------- models ----------------
const TIER_CARDS: { key: ModelTier; title: string; desc: string; cost: string; provider: string }[] = [
  { key: "free", title: "Free", desc: "Gemini free tier (Flash + Flash-Lite)", cost: "$0 within quota", provider: "google_genai" },
  { key: "balanced", title: "Balanced", desc: "Claude Sonnet for judgement, Haiku for drafting", cost: "~$3–7/day", provider: "anthropic" },
  { key: "max", title: "Max", desc: "Claude Opus for judgement, Sonnet for drafting", cost: "Highest quality, $$", provider: "anthropic" },
  { key: "mock", title: "Mock", desc: "Offline placeholder output, no AI", cost: "$0, for demos/tests", provider: "mock" },
];

export function ModelsForm({ value, onChange, providers }: FormProps & { providers?: ProvidersResponse }) {
  return (
    <div className="stack">
      <div className="tier-cards">
        {TIER_CARDS.map((t) => {
          const p = providers?.providers[t.provider];
          const models = providers?.tiers[t.key];
          return (
            <button type="button" key={t.key} className={`tier-card ${value.model_tier === t.key ? "on" : ""}`}
              onClick={() => onChange({ model_tier: t.key })}>
              <div className="row between">
                <strong>{t.title}</strong>
                {p && (p.available ? <Badge tone="green">key ok</Badge> : <Badge tone="amber">no key</Badge>)}
              </div>
              <div className="small">{t.desc}</div>
              <div className="muted small">{t.cost}</div>
              {models && (
                <div className="mono tiny muted">
                  strong: {models.strong.split(":")[1]}<br />fast: {models.fast.split(":")[1]}
                </div>
              )}
            </button>
          );
        })}
      </div>
      {value.model_tier === "custom" && (
        <div className="muted small">Tier is "custom": per-role overrides on the Org page decide the models.</div>
      )}
      <Field label="Daily LLM budget (USD)"
        hint="Enforced by the CFO guardrail on paid tiers: calls are blocked once 24h spend reaches this. 0 = free-tier only.">
        <div className="row gap">
          <span className="muted">$</span>
          <input type="number" min={0} step={0.5} className="w-num" value={value.llm_budget_usd_per_day ?? 0}
            onChange={(e) => onChange({ llm_budget_usd_per_day: Number(e.target.value) || 0 })} />
          <span className="muted">per day</span>
        </div>
      </Field>
      <ProviderTable providers={providers} />
      <div className="muted small">
        Per-role model overrides (e.g. give the Skeptic Opus while everyone else stays on Free) are on the{" "}
        <Link to="/org">Org page</Link>.
      </div>
    </div>
  );
}

export function ProviderTable({ providers }: { providers?: ProvidersResponse }) {
  if (!providers) return <Loading label="Checking providers…" />;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr><th>Provider</th><th>Status</th><th>Env var</th></tr>
        </thead>
        <tbody>
          {Object.entries(providers.providers).map(([k, p]) => (
            <tr key={k}>
              <td>{p.label}</td>
              <td>{p.available ? <Badge tone="green">available</Badge> : <Badge tone="gray">not configured</Badge>}</td>
              <td className="mono small">{p.env ? (p.available ? p.env : <>set <code>{p.env}</code> in .env</>) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------- hosted AI allowance ----------------
const EST_DEFAULTS: HostedAiParams = {
  dau: 10, mocks_per_user: 0.5, asks_per_user: 3, tokens_per_mock: 30000, tokens_per_ask: 3000, turns_per_mock: 20,
  price_in: 0.1, price_out: 0.4, free_requests_per_day: 1000,
};

const EST_FIELDS: { key: keyof HostedAiParams; label: string; step: number }[] = [
  { key: "dau", label: "Expected DAU", step: 1 },
  { key: "mocks_per_user", label: "Mock interviews / user / day", step: 0.1 },
  { key: "asks_per_user", label: "Ask-AI questions / user / day", step: 0.5 },
  { key: "price_in", label: "Price in ($/1M tokens)", step: 0.01 },
  { key: "price_out", label: "Price out ($/1M tokens)", step: 0.01 },
  { key: "free_requests_per_day", label: "Free-tier requests / day", step: 50 },
  { key: "tokens_per_mock", label: "Tokens per mock", step: 1000 },
  { key: "tokens_per_ask", label: "Tokens per ask", step: 500 },
  { key: "turns_per_mock", label: "Requests per mock (turns)", step: 1 },
];

export function HostedAiForm({ value, onChange, productName = "the product" }: FormProps & { productName?: string }) {
  const [params, setParams] = useState<HostedAiParams>(EST_DEFAULTS);
  const [est, setEst] = useState<HostedAiEstimate | null>(null);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => {
    const t = window.setTimeout(() => {
      api.hostedEstimate(params).then((r) => { setEst(r); setErr(null); }).catch(setErr);
    }, 250);
    return () => window.clearTimeout(t);
  }, [params]);

  const allowance = value.hosted_ai_allowance ?? { decision: "undecided", monthly_cap_usd: 0 };
  return (
    <div className="stack">
      <div className="callout callout-warn">
        <strong>The problem:</strong> today {productName}'s AI features (mock interviews, Ask-AI) only work if each user
        brings their own Gemini API key. Getting a key is a big activation cliff, so most visitors never try the best
        feature. A small hosted allowance (your key behind a proxy with per-user rate limits) would remove that cliff,
        but it costs you quota or money. Estimate it here.
      </div>
      <div className="grid-3">
        {EST_FIELDS.map((f) => (
          <Field key={f.key} label={f.label}>
            <input type="number" step={f.step} min={0} value={params[f.key]}
              onChange={(e) => setParams((p) => ({ ...p, [f.key]: Number(e.target.value) || 0 }))} />
          </Field>
        ))}
      </div>
      {err ? <ErrorBox error={err} /> : null}
      {est && (
        <div className={`callout ${est.fits_free_tier ? "callout-ok" : "callout-warn"}`}>
          <div className="stats-row">
            <div><div className="muted tiny">Requests/day</div><strong>{est.requests_per_day.toLocaleString()}</strong></div>
            <div><div className="muted tiny">Tokens/day</div><strong>{est.tokens_per_day.toLocaleString()}</strong></div>
            <div><div className="muted tiny">Paid tier / month</div><strong>{fmtUsd(est.monthly_cost_usd_paid_tier, 2)}</strong></div>
            <div><div className="muted tiny">Max DAU on free tier</div><strong>{est.max_dau_on_free_tier.toLocaleString()}</strong></div>
          </div>
          <div style={{ marginTop: 8 }}><strong>Verdict:</strong> {est.verdict}</div>
          <div className="muted tiny">{est.assumptions}</div>
        </div>
      )}
      <Field label="Is this feasible for you?">
        <div className="seg">
          {(["yes", "no", "later"] as const).map((d) => (
            <button type="button" key={d} className={allowance.decision === d ? "on" : ""}
              onClick={() => onChange({ hosted_ai_allowance: { ...allowance, decision: d } })}>
              {d === "yes" ? "Yes, fund it" : d === "no" ? "No" : "Decide later"}
            </button>
          ))}
        </div>
      </Field>
      {allowance.decision === "yes" && (
        <Field label="Monthly cap (USD)" hint="Agents will design the hosted proxy to stay under this.">
          <div className="row gap">
            <span className="muted">$</span>
            <input type="number" min={0} className="w-num" value={allowance.monthly_cap_usd}
              onChange={(e) => onChange({ hosted_ai_allowance: { ...allowance, monthly_cap_usd: Number(e.target.value) || 0 } })} />
            <span className="muted">/ month</span>
          </div>
        </Field>
      )}
    </div>
  );
}

// ---------------- autonomy ----------------
const POLICY_LABEL: Record<AutonomyPolicy, string> = {
  auto: "Auto (agents proceed)", approve: "Needs my approval", owner_posts: "I do it myself",
};

export function AutonomyForm({ value, onChange }: FormProps) {
  const g = useAsync<GuardrailsResponse>(() => api.guardrails(), []);
  const autonomy = value.autonomy ?? ({} as Settings["autonomy"]);
  const floors = g.data?.hard_floors ?? { T3: "owner_posts", T4: "approve" };
  return (
    <div className="stack">
      {g.error ? <ErrorBox error={g.error} /> : null}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Tier</th><th>What it covers</th><th>Policy</th></tr></thead>
          <tbody>
            {TIERS.map((t: Tier) => {
              const locked = floors[t];
              const cur = locked ?? autonomy[t] ?? "approve";
              return (
                <tr key={t}>
                  <td><Badge>{t}</Badge></td>
                  <td className="small">{g.data?.tiers[t] ?? ""}</td>
                  <td>
                    {locked ? (
                      <span className="row gap-s"><Badge>{locked}</Badge><span className="muted tiny">🔒 hard floor</span></span>
                    ) : (
                      <select value={cur} onChange={(e) => onChange({ autonomy: { ...autonomy, [t]: e.target.value as AutonomyPolicy } })}>
                        <option value="auto">{POLICY_LABEL.auto}</option>
                        <option value="approve">{POLICY_LABEL.approve}</option>
                      </select>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted small">T3 (public voice) is always posted by you, and T4 (money, legal, identity) always needs approval. These floors are code, not settings.</div>
      <Field label="Developer executor" hint="What happens after a spec is approved.">
        <div className="seg">
          <button type="button" className={value.dev_executor !== "claude_code" ? "on" : ""}
            onClick={() => onChange({ dev_executor: "spec_only" })}>Spec only (I build it)</button>
          <button type="button" className={value.dev_executor === "claude_code" ? "on" : ""}
            onClick={() => onChange({ dev_executor: "claude_code" })}>Claude Code opens PRs</button>
        </div>
      </Field>
      {value.dev_executor === "claude_code" && (
        <div className="callout callout-err">
          <strong>Warning:</strong> with <code>claude_code</code>, an agent writes code on a branch of the product repo,
          runs the build/tests and <strong>opens pull requests</strong> on it. T1 changes that pass QA may be
          auto-merged if T1 is set to Auto. Make sure the repo has branch protection and you review PRs.
        </div>
      )}
    </div>
  );
}

// ---------------- runtime ----------------
export function RuntimeForm({ value, onChange }: FormProps) {
  const rt = useAsync<RuntimeTargets>(() => api.runtimeTargets(), []);
  if (!rt.data) return rt.error ? <ErrorBox error={rt.error} onRetry={rt.reload} /> : <Loading />;
  return (
    <div className="stack">
      {(Object.entries(rt.data.targets) as [Settings["runtime_target"], RuntimeTargets["targets"]["local"]][]).map(([k, t]) => (
        <label key={k} className={`radio-card ${value.runtime_target === k ? "on" : ""}`}>
          <input type="radio" name="runtime" checked={value.runtime_target === k} onChange={() => onChange({ runtime_target: k })} />
          <div className="grow">
            <div className="row between"><strong>{t.label}</strong><span className="muted small">{t.cost}</span></div>
            <pre className="code code-inline">{t.how}</pre>
            <div className="muted small">{t.notes}</div>
          </div>
        </label>
      ))}
    </div>
  );
}

export function useSettingsDraft() {
  const s = useAsync<Settings>(() => api.settings(), []);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (s.data && !dirty) setDraft(s.data);
  }, [s.data, dirty]);
  const patch = (p: Partial<Settings>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
  };
  return { remote: s, draft, patch, dirty, setDirty, errText: s.error ? errMsg(s.error) : "" };
}
