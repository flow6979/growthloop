import { Fragment, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, type Cycle, type TraceEvent } from "../api";
import { fmtMs, fmtTime, fmtTokens, fmtUsd, useAsync } from "../lib";
import { Badge, Card, Empty, ErrorBox, JsonView, Loading, PageHeader } from "../components/ui";

const KINDS = ["llm", "tool", "info", "error", "guardrail", "decision", "node_start", "node_end"];
const AGENTS = [
  "system", "owner", "ceo", "cfo", "chief_of_staff", "dreamer", "maverick", "skeptic", "researcher", "pm",
  "ux_researcher", "designer", "cto", "developer", "qa", "sre", "growth_analyst", "marketing", "community", "sales",
  "support", "hr", "trust_safety", "judge",
];

export default function Traces() {
  const [sp, setSp] = useSearchParams();
  const cycle_id = sp.get("cycle_id") ?? "";
  const kind = sp.get("kind") ?? "";
  const agent = sp.get("agent") ?? "";
  const limit = Number(sp.get("limit") ?? 300);
  const cycles = useAsync<Cycle[]>(() => api.cycles(100), []);
  const ev = useAsync<TraceEvent[]>(() => api.events({ cycle_id, kind, agent, limit }), [cycle_id, kind, agent, limit]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");

  const set = (k: string, v: string) => {
    const n = new URLSearchParams(sp);
    if (v) n.set(k, v);
    else n.delete(k);
    setSp(n, { replace: true });
  };
  const toggle = (id: number) => setOpen((o) => {
    const n = new Set(o);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });

  const rows = [...(ev.data ?? [])].reverse().filter((e) => !q || `${e.content} ${e.agent} ${e.node} ${e.model}`.toLowerCase().includes(q.toLowerCase()));
  const totals = rows.reduce((a, e) => ({ cost: a.cost + (e.cost_usd || 0), tin: a.tin + (e.tokens_in || 0), tout: a.tout + (e.tokens_out || 0) }), { cost: 0, tin: 0, tout: 0 });

  return (
    <div className="page">
      <PageHeader title="Traces" sub="Every event the company emitted, with full prompts and structured outputs for LLM calls." />
      <div className="callout small">
        If <code>LANGFUSE_PUBLIC_KEY</code> / <code>LANGFUSE_SECRET_KEY</code> are configured on the backend, the same traces
        also go to Langfuse for deeper analysis. This view reads the local SQLite trace.
      </div>
      <Card pad={false}>
        <div className="filters">
          <select value={cycle_id} onChange={(e) => set("cycle_id", e.target.value)}>
            <option value="">all cycles</option>
            {(cycles.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.id} · {c.kind} · {fmtTime(c.started_at)}</option>)}
          </select>
          <select value={kind} onChange={(e) => set("kind", e.target.value)}>
            <option value="">all kinds</option>
            {KINDS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <select value={agent} onChange={(e) => set("agent", e.target.value)}>
            <option value="">all agents</option>
            {AGENTS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <select value={limit} onChange={(e) => set("limit", e.target.value)}>
            {[100, 300, 1000, 3000].map((n) => <option key={n} value={n}>latest {n}</option>)}
          </select>
          <input placeholder="Search content…" value={q} onChange={(e) => setQ(e.target.value)} className="grow" />
          <button className="btn btn-sm" onClick={ev.reload}>Refresh</button>
        </div>
        <div className="filters-summary muted small">
          {rows.length} events · {fmtUsd(totals.cost)} · {fmtTokens(totals.tin)} in / {fmtTokens(totals.tout)} out
        </div>
        {ev.error ? <div className="card-body"><ErrorBox error={ev.error} onRetry={ev.reload} /></div> : null}
        {!ev.data ? (ev.error ? null : <Loading />) : rows.length === 0 ? <Empty title="No events match" /> : (
          <div className="table-wrap">
            <table className="table table-traces">
              <thead><tr><th /><th>Time</th><th>Kind</th><th>Agent</th><th>Node</th><th>Content</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Latency</th></tr></thead>
              <tbody>
                {rows.map((e) => {
                  const isOpen = open.has(e.id);
                  return (
                    <Fragment key={e.id}>
                      <tr className={`clickable kind-${e.kind}`} onClick={() => toggle(e.id)}>
                        <td className="muted">{isOpen ? "▾" : "▸"}</td>
                        <td className="nowrap small mono">{fmtTime(e.ts)}</td>
                        <td><Badge>{e.kind}</Badge></td>
                        <td>{e.agent}</td>
                        <td className="muted small">{e.node}</td>
                        <td className="small"><div className="clamp-2">{e.content}</div></td>
                        <td className="small mono nowrap">{e.model ? e.model.split(":").pop() : ""}</td>
                        <td className="small mono nowrap">{e.tokens_in || e.tokens_out ? `${fmtTokens(e.tokens_in)}/${fmtTokens(e.tokens_out)}` : ""}</td>
                        <td className="small mono nowrap">{e.cost_usd ? fmtUsd(e.cost_usd) : ""}</td>
                        <td className="small mono nowrap">{e.latency_ms ? fmtMs(e.latency_ms) : ""}</td>
                      </tr>
                      {isOpen && (
                        <tr className="trace-detail">
                          <td colSpan={10}><TraceDetail e={e} /></td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function TraceDetail({ e }: { e: TraceEvent }) {
  const d = (e.data ?? {}) as Record<string, unknown>;
  const { system, user, output, ...rest } = d;
  return (
    <div className="stack-s">
      <div className="kv-grid small">
        <div><span>Event id</span>{e.id}</div>
        <div><span>Cycle</span>{e.cycle_id ?? "—"}</div>
        <div><span>Model</span>{e.model || "—"}</div>
        <div><span>Tokens in / out</span>{e.tokens_in ?? 0} / {e.tokens_out ?? 0}</div>
        <div><span>Cost</span>{fmtUsd(e.cost_usd)}</div>
        <div><span>Latency</span>{fmtMs(e.latency_ms)}</div>
      </div>
      <div><div className="label">Content</div><pre className="code">{e.content}</pre></div>
      {typeof system === "string" && <div><div className="label">System prompt</div><pre className="code">{system}</pre></div>}
      {typeof user === "string" && <div><div className="label">User prompt</div><pre className="code">{user}</pre></div>}
      {output !== undefined && <div><div className="label">Structured output</div><JsonView value={output} /></div>}
      {Object.keys(rest).length > 0 && <div><div className="label">Data</div><JsonView value={rest} /></div>}
    </div>
  );
}
