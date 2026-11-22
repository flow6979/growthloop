import { useState } from "react";
import { api, type FeedbackRow } from "../api";
import { errMsg, fmtTime, useAsync } from "../lib";
import { Badge, Card, Empty, ErrorBox, Field, Loading, PageHeader, useStatus } from "../components/ui";
import { RatingInput } from "../components/FeedbackFab";

const PAGES = ["general", "/", "/live", "/boardroom", "/experiments", "/inbox", "/recommendations", "/evals", "/traces",
  "/costs", "/guardrails", "/org", "/learnings", "/settings", "/setup"];

export default function Feedback() {
  const fb = useAsync<FeedbackRow[]>(() => api.feedback(), []);
  const [text, setText] = useState("");
  const [rating, setRating] = useState<number | null>(null);
  const [page, setPage] = useState("general");
  const [busy, setBusy] = useState(false);
  const { toast } = useStatus();

  const submit = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const row = await api.addFeedback({ text: text.trim(), rating, page: page === "general" ? "" : page });
      fb.setData((prev) => [row, ...(prev ?? [])]);
      setText("");
      setRating(null);
      toast("Feedback saved as a learning for the agents");
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <PageHeader title="Feedback" sub="Tell the company what's working and what isn't. Each note becomes a learning agents read every cycle." />
      <Card title="New feedback">
        <div className="stack-s">
          <Field label="Feedback"><textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="What should the agents do differently?" /></Field>
          <div className="row gap wrap">
            <Field label="Rating"><RatingInput value={rating} onChange={setRating} /></Field>
            <Field label="About page">
              <select value={page} onChange={(e) => setPage(e.target.value)}>{PAGES.map((p) => <option key={p}>{p}</option>)}</select>
            </Field>
          </div>
          <div className="row end"><button className="btn btn-primary" disabled={busy || !text.trim()} onClick={submit}>{busy ? "Sending…" : "Submit"}</button></div>
        </div>
      </Card>
      <Card title="Previous feedback" pad={false}>
        {fb.error ? <div className="card-body"><ErrorBox error={fb.error} onRetry={fb.reload} /></div> : null}
        {!fb.data ? (fb.error ? null : <Loading />) : fb.data.length === 0 ? <Empty title="No feedback yet" /> : (
          <div className="list">
            {fb.data.map((f) => (
              <div key={f.id} className="list-item static">
                <div className="row gap-s wrap tiny">
                  {f.rating ? <span className="stars">{"★".repeat(f.rating)}<span className="muted">{"★".repeat(5 - f.rating)}</span></span> : null}
                  {f.page && <Badge tone="gray">{f.page}</Badge>}
                  <Badge tone={f.status === "new" ? "blue" : "gray"}>{f.status}</Badge>
                  <span className="muted">{f.author} · {fmtTime(f.ts)}</span>
                </div>
                <div className="small">{f.text}</div>
                {f.response && <div className="callout small"><strong>Response:</strong> {f.response}</div>}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
