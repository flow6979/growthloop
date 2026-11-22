import { useState } from "react";
import { api, type Learning } from "../api";
import { errMsg, fmtTime, useAsync } from "../lib";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, useStatus } from "../components/ui";

export default function Learnings() {
  const l = useAsync<Learning[]>(() => api.learnings(), [], 30000);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [src, setSrc] = useState("");
  const { toast } = useStatus();

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const row = await api.addLearning(text.trim());
      l.setData((prev) => [row, ...(prev ?? [])]);
      setText("");
      toast("Learning added: every agent reads it next cycle");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
    }
  };

  const sources = [...new Set((l.data ?? []).map((x) => x.source))];
  const rows = (l.data ?? []).filter((x) => !src || x.source === src);

  return (
    <div className="page">
      <PageHeader title="Learnings" sub="The company's memory: experiment readouts, milestones, and your notes. Agents read these every cycle." />
      <Card title="Add a learning">
        <div className="stack-s">
          <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)}
            placeholder="e.g. College WhatsApp groups respond to free mock-interview slots, not article links." />
          <div className="row end"><button className="btn btn-primary" disabled={busy || !text.trim()} onClick={add}>{busy ? "Adding…" : "Add learning"}</button></div>
        </div>
      </Card>
      <Card title={`All learnings (${rows.length})`} pad={false}
        actions={sources.length > 1 ? (
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">all sources</option>
            {sources.map((s) => <option key={s}>{s}</option>)}
          </select>
        ) : undefined}>
        {l.error ? <div className="card-body"><ErrorBox error={l.error} onRetry={l.reload} /></div> : null}
        {!l.data ? (l.error ? null : <Loading />) : rows.length === 0 ? <Empty title="No learnings yet">They accumulate as experiments finish.</Empty> : (
          <div className="list">
            {rows.map((x) => (
              <div key={x.id} className="list-item static">
                <div className="row gap-s wrap tiny">
                  <Badge tone={x.source === "milestone" ? "green" : x.source === "readout" ? "blue" : "gray"}>{x.source}</Badge>
                  {(x.tags ?? []).map((t) => <Badge key={t} tone="gray">{t}</Badge>)}
                  <span className="muted">{fmtTime(x.ts)}</span>
                </div>
                <div className="small">{x.text}</div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
