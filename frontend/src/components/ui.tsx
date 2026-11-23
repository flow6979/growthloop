import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { isNetworkError, type Status } from "../api";
import { errMsg } from "../lib";

// ---------------- status context (polled by App) ----------------

export interface StatusCtx {
  status: Status | undefined;
  error: unknown;
  refresh: () => void;
  toast: (msg: string, kind?: "ok" | "err") => void;
}

export const StatusContext = createContext<StatusCtx>({
  status: undefined, error: null, refresh: () => {}, toast: () => {},
});

export const useStatus = () => useContext(StatusContext);

// ---------------- layout ----------------

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{headline(title)}</h1>
        {sub && <p className="muted">{sub}</p>}
      </div>
      {actions && <div className="row gap">{actions}</div>}
    </div>
  );
}

/** Big ink heading with the last word under a lime highlighter, plus a full stop. */
export function headline(title: string) {
  const i = title.lastIndexOf(" ");
  const head = i < 0 ? "" : title.slice(0, i + 1);
  const last = i < 0 ? title : title.slice(i + 1);
  return <>{head}<span className="hl">{last}</span>.</>;
}

export function Card({ title, actions, children, className = "", pad = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <h3>{title}</h3>
          {actions && <div className="row gap-s">{actions}</div>}
        </div>
      )}
      <div className={pad ? "card-body" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className={`stat ${tone ? `tone-${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ---------------- states ----------------

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="state">
      <span className="spinner" /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state empty">
      <div className="empty-title">{title}</div>
      {children && <div className="muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  const down = isNetworkError(error);
  return (
    <div className="alert alert-err">
      <div>
        <strong>{down ? "Backend unreachable." : "Request failed."}</strong>{" "}
        {down ? (
          <>
            Start the backend: <code>make dev</code>
          </>
        ) : (
          errMsg(error)
        )}
      </div>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Renders loading / error / content for an async state. */
export function Async<T>({ state, children, empty }: {
  state: { data: T | undefined; error: unknown; loading: boolean; reload: () => void };
  children: (d: T) => ReactNode;
  empty?: (d: T) => ReactNode | null;
}) {
  if (state.data === undefined) {
    if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
    return <Loading />;
  }
  const e = empty?.(state.data);
  return (
    <>
      {state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : null}
      {e ?? children(state.data)}
    </>
  );
}

// ---------------- small bits ----------------

const BADGE_TONES: Record<string, string> = {
  // event kinds
  llm: "violet", tool: "blue", info: "gray", error: "red", guardrail: "amber", decision: "green",
  node_start: "cyan", node_end: "gray",
  // statuses
  running: "blue", waiting_approval: "amber", done: "green", failed: "red",
  pending: "amber", approved: "green", rejected: "red",
  planned: "gray", awaiting_approval: "amber", spec_ready: "cyan", ready_to_build: "blue",
  awaiting_merge: "violet", live: "blue", won: "green", lost: "red", inconclusive: "gray",
  blocked: "red", qa_failed: "red",
  killed: "red", parked: "gray", shortlisted: "cyan", selected: "green", proposed: "gray",
  open: "blue", accepted: "green", dismissed: "gray",
  high: "red", medium: "amber", low: "green",
  T0: "gray", T1: "cyan", T2: "blue", T3: "violet", T4: "red",
  auto: "green", approve: "amber", owner_posts: "violet",
  flagged: "amber",
};

export function Badge({ children, tone }: { children: ReactNode; tone?: string }) {
  const t = tone ?? (typeof children === "string" ? BADGE_TONES[children] : undefined) ?? "gray";
  return <span className={`badge badge-${t}`}>{typeof children === "string" ? children.replace(/_/g, " ") : children}</span>;
}

export function Chip({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <span className={`chip ${tone ? `badge-${tone}` : ""}`}>
      <span className="chip-label">{label}</span> {value}
    </span>
  );
}

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? "modal-wide" : ""}`} onMouseDown={(e) => e.stopPropagation()} role="dialog">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode }[];
}) {
  return (
    <div className="tabs" role="tablist">
      {options.map((o) => (
        <button key={o.value} role="tab" className={`tab ${o.value === value ? "active" : ""}`}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function JsonView({ value }: { value: unknown }) {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    text = String(value);
  }
  return <pre className="code">{text}</pre>;
}

export function Collapsible({ label, children, defaultOpen = false }: {
  label: ReactNode; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="collapsible">
      <button className="collapsible-head" onClick={() => setOpen((o) => !o)}>
        <span className={`caret ${open ? "open" : ""}`}>▸</span> {label}
      </button>
      {open && <div className="collapsible-body">{children}</div>}
    </div>
  );
}

/** Button that shows a busy state while its async onClick runs and toasts errors. */
export function AsyncButton({ onClick, children, className = "btn", disabled, title }: {
  onClick: () => Promise<unknown>; children: ReactNode; className?: string; disabled?: boolean; title?: string;
}) {
  const [busy, setBusy] = useState(false);
  const { toast } = useStatus();
  return (
    <button className={className} disabled={disabled || busy} title={title}
      onClick={async () => {
        setBusy(true);
        try {
          await onClick();
        } catch (e) {
          toast(errMsg(e), "err");
        } finally {
          setBusy(false);
        }
      }}>
      {busy && <span className="spinner spinner-s" />} {children}
    </button>
  );
}

export function Progress({ value, max, tone }: { value: number; max: number; tone?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div className="progress">
      <div className={`progress-bar ${tone ? `bg-${tone}` : ""}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
