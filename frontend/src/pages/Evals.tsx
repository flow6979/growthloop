import { useMemo, useState } from "react";
import { api, type EvalRow, type EvalSummary } from "../api";
import { fmtTime, useAsync } from "../lib";
import { Async, Badge, Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { LineChart, Sparkline } from "../components/charts";

const SUITES = ["agent_quality", "work_product", "calibration"];

export default function Evals() {
  const sum = useAsync<EvalSummary>(() => api.evalsSummary(), [], 30000);
  const [agent, setAgent] = useState("");
  const rows = useAsync<EvalRow[]>(() => api.evals(agent || undefined), [agent]);

  return (
    <div className="page">
      <PageHeader title="Evals" sub="Three layers: LLM-judge agent quality, deterministic work-product checks, and outcomes (calibration, win rates)." />
      <Async state={sum} empty={(d) => (d.per_agent.length === 0 ? <Empty title="No evals yet">Evals run at the end of each cycle.</Empty> : null)}>
        {(d) => <SummaryView d={d} onPick={setAgent} />}
      </Async>
      <Card title="Raw eval rows" pad={false}
        actions={<select value={agent} onChange={(e) => setAgent(e.target.value)}>
          <option value="">all agents</option>
          {[...new Set((sum.data?.per_agent ?? []).map((r) => r.agent))].map((a) => <option key={a}>{a}</option>)}
        </select>}>
        {rows.error ? <div className="card-body"><ErrorBox error={rows.error} onRetry={rows.reload} /></div> : null}
        {!rows.data ? (rows.error ? null : <Loading />) : rows.data.length === 0 ? <Empty title="No rows" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Agent</th><th>Suite</th><th>Target</th><th>Score</th><th>Pass</th><th>Reasoning</th></tr></thead>
              <tbody>
                {rows.data.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap small">{fmtTime(r.ts)}</td>
                    <td>{r.agent}</td>
                    <td><Badge tone="gray">{r.suite}</Badge></td>
                    <td className="small muted">{r.target_type}</td>
                    <td className="mono"><ScoreCell v={r.score} /></td>
                    <td>{r.passed ? <Badge tone="green">pass</Badge> : <Badge tone="red">fail</Badge>}</td>
                    <td className="small">
                      <details>
                        <summary className="clamp-1">{r.reasoning}</summary>
                        <div className="stack-s" style={{ marginTop: 6 }}>
                          <div>{r.reasoning}</div>
                          <div className="muted"><strong>Rubric:</strong><pre className="code code-inline">{r.rubric}</pre></div>
                          {r.judge_model && <div className="muted tiny">judge: {r.judge_model}</div>}
                        </div>
                      </details>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function ScoreCell({ v }: { v: number | null }) {
  if (v == null) return <span className="muted">—</span>;
  const tone = v >= 0.7 ? "pos" : v >= 0.5 ? "warn" : "neg";
  return <span className={tone}>{v.toFixed(2)}</span>;
}

function SummaryView({ d, onPick }: { d: EvalSummary; onPick: (a: string) => void }) {
  const agents = useMemo(() => [...new Set(d.per_agent.map((r) => r.agent))].sort(), [d]);
  const cell = (a: string, s: string) => d.per_agent.find((r) => r.agent === a && r.suite === s);
  const trend = (a: string) => d.trend.filter((t) => t.agent === a).map((t) => t.avg);

  return (
    <div className="stack">
      <Card title="Per-agent scores" pad={false}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Agent</th>{SUITES.map((s) => <th key={s}>{s.replace("_", " ")}</th>)}<th>Quality trend</th></tr>
            </thead>
            <tbody>
              {agents.map((a) => (
                <tr key={a} className="clickable" onClick={() => onPick(a)}>
                  <td><strong>{a}</strong></td>
                  {SUITES.map((s) => {
                    const c = cell(a, s);
                    return (
                      <td key={s} className="mono">
                        {c ? <><ScoreCell v={c.avg} /> <span className="muted tiny">({c.passed}/{c.n} pass)</span></> : <span className="muted">—</span>}
                      </td>
                    );
                  })}
                  <td><Sparkline values={trend(a)} max={1} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid-2">
        <Card title="Skeptic calibration (1 − Brier, higher is better)">
          {d.calibration.length === 0 ? (
            <div className="muted small">No finished experiments yet. Calibration compares the Skeptic's predicted probability of success with real outcomes.</div>
          ) : (
            <>
              <LineChart points={d.calibration.map((c, i) => ({ x: `#${i + 1} ${new Date(c.ts * 1000).toISOString().slice(0, 10)}`, y: c.score }))}
                yMax={1} refLine={0.75} refLabel="good (Brier < 0.25)" format={(v) => v.toFixed(2)} height={160} />
              <div className="stack-s small" style={{ marginTop: 8 }}>
                {[...d.calibration].reverse().slice(0, 8).map((c, i) => (
                  <div key={i} className="row gap-s"><ScoreCell v={c.score} /><span className="muted">{c.reasoning}</span></div>
                ))}
              </div>
            </>
          )}
        </Card>
        <Card title="Idea-source win rates">
          {d.idea_sources.length === 0 ? <div className="muted small">No experiments traced to an idea source yet.</div> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Source</th><th>Experiments</th><th>Finished</th><th>Won</th><th>Win rate</th></tr></thead>
                <tbody>
                  {[...d.idea_sources].sort((a, b) => rate(b) - rate(a)).map((s) => (
                    <tr key={s.agent}>
                      <td>{s.agent}</td><td>{s.total}</td><td>{s.finished}</td><td>{s.won}</td>
                      <td>
                        {s.finished ? (
                          <div className="row gap-s"><div className="mini-bar"><div style={{ width: `${rate(s) * 100}%` }} /></div><span className="mono small">{Math.round(rate(s) * 100)}%</span></div>
                        ) : <span className="muted small">pending</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const rate = (s: { won: number; finished: number }) => (s.finished ? s.won / s.finished : 0);

