import { useState } from "react";
import { Link } from "react-router-dom";
import { api, type Cycle, type Experiment, type MetricsResponse, type Recommendation } from "../api";
import { errMsg, fmtAgo, fmtNum, fmtPct, fmtUsd, todayIso, useAsync } from "../lib";
import { Badge, Card, Empty, ErrorBox, Field, Loading, Progress, Stat, useStatus } from "../components/ui";
import { LineChart } from "../components/charts";

const LIVE_STATUSES = new Set(["live"]);
const ROLES = ["CEO", "Dreamer", "Maverick", "Skeptic", "Researcher", "Product", "CTO", "Developer", "QA", "Growth analyst",
  "Marketing", "Sales", "Finance", "HR", "Trust & Safety", "Judge"];

export default function Overview() {
  const { status } = useStatus();
  const metrics = useAsync<MetricsResponse>(() => api.metrics(), [], 30000);
  const cycles = useAsync<Cycle[]>(() => api.cycles(10), [], 15000);
  const exps = useAsync<Experiment[]>(() => api.experiments(), [], 15000);
  const recs = useAsync<Recommendation[]>(() => api.recommendations(), [], 30000);

  const goal = metrics.data?.goal ?? status?.goal;
  const dau = metrics.data?.series.dau ?? [];
  const lastMemo = cycles.data?.find((c) => c.memo);
  const live = exps.data?.filter((e) => LIVE_STATUSES.has(e.status)).length ?? 0;
  const openRecs = recs.data?.filter((r) => r.status === "open").length ?? 0;
  const spend = status?.spend_24h ?? 0;
  const budget = status?.budget_per_day ?? 0;

  return (
    <div className="page">
      {metrics.error && !metrics.data ? <ErrorBox error={metrics.error} onRetry={metrics.reload} /> : null}

      <section className="hero-grid">
        <div>
          <div className="eyebrow-pill"><span className="dot">↗</span>{status?.product.name ?? "Your product"} · {status?.loop_running ? "loop running" : "loop paused"}</div>
          <h1 className="hero-title">
            From {goal?.current_7d == null ? "zero" : fmtNum(goal.current_7d)} to{" "}
            <span className="hl">{goal ? goal.target.toLocaleString() : "…"} engaged users</span>.
          </h1>
          <p className="hero-sub">
            A company of AI agents ideates, argues, builds and measures growth bets for {status?.product.name ?? "your product"},
            day and night. You approve anything risky.
          </p>
          <div className="hero-actions">
            <Link className="btn btn-primary" to="/inbox">
              Open inbox{status?.pending_inbox ? ` (${status.pending_inbox})` : ""} →
            </Link>
            <Link className="btn" to={lastMemo ? `/boardroom/${lastMemo.id}` : "/boardroom"}>See the boardroom</Link>
          </div>
        </div>

        <div className="hero-card-wrap">
          <div className="hero-card">
            <span className="hero-tag">Live goal ↗</span>
            {!goal ? <Loading /> : (
              <>
                <div>
                  <div className="label">{goal.metric.toUpperCase()} · 7-day average</div>
                  <div className="goal-big">
                    <span className="goal-cur">{goal.current_7d === null ? "—" : fmtNum(goal.current_7d)}</span>
                    <span className="muted"> / {goal.target}</span>
                    {goal.current_7d !== null && goal.prev_7d ? (
                      <span className={`small ${goal.current_7d >= goal.prev_7d ? "pos" : "neg"}`} style={{ marginLeft: 8 }}>
                        {fmtPct(((goal.current_7d - goal.prev_7d) / goal.prev_7d) * 100)} vs last week
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="hero-row"><span>Today</span><strong>{fmtNum(goal.today)}</strong></div>
                <div className="hero-row"><span>Previous 7 days</span><strong>{fmtNum(goal.prev_7d)}</strong></div>
                <Progress value={goal.current_7d ?? 0} max={goal.target} />
                <div className="ladder">
                  {goal.ladder.map((rung) => {
                    const reached = (goal.current_7d ?? 0) >= rung || goal.milestones_reached.includes(rung);
                    return (
                      <div key={rung} className={`rung ${reached ? "reached" : rung === goal.target ? "next" : ""}`}>
                        <span className="rung-check">{reached ? "✓" : rung === goal.target ? "→" : "·"}</span>
                        {rung.toLocaleString()} DAU
                      </div>
                    );
                  })}
                </div>
                {goal.definition && <div className="muted tiny">{goal.definition}</div>}
              </>
            )}
          </div>
        </div>
      </section>

      <div className="marquee" aria-hidden>
        <div className="marquee-track">
          {[0, 1].map((k) => ROLES.map((r) => (
            <span key={`${k}-${r}`} className="row"><span>{r}</span><span className="sep">✦</span></span>
          )))}
        </div>
      </div>

      <div className="stat-grid stat-grid-4">
        <Stat label="Live experiments" value={exps.data ? live : "…"} sub={<Link to="/experiments">View board →</Link>} />
        <Stat label="Waiting on you" value={status ? status.pending_inbox : "…"} tone={status?.pending_inbox ? "amber" : undefined}
          sub={<Link to="/inbox">Open inbox →</Link>} />
        <Stat label="Recommendations" value={recs.data ? openRecs : "…"} sub={<Link to="/recommendations">Review →</Link>} />
        <Stat label="LLM cost (24h)" value={fmtUsd(spend, 2)} tone={budget > 0 && spend >= budget ? "red" : undefined}
          sub={<>
            <span className="muted">{budget > 0 ? `of ${fmtUsd(budget, 2)} budget` : "free tier, no budget"}</span>
          </>} />
      </div>

      <Card title={`${(goal?.metric ?? "dau").toUpperCase()} (last 90 days)`}
        actions={goal?.has_data ? <SyncButton onDone={metrics.reload} /> : undefined}>
        {!metrics.data ? (metrics.error ? null : <Loading />) : dau.length === 0 || !goal?.has_data ? (
          <NoData onAdded={metrics.reload} />
        ) : (
          <>
            <LineChart points={dau.map((p) => ({ x: p.day, y: p.value }))} refLine={goal?.target}
              refLabel={`target ${goal?.target}`} height={220} />
            <details className="small" style={{ marginTop: 8 }}>
              <summary className="muted">Add or correct a day manually</summary>
              <MetricForm onAdded={metrics.reload} />
            </details>
          </>
        )}
      </Card>

      <Card className="tint-sage" title="Latest cycle memo" actions={lastMemo && <Link to={`/boardroom/${lastMemo.id}`} className="btn btn-sm">Open in Boardroom</Link>}>
        {!cycles.data ? (cycles.error ? <ErrorBox error={cycles.error} onRetry={cycles.reload} /> : <Loading />) : !lastMemo ? (
          <Empty title="No cycle memo yet">Run a weekly cycle from the top bar. The CEO writes a memo explaining its bets.</Empty>
        ) : (
          <div className="stack-s">
            <div className="row gap-s small">
              <Badge>{lastMemo.kind}</Badge><Badge>{lastMemo.status}</Badge>
              <span className="muted">{fmtAgo(lastMemo.started_at)}</span>
            </div>
            <div className="prose">{lastMemo.memo}</div>
          </div>
        )}
      </Card>
    </div>
  );
}

function SyncButton({ onDone }: { onDone: () => void }) {
  const { toast } = useStatus();
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn btn-sm" disabled={busy} onClick={async () => {
      setBusy(true);
      try {
        const r = await api.syncMetrics();
        toast(r.detail, r.ok ? "ok" : "err");
        onDone();
      } catch (e) {
        toast(errMsg(e), "err");
      } finally {
        setBusy(false);
      }
    }}>{busy ? "Syncing…" : "Sync metrics"}</button>
  );
}

function NoData({ onAdded }: { onAdded: () => void }) {
  return (
    <div className="nodata">
      <div>
        <div className="empty-title">No data yet</div>
        <p className="muted">
          The agents can't optimize what they can't measure. Add daily numbers by hand, or pull them from the product's
          metrics adapter (e.g. Firestore traffic docs).
        </p>
        <SyncButton onDone={onAdded} />
      </div>
      <MetricForm onAdded={onAdded} />
    </div>
  );
}

function MetricForm({ onAdded }: { onAdded: () => void }) {
  const { toast } = useStatus();
  const [day, setDay] = useState(todayIso());
  const [name, setName] = useState("dau");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="metric-form" onSubmit={async (e) => {
      e.preventDefault();
      if (value === "") return;
      setBusy(true);
      try {
        await api.addMetric({ day, name, value: Number(value) });
        toast(`Saved ${name} = ${value} for ${day}`);
        setValue("");
        onAdded();
      } catch (er) {
        toast(errMsg(er), "err");
      } finally {
        setBusy(false);
      }
    }}>
      <Field label="Day"><input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
      <Field label="Metric">
        <select value={name} onChange={(e) => setName(e.target.value)}>
          {["dau", "visitors", "signups", "views", "sessions"].map((n) => <option key={n}>{n}</option>)}
        </select>
      </Field>
      <Field label="Value"><input type="number" min={0} step="any" value={value} onChange={(e) => setValue(e.target.value)} required /></Field>
      <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Add"}</button>
    </form>
  );
}
