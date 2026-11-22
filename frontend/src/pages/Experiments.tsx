import { useState } from "react";
import { Link } from "react-router-dom";
import { api, parseSpec, type Experiment } from "../api";
import { fmtNum, fmtPct, fmtProb, fmtTime, useAsync } from "../lib";
import { AsyncButton, Badge, Empty, ErrorBox, Field, Loading, Modal, PageHeader, useStatus } from "../components/ui";

const COLUMNS: { key: string; label: string; statuses: string[]; hint: string }[] = [
  { key: "planned", label: "Planned", statuses: ["planned"], hint: "Picked by the CEO" },
  { key: "awaiting_approval", label: "Awaiting approval", statuses: ["awaiting_approval"], hint: "In your inbox" },
  { key: "approved", label: "Approved", statuses: ["approved"], hint: "PM writes the spec next" },
  { key: "spec_ready", label: "Spec ready", statuses: ["spec_ready"], hint: "Ready for the developer" },
  { key: "ready_to_build", label: "Ready to build", statuses: ["ready_to_build"], hint: "Build task in your inbox" },
  { key: "awaiting_merge", label: "Awaiting merge", statuses: ["awaiting_merge"], hint: "PR opened, review it" },
  { key: "live", label: "Live", statuses: ["live"], hint: "Measuring" },
  { key: "won", label: "Won", statuses: ["won"], hint: "" },
  { key: "lost", label: "Lost", statuses: ["lost"], hint: "" },
  { key: "inconclusive", label: "Inconclusive", statuses: ["inconclusive"], hint: "" },
  { key: "rejected", label: "Rejected", statuses: ["rejected"], hint: "" },
  { key: "blocked", label: "Blocked / QA failed", statuses: ["blocked", "qa_failed"], hint: "" },
];
const KNOWN = new Set(COLUMNS.flatMap((c) => c.statuses));
const CAN_GO_LIVE = new Set(["approved", "spec_ready", "ready_to_build", "awaiting_merge", "blocked", "qa_failed"]);

export default function Experiments() {
  const exps = useAsync<Experiment[]>(() => api.experiments(), [], 15000);
  const [open, setOpen] = useState<Experiment | null>(null);
  const [hideEmpty, setHideEmpty] = useState(true);
  const { toast } = useStatus();

  const markLive = async (e: Experiment) => {
    const updated = await api.patchExperiment(e.id, { status: "live" });
    exps.setData((prev) => (prev ?? []).map((x) => (x.id === e.id ? updated : x)));
    if (open?.id === e.id) setOpen(updated);
    toast(`“${e.title}” is live: the window starts now`);
  };

  const data = exps.data ?? [];
  const other = data.filter((e) => !KNOWN.has(e.status));
  const cols = [...COLUMNS, ...(other.length ? [{ key: "other", label: "Other", statuses: [...new Set(other.map((o) => o.status))], hint: "" }] : [])];

  return (
    <div className="page page-wide">
      <PageHeader title="Experiments" sub="Every bet the company made, from plan to verdict."
        actions={<label className="row gap-s small"><input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} /> Hide empty columns</label>} />
      {exps.error ? <ErrorBox error={exps.error} onRetry={exps.reload} /> : null}
      {!exps.data ? (exps.error ? null : <Loading />) : data.length === 0 ? (
        <Empty title="No experiments yet">The CEO picks experiments at the end of each weekly cycle.</Empty>
      ) : (
        <div className="kanban">
          {cols.map((c) => {
            const items = data.filter((e) => c.statuses.includes(e.status));
            if (hideEmpty && !items.length) return null;
            return (
              <div key={c.key} className="kanban-col">
                <div className="kanban-head">
                  <span><Badge>{c.statuses[0]}</Badge></span>
                  <span className="muted small">{items.length}</span>
                </div>
                {c.hint && <div className="muted tiny kanban-hint">{c.hint}</div>}
                <div className="kanban-items">
                  {items.map((e) => (
                    <div key={e.id} className="kcard" onClick={() => setOpen(e)} role="button" tabIndex={0}
                      onKeyDown={(k) => k.key === "Enter" && setOpen(e)}>
                      <div className="kcard-title">{e.title}</div>
                      <div className="kcard-hyp muted small clamp-3">{e.hypothesis}</div>
                      <div className="kcard-meta tiny">
                        <Badge>{e.tier}</Badge>
                        <span className="muted">{e.metric}</span>
                        <span className="muted">{e.window_days ?? "?"}d</span>
                      </div>
                      <div className="kcard-lift tiny mono">
                        <span title="predicted lift">pred {fmtPct(e.predicted_lift)}</span>
                        <span title="actual lift" className={e.actual_lift == null ? "muted" : e.actual_lift >= 0 ? "pos" : "neg"}>
                          act {fmtPct(e.actual_lift)}
                        </span>
                      </div>
                      {e.pr_url && <a className="tiny" href={e.pr_url} target="_blank" rel="noreferrer" onClick={(x) => x.stopPropagation()}>PR ↗</a>}
                      {CAN_GO_LIVE.has(e.status) && (
                        <div onClick={(x) => x.stopPropagation()}>
                          <AsyncButton className="btn btn-sm btn-block" onClick={() => markLive(e)}>Mark live</AsyncButton>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {open && <ExperimentModal e={open} onClose={() => setOpen(null)} onLive={() => markLive(open)}
        onUpdated={(u) => { setOpen(u); exps.setData((prev) => (prev ?? []).map((x) => (x.id === u.id ? u : x))); }} />}
    </div>
  );
}

function ExperimentModal({ e, onClose, onLive, onUpdated }: {
  e: Experiment; onClose: () => void; onLive: () => Promise<void>; onUpdated: (e: Experiment) => void;
}) {
  const spec = parseSpec(e.spec);
  const [pr, setPr] = useState(e.pr_url ?? "");
  const { toast } = useStatus();
  return (
    <Modal title={e.title} onClose={onClose} wide>
      <div className="stack">
        <div className="row gap-s wrap">
          <Badge>{e.status}</Badge><Badge>{e.tier}</Badge>
          <Link className="small" to={`/boardroom/${e.cycle_id}`}>cycle {e.cycle_id}</Link>
          <span className="muted small">created {fmtTime(e.created_at)}</span>
        </div>
        <div><strong>Hypothesis.</strong> {e.hypothesis}</div>
        <div className="kv-grid small">
          <div><span>Metric</span>{e.metric}</div>
          <div><span>Guardrail metric</span>{e.guardrail_metric ?? "—"}</div>
          <div><span>Window</span>{e.window_days ?? "?"} days</div>
          <div><span>Baseline (7d DAU)</span>{fmtNum(e.baseline)}</div>
          <div><span>Predicted lift</span>{fmtPct(e.predicted_lift)}</div>
          <div><span>Actual lift</span>{fmtPct(e.actual_lift)}</div>
          <div><span>P(success)</span>{fmtProb(e.confidence)}</div>
          <div><span>Started</span>{fmtTime(e.started_at)}</div>
          <div><span>Ends</span>{fmtTime(e.ends_at)}</div>
        </div>
        {e.result?.kill_criteria && <div className="small"><strong>Kill criteria:</strong> {e.result.kill_criteria}</div>}
        {e.result?.learning && <div className="callout small"><strong>Learning:</strong> {e.result.learning}</div>}

        <h4>Spec</h4>
        {spec ? (
          <div className="spec small">
            {spec.user_story && <p><strong>User story:</strong> {spec.user_story}</p>}
            <SpecList title="Changes" items={spec.changes} />
            <SpecList title="Acceptance criteria" items={spec.acceptance_criteria} />
            <SpecList title="Instrumentation" items={spec.instrumentation} />
            {spec.rollout && <p><strong>Rollout:</strong> {spec.rollout}</p>}
          </div>
        ) : e.spec ? <pre className="code">{String(e.spec)}</pre> : <div className="muted small">No spec yet (the PM writes it after approval).</div>}

        <Field label="Pull request URL">
          <div className="row gap-s">
            <input className="grow" value={pr} onChange={(x) => setPr(x.target.value)} placeholder="https://github.com/…/pull/1" />
            <AsyncButton className="btn" disabled={pr === (e.pr_url ?? "")} onClick={async () => {
              onUpdated(await api.patchExperiment(e.id, { pr_url: pr }));
              toast("PR link saved");
            }}>Save</AsyncButton>
          </div>
        </Field>
        <div className="row gap end">
          {CAN_GO_LIVE.has(e.status) && <AsyncButton className="btn btn-primary" onClick={onLive}>Mark live</AsyncButton>}
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

function SpecList({ title, items }: { title: string; items?: string[] }) {
  if (!items?.length) return null;
  return <div><strong>{title}</strong><ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul></div>;
}
