import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Cycle, type CycleDetail, type IdeaRow } from "../api";
import { fmtAgo, fmtProb, fmtPct, fmtTime, fmtTokens, fmtUsd, useAsync } from "../lib";
import { Async, Badge, Card, Collapsible, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";

const SOURCE_LABEL: Record<string, string> = {
  dreamer: "Dreamer (blind, raw ideas)", maverick: "Maverick (out-of-the-box)", pm: "Product Manager",
  marketing: "Marketing / Content",
};
const STATUS_ORDER: Record<string, number> = { selected: 0, shortlisted: 1, parked: 2, proposed: 3, killed: 4 };

export default function Boardroom() {
  const { id } = useParams();
  const nav = useNavigate();
  const cycles = useAsync<Cycle[]>(() => api.cycles(50), [], 10000);
  const selected = id ?? cycles.data?.[0]?.id;

  return (
    <div className="page">
      <PageHeader title="Boardroom" sub="Why the company did what it did: situation, market, every idea, the Skeptic's scores and the CEO's picks." />
      <div className="split">
        <Card title="Cycles" pad={false} className="split-list">
          <Async state={cycles} empty={(d) => (d.length ? null : <Empty title="No cycles yet">Run one from the top bar.</Empty>)}>
            {(rows) => (
              <div className="list">
                {rows.map((c) => (
                  <button key={c.id} className={`list-item ${c.id === selected ? "active" : ""}`} onClick={() => nav(`/boardroom/${c.id}`)}>
                    <div className="row between">
                      <span className="row gap-s"><Badge>{c.kind}</Badge><Badge>{c.status}</Badge></span>
                      <span className="muted tiny">{fmtAgo(c.started_at)}</span>
                    </div>
                    <div className="small clamp-2">{c.memo || c.error || <span className="muted">no memo yet</span>}</div>
                    <div className="muted tiny mono">{fmtUsd(c.cost ?? 0)} · {fmtTokens(c.tokens ?? 0)} tok · {c.events ?? 0} events</div>
                  </button>
                ))}
              </div>
            )}
          </Async>
        </Card>
        <div className="split-detail">
          {selected ? <CycleView id={selected} /> : cycles.data ? null : <Loading />}
        </div>
      </div>
    </div>
  );
}

function CycleView({ id }: { id: string }) {
  const d = useAsync<CycleDetail>(() => api.cycle(id), [id], 10000);
  if (!d.data) return d.error ? <ErrorBox error={d.error} onRetry={d.reload} /> : <Loading />;
  const { cycle, ideas, experiments, approvals } = d.data;
  const sit = cycle.summary?.situation;
  const market = cycle.summary?.market;
  const groups = groupBy(ideas, (i) => i.source_agent);

  return (
    <div className="stack">
      <Card title={<>Cycle <span className="mono small">{cycle.id}</span></>}
        actions={<Link to={`/traces?cycle_id=${cycle.id}`} className="btn btn-sm">Traces</Link>}>
        <div className="row gap-s wrap small">
          <Badge>{cycle.kind}</Badge><Badge>{cycle.status}</Badge>
          <span className="muted">started {fmtTime(cycle.started_at)}{cycle.ended_at ? ` · ended ${fmtTime(cycle.ended_at)}` : ""}</span>
        </div>
        {cycle.error && <div className="alert alert-err" style={{ marginTop: 8 }}>{cycle.error}</div>}
        {cycle.summary?.notes?.length ? <ul className="small muted">{cycle.summary.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
      </Card>

      <Card className="tint-lilac" title="CEO memo">
        {cycle.memo ? <div className="prose">{cycle.memo}</div> : <div className="muted">No memo yet (written after the CEO decides).</div>}
      </Card>

      <div className="grid-2">
        <Card title={<>Situation {sit && <Badge tone={sit.north_star_trend === "up" ? "green" : sit.north_star_trend === "down" ? "red" : "gray"}>{`trend: ${sit.north_star_trend}`}</Badge>}</>}>
          {!sit ? <div className="muted small">Filled in when the cycle finishes.</div> : (
            <div className="stack-s small">
              <div>{sit.summary}</div>
              <div><strong>Biggest bottleneck:</strong> {sit.biggest_bottleneck}</div>
              {sit.data_gaps?.length ? <div><strong>Data gaps:</strong><ul>{sit.data_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div> : null}
            </div>
          )}
        </Card>
        <Card title="Market scan">
          {!market ? <div className="muted small">{cycle.kind === "daily" ? "Daily cycles skip the market scan." : "Filled in when the cycle finishes."}</div> : (
            <div className="stack-s small">
              <div>{market.summary}</div>
              <ListBlock title="Competitors" items={market.competitors} />
              <ListBlock title="Where users are" items={market.where_users_are} />
              <ListBlock title="PMF signals" items={market.pmf_signals} />
              {market.sources?.length ? (
                <Collapsible label={`Sources (${market.sources.length})`}>
                  <ul>{market.sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noreferrer">{u}</a></li>)}</ul>
                </Collapsible>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <Card title={`CEO's picks (${experiments.length})`}>
        {experiments.length === 0 ? <div className="muted small">No experiments picked in this cycle.</div> : (
          <div className="picks">
            {experiments.map((e) => (
              <div key={e.id} className="pick">
                <div className="row between wrap gap-s">
                  <strong>{e.title}</strong>
                  <span className="row gap-s"><Badge>{e.tier}</Badge><Badge>{e.status}</Badge></span>
                </div>
                <div className="small">{e.hypothesis}</div>
                <div className="muted tiny">
                  metric {e.metric} · guardrail {e.guardrail_metric ?? "—"} · {e.window_days ?? "?"} days ·
                  predicted {fmtPct(e.predicted_lift)} · p {fmtProb(e.confidence)}
                  {e.result?.kill_criteria ? <> · kill if: {e.result.kill_criteria}</> : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Ideas (${ideas.length})`} pad={false}>
        {ideas.length === 0 ? <div className="card-body muted small">No ideas in this cycle{cycle.kind === "daily" ? " (daily cycles skip ideation)" : ""}.</div> : (
          Object.entries(groups).map(([src, rows]) => (
            <div key={src} className="idea-group">
              <div className="idea-group-head">
                <strong>{SOURCE_LABEL[src] ?? src}</strong>
                {src === "dreamer" && <span className="muted tiny"> · only sees the one-liner + goal, on purpose</span>}
                <span className="muted small"> · {rows.length} idea{rows.length === 1 ? "" : "s"}</span>
              </div>
              <div className="table-wrap">
                <table className="table table-ideas">
                  <thead>
                    <tr><th>Idea</th><th>Status</th><th>Tier</th><th title="Impact / Confidence / Ease">I / C / E</th><th>Pred. lift</th><th>P(success)</th><th>Critique (pre-mortem)</th></tr>
                  </thead>
                  <tbody>
                    {[...rows].sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9)).map((i) => (
                      <IdeaRowView key={i.id} i={i} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))
        )}
      </Card>

      {approvals.length > 0 && (
        <Card title={`Approvals from this cycle (${approvals.length})`}>
          <div className="stack-s">
            {approvals.map((a) => (
              <div key={a.id} className="row gap-s small wrap">
                <Badge>{a.status}</Badge><Badge tone="gray">{a.kind.replace("_", " ")}</Badge><span>{a.title}</span>
                {a.comment && <span className="muted">“{a.comment}”</span>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function IdeaRowView({ i }: { i: IdeaRow }) {
  const s = i.scores ?? {};
  const ice = s.impact != null ? `${s.impact} / ${s.confidence} / ${s.ease}` : "—";
  return (
    <tr className={`idea-${i.status}`}>
      <td>
        <div className="idea-title">{i.title}</div>
        <div className="muted tiny">{i.channel} · {i.description}</div>
      </td>
      <td><Badge>{i.status}</Badge></td>
      <td><Badge>{i.tier}</Badge></td>
      <td className="mono nowrap">{ice}</td>
      <td className="mono nowrap">{fmtPct(i.predicted_lift)}</td>
      <td className="mono nowrap">{fmtProb(i.confidence)}</td>
      <td className="small critique">{i.critique ?? <span className="muted">—</span>}</td>
    </tr>
  );
}

function ListBlock({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div><strong>{title}:</strong><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows) (out[key(r)] ??= []).push(r);
  return out;
}

