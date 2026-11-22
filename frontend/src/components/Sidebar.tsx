import { NavLink } from "react-router-dom";

// 16px stroke icons (simple paths, no icon library)
const ICONS: Record<string, string> = {
  overview: "M3 13h4v8H3zM10 9h4v12h-4zM17 4h4v17h-4z",
  live: "M2 12h4l3-8 4 16 3-8h6",
  boardroom: "M4 5h16v11H4zM8 20h8M12 16v4",
  experiments: "M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3",
  inbox: "M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5",
  recommendations: "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
  evals: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  traces: "M4 6h16M4 12h10M4 18h13",
  costs: "M12 2v20M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
  guardrails: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  org: "M12 3v6M5 15v-3h14v3M3 15h4v5H3zM10 15h4v5h-4zM17 15h4v5h-4zM9 3h6v6H9z",
  learnings: "M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13",
  feedback: "M4 4h16v12H8l-4 4z",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-1-3-2 .3-1.3-1.3.3-2-3-1-1 2h-2l-1-2-3 1 .3 2L6 8.3 4 8l-1 3 2 1v0l-2 1 1 3 2-.3 1.3 1.3-.3 2 3 1 1-2h2l1 2 3-1-.3-2 1.3-1.3 2 .3 1-3z",
  setup: "M5 12l5 5L20 7",
  public: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18",
};

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

const SECTIONS: { title: string; items: { to: string; label: string; icon: string }[] }[] = [
  {
    title: "Company",
    items: [
      { to: "/", label: "Overview", icon: "overview" },
      { to: "/live", label: "Live", icon: "live" },
      { to: "/boardroom", label: "Boardroom", icon: "boardroom" },
      { to: "/experiments", label: "Experiments", icon: "experiments" },
      { to: "/inbox", label: "Inbox", icon: "inbox" },
      { to: "/recommendations", label: "Recommendations", icon: "recommendations" },
    ],
  },
  {
    title: "Observe",
    items: [
      { to: "/evals", label: "Evals", icon: "evals" },
      { to: "/traces", label: "Traces", icon: "traces" },
      { to: "/costs", label: "Costs", icon: "costs" },
      { to: "/guardrails", label: "Guardrails", icon: "guardrails" },
    ],
  },
  {
    title: "Org",
    items: [
      { to: "/org", label: "Org chart", icon: "org" },
      { to: "/learnings", label: "Learnings", icon: "learnings" },
      { to: "/feedback", label: "Feedback", icon: "feedback" },
    ],
  },
  {
    title: "Configure",
    items: [
      { to: "/settings", label: "Settings", icon: "settings" },
      { to: "/setup", label: "Setup wizard", icon: "setup" },
    ],
  },
];

export function Sidebar({ pending, onClose }: { pending: number; onClose: () => void }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <svg viewBox="0 0 32 32" width="22" height="22">
            <rect width="32" height="32" rx="7" fill="var(--accent)" />
            <path d="M8 21l5-6 4 3 7-9" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <div className="brand-name">GrowthLoop</div>
          <div className="brand-sub">Mission Control</div>
        </div>
        <button className="btn btn-ghost btn-sm nav-close" onClick={onClose} aria-label="Close menu">✕</button>
      </div>
      <nav>
        {SECTIONS.map((s) => (
          <div key={s.title} className="nav-section">
            <div className="nav-title">{s.title}</div>
            {s.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === "/"} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}>
                <Icon name={i.icon} />
                <span>{i.label}</span>
                {i.to === "/inbox" && pending > 0 && <span className="nav-count">{pending}</span>}
              </NavLink>
            ))}
          </div>
        ))}
        <div className="nav-section">
          <a className="nav-item" href="/public" target="_blank" rel="noreferrer">
            <Icon name="public" />
            <span>Public results ↗</span>
          </a>
        </div>
      </nav>
    </aside>
  );
}
