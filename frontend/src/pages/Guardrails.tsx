import { useState } from "react";
import { Link } from "react-router-dom";
import { api, TIERS, type GuardrailsResponse } from "../api";
import { fmtTime, useAsync } from "../lib";
import { Async, Badge, Card, Empty, PageHeader } from "../components/ui";

export default function Guardrails() {
  const g = useAsync<GuardrailsResponse>(() => api.guardrails(), [], 30000);
  const [action, setAction] = useState("");
  return (
    <div className="page">
      <PageHeader title="Guardrails" sub="Hard rules in code that no agent (including HR) can change. Autonomy is editable in Settings."
        actions={<Link to="/settings" className="btn btn-sm">Edit autonomy</Link>} />
      <Async state={g}>
        {(d) => {
          const actions = [...new Set(d.log.map((l) => l.action))];
          const log = d.log.filter((l) => !action || l.action === action);
          return (
            <div className="stack">
              <Card title="Risk tiers & autonomy" pad={false}>
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Tier</th><th>Covers</th><th>Policy</th><th /></tr></thead>
                    <tbody>
                      {TIERS.map((t) => {
                        const floor = d.hard_floors[t];
                        const pol = floor ?? d.autonomy[t] ?? "approve";
                        return (
                          <tr key={t}>
                            <td><Badge>{t}</Badge></td>
                            <td className="small">{d.tiers[t]}</td>
                            <td><Badge>{pol}</Badge></td>
                            <td className="muted tiny">{floor ? "🔒 hard floor" : "owner setting"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
              <div className="grid-2">
                <Card title="Banned patterns (deterministic block)">
                  <div className="row gap-s wrap">
                    {d.banned_patterns.map((p) => <Badge key={p} tone="red">{p}</Badge>)}
                  </div>
                  <p className="muted small" style={{ marginTop: 10 }}>
                    Every idea and draft is regex-checked before the LLM Trust &amp; Safety review. A hit blocks it outright.
                  </p>
                </Card>
                <Card title="Other hard rules">
                  <ul className="small">
                    <li>Agents draft; the owner posts. No automated posting or DMs, ever.</li>
                    <li>Daily LLM budget: calls are blocked once 24h spend reaches it (paid tiers).</li>
                    <li>Kill switch stops the loop and blocks every LLM call.</li>
                    <li>Ideas too similar to previously killed ideas are dropped (loop guard).</li>
                    <li>Web and user text is wrapped as untrusted data and stripped of instruction-like markers.</li>
                    <li>Developer PRs that touch protected paths are blocked.</li>
                  </ul>
                </Card>
              </div>
              <Card title={`Blocked / flagged actions (${d.log.length})`} pad={false}
                actions={actions.length > 1 ? (
                  <select value={action} onChange={(e) => setAction(e.target.value)}>
                    <option value="">all actions</option>
                    {actions.map((a) => <option key={a}>{a}</option>)}
                  </select>
                ) : undefined}>
                {log.length === 0 ? <Empty title="Nothing blocked yet">Guardrail hits show up here with the rule and the reason.</Empty> : (
                  <div className="table-wrap">
                    <table className="table">
                      <thead><tr><th>When</th><th>Agent</th><th>Rule</th><th>Action</th><th>Detail</th><th>Cycle</th></tr></thead>
                      <tbody>
                        {log.map((l) => (
                          <tr key={l.id}>
                            <td className="nowrap small">{fmtTime(l.ts)}</td>
                            <td>{l.agent}</td>
                            <td className="mono small">{l.rule}</td>
                            <td><Badge tone={l.action === "blocked" ? "red" : "amber"}>{l.action}</Badge></td>
                            <td className="small">{l.detail}</td>
                            <td className="small">{l.cycle_id ? <Link to={`/boardroom/${l.cycle_id}`}>open</Link> : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>
          );
        }}
      </Async>
    </div>
  );
}
