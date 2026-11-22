import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type TraceEvent } from "../api";
import { fmtClock, fmtMs, fmtUsd } from "../lib";
import { Badge, Card, Empty, ErrorBox, PageHeader, useStatus } from "../components/ui";

// ---------------- pipeline model ----------------
type NodeKey =
  | "readout" | "sense" | "ideate" | "dreamer" | "maverick" | "pm" | "marketing" | "collect" | "validate" | "skeptic"
  | "cto" | "merge" | "ceo" | "approvals" | "specs" | "build" | "content" | "hr" | "evals" | "memo";

interface Stage { key: NodeKey; label: string; children?: { key: NodeKey; label: string }[] }

const PIPELINE: Stage[] = [
  { key: "readout", label: "Readout" },
  { key: "sense", label: "Sense" },
  { key: "ideate", label: "Ideate", children: [
    { key: "dreamer", label: "Dreamer" }, { key: "maverick", label: "Maverick" },
    { key: "pm", label: "PM" }, { key: "marketing", label: "Marketing" },
  ] },
  { key: "collect", label: "Collect" },
  { key: "validate", label: "Validate", children: [{ key: "skeptic", label: "Skeptic" }, { key: "cto", label: "CTO" }] },
  { key: "merge", label: "Merge" },
  { key: "ceo", label: "CEO" },
  { key: "approvals", label: "Approvals" },
  { key: "specs", label: "Specs" },
  { key: "build", label: "Build" },
  { key: "content", label: "Content" },
  { key: "hr", label: "HR" },
  { key: "evals", label: "Evals" },
  { key: "memo", label: "Memo" },
];

const IDEATORS: Record<string, NodeKey> = { dreamer: "dreamer", maverick: "maverick", pm: "pm", marketing: "marketing" };
const NODE_ALIASES: Record<string, NodeKey> = {
  readout: "readout", sense: "sense", sense_metrics: "sense", sense_market: "sense", route_gate: "sense",
  ideate: "ideate", dreamer: "dreamer", maverick: "maverick", pm_ideas: "pm", marketing_ideas: "marketing",
  collect: "collect", validate: "validate", skeptic: "skeptic", cto: "cto", merge: "merge",
  decide: "ceo", ceo: "ceo", request_approvals: "approvals", await_approvals: "approvals", inbox: "approvals",
  spec: "specs", specs: "specs", build: "build", content: "content", hr: "hr", evals: "evals", memo: "memo",
};

/** Map a trace event to the pipeline node it belongs to. */
export function nodeOf(e: Pick<TraceEvent, "node" | "agent">): NodeKey | null {
  if (e.node === "ideate" && IDEATORS[e.agent]) return IDEATORS[e.agent];
  if (e.node === "validate" && (e.agent === "skeptic" || e.agent === "cto")) return e.agent;
  return NODE_ALIASES[e.node] ?? null;
}

type NodeState = "idle" | "running" | "done" | "error";

function computeStates(events: TraceEvent[], waiting: boolean): { states: Partial<Record<NodeKey, NodeState>>; current: NodeKey | null; complete: boolean } {
  const states: Partial<Record<NodeKey, NodeState>> = {};
  let current: NodeKey | null = null;
  let complete = false;
  for (const e of events) {
    if (e.node === "memo" && e.kind === "info" && e.content.includes("cycle complete")) complete = true;
    const k = nodeOf(e);
    if (!k) continue;
    if (e.kind === "node_end") states[k] = "done";
    else if (e.kind === "error") states[k] = "error";
    else if (states[k] !== "done") states[k] = "running";
    current = k;
  }
  // parents reflect children
  for (const st of PIPELINE) {
    if (!st.children) continue;
    const cs = st.children.map((c) => states[c.key]);
    if (cs.some((c) => c === "running")) states[st.key] = "running";
    else if (cs.some((c) => c === "error")) states[st.key] = "error";
    else if (cs.some((c) => c === "done")) states[st.key] = "done";
  }
  if (complete) for (const st of PIPELINE) if (states[st.key] === "running") states[st.key] = "done";
  if (waiting && !complete) {
    states.approvals = "running";
    current = "approvals";
  }
  return { states, current: complete ? null : current, complete };
}

const MAX_EVENTS = 600;
const KINDS = ["llm", "tool", "info", "error", "guardrail", "decision", "node_start", "node_end"];

export default function Live() {
  const { status } = useStatus();
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [conn, setConn] = useState<"connecting" | "open" | "error">("connecting");
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set(["node_end"]));
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const buffer = useRef<TraceEvent[]>([]);

  useEffect(() => {
    let es: EventSource | null = null;
    let alive = true;
    const open = (after: number) => {
      es = new EventSource(`/api/stream${after ? `?after=${after}` : ""}`);
      es.onopen = () => alive && setConn("open");
      es.onerror = () => alive && setConn("error"); // EventSource retries automatically
      es.addEventListener("trace", (msg) => {
        try {
          const ev = JSON.parse((msg as MessageEvent).data) as TraceEvent;
          buffer.current.push(ev);
          if (alive) setConn("open");
        } catch {
          /* ignore malformed */
        }
      });
    };
    api.events({ limit: 200 })
      .then((rows) => {
        if (!alive) return;
        setEvents(rows.slice(-MAX_EVENTS));
        open(rows.length ? rows[rows.length - 1].id : 0);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadErr(e);
        open(0);
      });
    // flush buffered SSE events a few times per second (keeps renders cheap under bursts)
    const t = window.setInterval(() => {
      if (pausedRef.current || !buffer.current.length) return;
      const add = buffer.current;
      buffer.current = [];
      setEvents((prev) => {
        const seen = new Set(prev.map((p) => p.id));
        return [...prev, ...add.filter((a) => !seen.has(a.id))].slice(-MAX_EVENTS);
      });
    }, 300);
    return () => {
      alive = false;
      es?.close();
      window.clearInterval(t);
    };
  }, []);

  const cycleId = status?.current_cycle?.id ?? [...events].reverse().find((e) => e.cycle_id)?.cycle_id ?? null;
  const cycleEvents = useMemo(() => events.filter((e) => cycleId && e.cycle_id === cycleId), [events, cycleId]);
  const waiting = status?.current_cycle?.id === cycleId && status?.current_cycle?.status === "waiting_approval";
  const { states, current, complete } = useMemo(() => computeStates(cycleEvents, waiting), [cycleEvents, waiting]);
  const shown = useMemo(() => [...events].reverse().filter((e) => !hidden.has(e.kind)), [events, hidden]);
  const cyc = status?.current_cycle;

  return (
    <div className="page">
      <PageHeader title="Live" sub="Real-time agent activity. Every LLM call, tool call, guardrail hit and decision."
        actions={<>
          <span className={`conn conn-${conn}`}><span className="dot-live pulse" /> {conn === "open" ? "streaming" : conn === "error" ? "reconnecting…" : "connecting…"}</span>
          <button className="btn btn-sm" onClick={() => setPaused((p) => !p)}>{paused ? "▶ Resume" : "❚❚ Pause feed"}</button>
        </>} />
      {loadErr ? <ErrorBox error={loadErr} /> : null}

      <Card title={<>Cycle pipeline {cyc && cyc.id === cycleId && <>
          <Badge>{cyc.kind}</Badge> <Badge>{cyc.status}</Badge> <Link className="small" to={`/boardroom/${cyc.id}`}>{cyc.id}</Link>
        </>}</>}
        actions={current ? <span className="small">Now: <strong>{PIPELINE.flatMap((s) => [s, ...(s.children ?? [])]).find((s) => s.key === current)?.label}</strong></span>
          : complete ? <Badge tone="green">complete</Badge> : undefined}>
        {waiting && <div className="alert alert-warn" style={{ marginBottom: 10 }}>Paused at approvals: decide the experiments in your <Link to="/inbox">Inbox</Link> and the cycle resumes.</div>}
        {!cycleId ? (
          <Empty title="No cycle yet">Start one with <strong>Run cycle</strong> in the top bar and watch it here.</Empty>
        ) : (
          <div className="pipeline">
            {PIPELINE.map((st, i) => (
              <div key={st.key} className="pipe-step">
                {st.children ? (
                  <div className={`pipe-group state-${states[st.key] ?? "idle"}`}>
                    <div className="pipe-group-label">{st.label}</div>
                    <div className="pipe-children">
                      {st.children.map((c) => (
                        <div key={c.key} className={`pipe-node small-node state-${states[c.key] ?? "idle"} ${current === c.key ? "current" : ""}`}>
                          {c.label}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className={`pipe-node state-${states[st.key] ?? "idle"} ${current === st.key ? "current" : ""}`}>{st.label}</div>
                )}
                {i < PIPELINE.length - 1 && <div className="pipe-arrow">→</div>}
              </div>
            ))}
          </div>
        )}
        <div className="legend small muted">
          <span><i className="lg lg-idle" />not started</span><span><i className="lg lg-running" />running</span>
          <span><i className="lg lg-done" />done</span><span><i className="lg lg-error" />error</span>
          {cyc?.kind === "daily" && <span>Daily cycles skip ideation → straight to evals.</span>}
        </div>
      </Card>

      <Card title={`Stream (${shown.length})`} pad={false}
        actions={<div className="kind-filter">
          {KINDS.map((k) => (
            <button key={k} className={`chip-toggle ${hidden.has(k) ? "" : "on"}`} onClick={() => setHidden((h) => {
              const n = new Set(h);
              if (n.has(k)) n.delete(k);
              else n.add(k);
              return n;
            })}>{k.replace("_", " ")}</button>
          ))}
        </div>}>
        {shown.length === 0 ? (
          <Empty title="Waiting for events…">Nothing has happened yet. Events appear here the moment an agent acts.</Empty>
        ) : (
          <div className="stream">
            {shown.map((e) => (
              <div key={e.id} className={`stream-row kind-${e.kind}`}>
                <span className="mono tiny muted">{fmtClock(e.ts)}</span>
                <Badge>{e.kind}</Badge>
                <span className="stream-agent">{e.agent}</span>
                <span className="stream-node muted tiny">{e.node}</span>
                <span className="stream-content">{e.content}</span>
                <span className="stream-meta mono tiny muted">
                  {e.model ? <span title="model">{e.model.split(":").pop()}</span> : null}
                  {e.cost_usd ? <span>{fmtUsd(e.cost_usd)}</span> : null}
                  {e.latency_ms ? <span>{fmtMs(e.latency_ms)}</span> : null}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
