import { useState } from "react";
import { api, type Recommendation } from "../api";
import { fmtAgo, useAsync } from "../lib";
import { AsyncButton, Badge, Chip, Empty, ErrorBox, Loading, PageHeader, Tabs, useStatus } from "../components/ui";

type Filter = "open" | "accepted" | "done" | "dismissed" | "all";

export default function Recommendations() {
  const recs = useAsync<Recommendation[]>(() => api.recommendations(), [], 30000);
  const [filter, setFilter] = useState<Filter>("open");
  const { toast } = useStatus();

  const set = async (r: Recommendation, status: Recommendation["status"]) => {
    const u = await api.updateRecommendation(r.id, status);
    recs.setData((prev) => (prev ?? []).map((x) => (x.id === r.id ? u : x)));
    toast(`Marked ${status}`);
  };

  const rows = (recs.data ?? []).filter((r) => filter === "all" || r.status === filter);
  const count = (f: Filter) => (recs.data ?? []).filter((r) => f === "all" || r.status === f).length;

  return (
    <div className="page">
      <PageHeader title="Recommendations" sub="Things only you can do or decide — analysis from the agents"
        actions={<Tabs value={filter} onChange={setFilter} options={(["open", "accepted", "done", "dismissed", "all"] as Filter[]).map((f) => ({
          value: f, label: <>{f} <span className="muted">{recs.data ? count(f) : ""}</span></>,
        }))} />} />
      {recs.error ? <ErrorBox error={recs.error} onRetry={recs.reload} /> : null}
      {!recs.data ? (recs.error ? null : <Loading />) : rows.length === 0 ? (
        <Empty title={filter === "open" ? "Nothing to decide right now" : `No ${filter} recommendations`}>
          The CEO and HR add recommendations when something needs a human: buying a domain, moving hosting, spending money, pivots.
        </Empty>
      ) : (
        <div className="rec-grid">
          {rows.map((r) => (
            <article key={r.id} className={`card rec rec-${r.status}`}>
              <div className="card-body stack-s">
                <div className="row between gap-s wrap">
                  <h3 className="rec-title">{r.title}</h3>
                  <Badge>{r.status}</Badge>
                </div>
                <div className="row gap-s wrap">
                  <Badge tone="blue">{r.category}</Badge>
                  <Chip label="impact" value={r.impact} tone={r.impact === "high" ? "green" : r.impact === "medium" ? "amber" : "gray"} />
                  <Chip label="effort" value={r.effort} tone={r.effort === "low" ? "green" : r.effort === "medium" ? "amber" : "red"} />
                  <Chip label="cost" value={r.cost || "—"} />
                </div>
                <div className="prose small">{r.analysis}</div>
                <div className="row between wrap gap-s">
                  <span className="muted tiny">from {r.source_agent} · {fmtAgo(r.created_at)}</span>
                  <div className="row gap-s">
                    {r.status !== "dismissed" && r.status !== "done" && <AsyncButton className="btn btn-sm" onClick={() => set(r, "dismissed")}>Dismiss</AsyncButton>}
                    {r.status === "open" && <AsyncButton className="btn btn-sm" onClick={() => set(r, "accepted")}>Accept</AsyncButton>}
                    {r.status !== "done" && <AsyncButton className="btn btn-sm btn-primary" onClick={() => set(r, "done")}>Done</AsyncButton>}
                    {r.status !== "open" && <AsyncButton className="btn btn-sm btn-ghost" onClick={() => set(r, "open")}>Reopen</AsyncButton>}
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
