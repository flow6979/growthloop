import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, type CycleKind } from "../api";
import { errMsg, fmtNum, fmtUsd } from "../lib";
import { useStatus } from "./ui";
import { Icon } from "./Sidebar";

export function TopBar({ onMenu }: { onMenu: () => void }) {
  const { status: s, refresh, toast } = useStatus();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menu]);

  const act = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
      refresh();
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setBusy(null);
    }
  };

  const run = (kind: CycleKind) => {
    setMenu(false);
    act(`run-${kind}`, () => api.runCycle(kind), `${kind} cycle started`);
  };

  const g = s?.goal;
  const cur = g?.current_7d ?? null;
  const cyc = s?.current_cycle;
  const loopLabel = !s
    ? "—"
    : s.kill_switch
      ? "killed"
      : cyc?.status === "waiting_approval"
        ? "waiting for your approval"
        : s.busy
          ? "cycle running"
          : s.loop_running
          ? "loop running"
          : "paused";
  const loopTone = !s ? "gray" : s.kill_switch ? "red" : cyc?.status === "waiting_approval" ? "amber" : s.busy ? "blue" : s.loop_running ? "green" : "gray";
  const overBudget = s && s.budget_per_day > 0 && s.spend_24h >= s.budget_per_day;

  return (
    <header className="topbar">
      <button className="btn btn-ghost btn-icon menu-btn" onClick={onMenu} aria-label="Menu">☰</button>
      <div className="topbar-product">
        <div className="product-name">{s?.product.name ?? "GrowthLoop"}</div>
        {g && (
          <Link to="/" className="goal-pill" title={g.definition}>
            <span className="muted">{g.metric.toUpperCase()}</span>{" "}
            <strong>{cur === null ? "—" : fmtNum(cur)}</strong>
            <span className="muted"> / {g.target}</span>
          </Link>
        )}
        <span className={`loop-state tone-${loopTone}`}>
          <span className={`dot-live ${s?.busy || s?.loop_running ? "pulse" : ""}`} /> {loopLabel}
        </span>
      </div>

      <div className="topbar-actions">
        <Link to="/costs" className={`spend ${overBudget ? "over" : ""}`} title="LLM spend in the last 24h vs daily budget">
          {fmtUsd(s?.spend_24h ?? 0, 2)}
          <span className="muted"> / {s && s.budget_per_day > 0 ? fmtUsd(s.budget_per_day, 2) : "free"} 24h</span>
        </Link>
        <Link to="/inbox" className="btn btn-ghost btn-icon inbox-btn" title="Inbox">
          <Icon name="inbox" />
          {!!s?.pending_inbox && <span className="count-badge">{s.pending_inbox}</span>}
        </Link>
        {s?.loop_running ? (
          <button className="btn" disabled={!!busy} onClick={() => act("pause", api.loopPause, "Loop paused")}>
            ❚❚ Pause
          </button>
        ) : (
          <button className="btn" disabled={!!busy || !s || s.kill_switch}
            onClick={() => act("start", api.loopStart, "Loop started")}
            title={s?.kill_switch ? "Turn off the kill switch first" : "Run cycles on schedule"}>
            ▶ Start loop
          </button>
        )}
        <div className="dropdown" ref={ref}>
          <button className="btn btn-primary" disabled={!s || s.kill_switch || s.busy || !!busy}
            title={s?.busy ? "A cycle is already running" : "Run one cycle now"}
            onClick={() => setMenu((m) => !m)}>
            {busy?.startsWith("run") ? "Starting…" : "Run cycle ▾"}
          </button>
          {menu && (
            <div className="dropdown-menu">
              <button onClick={() => run("daily")}>
                <strong>Daily</strong>
                <span>Read out experiments, sense metrics, evals</span>
              </button>
              <button onClick={() => run("weekly")}>
                <strong>Weekly</strong>
                <span>Full cycle: ideate → validate → CEO → build → content</span>
              </button>
              <button onClick={() => run("pivot")}>
                <strong>Pivot review</strong>
                <span>Weekly cycle where Maverick questions everything</span>
              </button>
            </div>
          )}
        </div>
        {s?.kill_switch ? (
          <button className="btn btn-danger-outline" disabled={!!busy}
            onClick={() => window.confirm("Turn the kill switch off? The loop stays paused until you start it.") &&
              act("kill", () => api.kill(false), "Kill switch off")}>
            Kill switch ON
          </button>
        ) : (
          <button className="btn btn-danger" disabled={!!busy || !s}
            title="Stop everything: pauses the loop and blocks all LLM calls"
            onClick={() => act("kill", () => api.kill(true), "Kill switch ON: everything stopped")}>
            ■ Kill
          </button>
        )}
      </div>
    </header>
  );
}
