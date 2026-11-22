import { api, type PublicResults as PR } from "../api";
import { fmtNum, fmtPct, useAsync } from "../lib";
import { ErrorBox, Loading, Progress } from "../components/ui";
import { LineChart } from "../components/charts";

const OUTCOME: Record<string, string> = { won: "Won", lost: "Lost", inconclusive: "Inconclusive", live: "Running" };

export default function PublicResults() {
  const r = useAsync<PR>(() => api.publicResults(), [], 60000);
  return (
    <div className="public">
      <div className="public-inner">
        {!r.data ? (r.error ? <ErrorBox error={r.error} onRetry={r.reload} /> : <Loading />) : <Body d={r.data} />}
        <footer className="public-foot muted small">
          Built in public by an AI company of agents (GrowthLoop). Humans approve every risky step and post everything by hand.
        </footer>
      </div>
    </div>
  );
}

function Body({ d }: { d: PR }) {
  const g = d.goal;
  const finished = d.experiments.filter((e) => ["won", "lost", "inconclusive"].includes(e.status));
  const shown = d.experiments.filter((e) => ["won", "lost", "inconclusive", "live"].includes(e.status));
  const won = finished.filter((e) => e.status === "won").length;
  return (
    <>
      <header className="public-head">
        <div className="eyebrow">Building in public</div>
        <h1>{d.product}: road to {g.ladder[g.ladder.length - 1]?.toLocaleString()} daily users</h1>
        <p className="muted">
          An AI team proposes, debates and runs growth experiments; every result, good or bad, lands here.
        </p>
      </header>

      <section className="public-stats">
        <div><div className="big">{g.current_7d === null ? "—" : fmtNum(g.current_7d)}</div><div className="muted small">{g.metric.toUpperCase()} (7-day avg)</div></div>
        <div><div className="big">{g.target}</div><div className="muted small">next goal</div></div>
        <div><div className="big">{d.cycles}</div><div className="muted small">cycles run</div></div>
        <div><div className="big">{finished.length ? `${won}/${finished.length}` : "—"}</div><div className="muted small">experiments won</div></div>
      </section>

      <section className="card"><div className="card-body">
        <div className="row between small" style={{ marginBottom: 6 }}>
          {g.ladder.map((rung) => (
            <span key={rung} className={(g.current_7d ?? 0) >= rung ? "pos" : "muted"}>{(g.current_7d ?? 0) >= rung ? "✓ " : ""}{rung.toLocaleString()} DAU</span>
          ))}
        </div>
        <Progress value={g.current_7d ?? 0} max={g.target} />
        <div style={{ marginTop: 16 }}>
          {d.dau.length ? (
            <LineChart points={d.dau.map((p) => ({ x: p.day, y: p.value }))} refLine={g.target} refLabel={`goal ${g.target}`} height={220} />
          ) : <div className="muted small">No data yet. Measurement is the first experiment.</div>}
        </div>
      </div></section>

      {d.milestones.length > 0 && (
        <section>
          <h2>Milestones</h2>
          <ul className="timeline">
            {d.milestones.map((m, i) => <li key={i}><span className="muted small">{new Date(m.ts * 1000).toLocaleDateString()}</span> {m.text}</li>)}
          </ul>
        </section>
      )}

      <section>
        <h2>Experiments</h2>
        {shown.length === 0 ? <p className="muted">No experiments have shipped yet.</p> : (
          <div className="public-exps">
            {shown.map((e, i) => (
              <div key={i} className={`card public-exp out-${e.status}`}>
                <div className="card-body">
                  <div className="row between gap-s"><strong>{e.title}</strong><span className={`outcome out-${e.status}`}>{OUTCOME[e.status] ?? e.status}</span></div>
                  <div className="small muted">{e.hypothesis}</div>
                  <div className="tiny mono">predicted {fmtPct(e.predicted_lift)} · actual {fmtPct(e.actual_lift)} · {e.window_days ?? "?"}-day window</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {d.learnings.length > 0 && (
        <section>
          <h2>What we learned</h2>
          <ul className="learn-list">{d.learnings.map((l, i) => <li key={i}>{l.text}</li>)}</ul>
        </section>
      )}
    </>
  );
}
