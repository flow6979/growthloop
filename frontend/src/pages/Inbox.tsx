import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, parseSpec, type Approval, type DecisionAction } from "../api";
import { copyText, errMsg, fmtAgo, fmtTime, useAsync } from "../lib";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Tabs, useStatus } from "../components/ui";

export default function Inbox() {
  const [tab, setTab] = useState<"pending" | "all">("pending");
  const list = useAsync<Approval[]>(() => api.approvals(tab), [tab], 10000);
  const { refresh, status } = useStatus();

  const onDecided = (a: Approval) => {
    list.setData((prev) => (prev ?? []).map((x) => (x.id === a.id ? a : x)).filter((x) => tab === "all" || x.status === "pending"));
    refresh();
  };

  const rows = list.data ?? [];
  const exp = rows.filter((a) => a.kind === "experiment");
  const builds = rows.filter((a) => a.kind === "build_task");
  const posts = rows.filter((a) => a.kind === "post_draft");
  const other = rows.filter((a) => !["experiment", "build_task", "post_draft"].includes(a.kind));

  return (
    <div className="page">
      <PageHeader title="Inbox" sub="Everything waiting on you. Approvals unblock the cycle; posts are yours to publish."
        actions={<Tabs value={tab} onChange={setTab} options={[
          { value: "pending", label: <>Pending {status?.pending_inbox ? <span className="count-inline">{status.pending_inbox}</span> : null}</> },
          { value: "all", label: "History" },
        ]} />} />
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
      {!list.data ? (list.error ? null : <Loading />) : tab === "all" ? (
        <History rows={rows} />
      ) : rows.length === 0 ? (
        <Empty title="Inbox zero">Nothing needs you right now. New items appear after each cycle.</Empty>
      ) : (
        <div className="stack">
          {exp.length > 0 && (
            <Group title="Experiment approvals" sub="The cycle is paused until you decide these.">
              {exp.map((a) => <ExperimentApproval key={a.id} a={a} onDecided={onDecided} />)}
            </Group>
          )}
          {builds.length > 0 && (
            <Group title="Build tasks" sub="Spec-only mode: build these yourself (or with your own tools), then mark done to start measuring.">
              {builds.map((a) => <BuildTask key={a.id} a={a} onDecided={onDecided} />)}
            </Group>
          )}
          {posts.length > 0 && (
            <Group title="Post drafts" sub="Copy, post on the channel yourself, then mark Posted. Feedback becomes a learning for Marketing.">
              {posts.map((a) => <PostDraft key={a.id} a={a} onDecided={onDecided} />)}
            </Group>
          )}
          {other.length > 0 && (
            <Group title="Other">
              {other.map((a) => <ExperimentApproval key={a.id} a={a} onDecided={onDecided} />)}
            </Group>
          )}
        </div>
      )}
    </div>
  );
}

function Group({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="inbox-group">
      <div className="inbox-group-head"><h2>{title}</h2>{sub && <span className="muted small">{sub}</span>}</div>
      <div className="stack-s">{children}</div>
    </section>
  );
}

function useDecide(a: Approval, onDecided: (a: Approval) => void) {
  const { toast } = useStatus();
  const [busy, setBusy] = useState<DecisionAction | null>(null);
  const decide = async (action: DecisionAction, comment: string) => {
    setBusy(action);
    try {
      const r = await api.decide(a.id, action, comment);
      onDecided(r);
      toast(`${action}: ${a.title}`);
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(null);
    }
  };
  return { busy, decide };
}

function Meta({ a }: { a: Approval }) {
  return (
    <div className="row gap-s wrap tiny">
      <Badge>{a.tier}</Badge>
      {a.channel ? <Badge tone="violet">{a.channel}</Badge> : null}
      <span className="muted">{fmtAgo(a.created_at)}</span>
      <Link className="muted" to={`/boardroom/${a.cycle_id}`}>cycle</Link>
    </div>
  );
}

function ExperimentApproval({ a, onDecided }: { a: Approval; onDecided: (a: Approval) => void }) {
  const [comment, setComment] = useState("");
  const { busy, decide } = useDecide(a, onDecided);
  return (
    <Card>
      <div className="stack-s">
        <div className="row between wrap gap-s"><strong>{a.title}</strong><Meta a={a} /></div>
        <div className="prose small">{a.body}</div>
        <textarea rows={2} placeholder="Comment (optional): why, or what to change" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="row gap end">
          <button className="btn btn-danger-outline" disabled={!!busy} onClick={() => decide("reject", comment)}>{busy === "reject" ? "…" : "Reject"}</button>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => decide("approve", comment)}>{busy === "approve" ? "…" : "Approve"}</button>
        </div>
      </div>
    </Card>
  );
}

function BuildTask({ a, onDecided }: { a: Approval; onDecided: (a: Approval) => void }) {
  const { busy, decide } = useDecide(a, onDecided);
  const { toast } = useStatus();
  const spec = parseSpec(a.body);
  return (
    <Card>
      <div className="stack-s">
        <div className="row between wrap gap-s"><strong>{a.title}</strong><Meta a={a} /></div>
        {spec ? (
          <div className="spec small">
            {spec.user_story && <p><strong>User story:</strong> {spec.user_story}</p>}
            {(["changes", "acceptance_criteria", "instrumentation"] as const).map((k) => spec[k]?.length ? (
              <div key={k}><strong>{k.replace("_", " ")}</strong><ul>{spec[k].map((x, i) => <li key={i}>{x}</li>)}</ul></div>
            ) : null)}
            {spec.rollout && <p><strong>Rollout:</strong> {spec.rollout}</p>}
          </div>
        ) : <pre className="code">{a.body}</pre>}
        <div className="row gap end">
          <button className="btn" onClick={async () => toast((await copyText(a.body)) ? "Spec copied" : "Copy failed", "ok")}>Copy spec</button>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => decide("done", "")}>{busy ? "…" : "Mark done (goes live)"}</button>
        </div>
      </div>
    </Card>
  );
}

function PostDraft({ a, onDecided }: { a: Approval; onDecided: (a: Approval) => void }) {
  const [comment, setComment] = useState("");
  const [copied, setCopied] = useState(false);
  const { busy, decide } = useDecide(a, onDecided);
  return (
    <Card>
      <div className="stack-s">
        <div className="row between wrap gap-s"><strong>{a.title}</strong><Meta a={a} /></div>
        <div className="draft-body">{a.body}</div>
        {a.payload?.why && <div className="muted small"><strong>Why:</strong> {a.payload.why}</div>}
        <input placeholder="Feedback for Marketing (optional), e.g. too long, too salesy" value={comment} onChange={(e) => setComment(e.target.value)} />
        <div className="row gap end wrap">
          <button className="btn" onClick={async () => {
            setCopied(await copyText(a.body));
            window.setTimeout(() => setCopied(false), 1500);
          }}>{copied ? "Copied ✓" : "Copy to clipboard"}</button>
          <button className="btn" disabled={!!busy} onClick={() => decide("skipped", comment)}>{busy === "skipped" ? "…" : "Skip"}</button>
          <button className="btn btn-primary" disabled={!!busy} onClick={() => decide("posted", comment)}>{busy === "posted" ? "…" : "Posted"}</button>
        </div>
      </div>
    </Card>
  );
}

function History({ rows }: { rows: Approval[] }) {
  if (!rows.length) return <Empty title="No history yet" />;
  return (
    <Card pad={false}>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Created</th><th>Kind</th><th>Title</th><th>Tier</th><th>Status</th><th>Decided</th><th>Comment</th></tr></thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td className="nowrap small">{fmtTime(a.created_at)}</td>
                <td><Badge tone="gray">{a.kind.replace("_", " ")}</Badge></td>
                <td>{a.title}{a.channel ? <span className="muted small"> · {a.channel}</span> : null}</td>
                <td><Badge>{a.tier}</Badge></td>
                <td><Badge>{a.status}</Badge></td>
                <td className="nowrap small">{fmtTime(a.decided_at)}</td>
                <td className="small muted">{a.comment || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
