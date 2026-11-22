import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api, isNetworkError } from "./api";
import { useAsync } from "./lib";
import { StatusContext } from "./components/ui";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { FeedbackFab } from "./components/FeedbackFab";
import Overview from "./pages/Overview";
import Setup from "./pages/Setup";
import Live from "./pages/Live";
import Boardroom from "./pages/Boardroom";
import Experiments from "./pages/Experiments";
import Inbox from "./pages/Inbox";
import Recommendations from "./pages/Recommendations";
import Evals from "./pages/Evals";
import Traces from "./pages/Traces";
import Costs from "./pages/Costs";
import Guardrails from "./pages/Guardrails";
import Org from "./pages/Org";
import Learnings from "./pages/Learnings";
import Feedback from "./pages/Feedback";
import SettingsPage from "./pages/Settings";
import PublicResults from "./pages/PublicResults";

interface Toast { id: number; msg: string; kind: "ok" | "err" }

export default function App() {
  const location = useLocation();
  if (location.pathname.startsWith("/public")) return <PublicResults />;
  return <Shell />;
}

function Shell() {
  const location = useLocation();
  const status = useAsync(() => api.status(), [], 5000);
  const [navOpen, setNavOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, msg, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "err" ? 6000 : 3000);
  }, []);

  useEffect(() => setNavOpen(false), [location.pathname]);

  const s = status.data;
  const skipped = sessionStorage.getItem("gl_skip_setup") === "1";
  const needsSetup = s && !s.onboarded && !skipped && location.pathname !== "/setup";
  const backendDown = !!status.error && isNetworkError(status.error);

  return (
    <StatusContext.Provider value={{ status: s, error: status.error, refresh: status.reload, toast }}>
      <div className={`shell ${navOpen ? "nav-open" : ""}`}>
        <Sidebar pending={s?.pending_inbox ?? 0} onClose={() => setNavOpen(false)} />
        <div className="nav-scrim" onClick={() => setNavOpen(false)} />
        <div className="main">
          <TopBar onMenu={() => setNavOpen((o) => !o)} />
          {backendDown && (
            <div className="banner banner-err">
              <strong>Backend unreachable.</strong> Start the backend: <code>make dev</code> (API on :8600). Retrying every 5s…
            </div>
          )}
          {s?.kill_switch && (
            <div className="banner banner-warn">
              <strong>Kill switch is ON.</strong> No agent work runs and no LLM calls are made until you turn it off.
            </div>
          )}
          <main className="content">
            {needsSetup ? (
              <Navigate to="/setup" replace />
            ) : (
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="/live" element={<Live />} />
                <Route path="/boardroom" element={<Boardroom />} />
                <Route path="/boardroom/:id" element={<Boardroom />} />
                <Route path="/experiments" element={<Experiments />} />
                <Route path="/inbox" element={<Inbox />} />
                <Route path="/recommendations" element={<Recommendations />} />
                <Route path="/evals" element={<Evals />} />
                <Route path="/traces" element={<Traces />} />
                <Route path="/costs" element={<Costs />} />
                <Route path="/guardrails" element={<Guardrails />} />
                <Route path="/org" element={<Org />} />
                <Route path="/learnings" element={<Learnings />} />
                <Route path="/feedback" element={<Feedback />} />
                <Route path="/settings" element={<SettingsPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            )}
          </main>
        </div>
        <FeedbackFab />
        <div className="toasts">
          {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.kind}`}>{t.msg}</div>
          ))}
        </div>
      </div>
    </StatusContext.Provider>
  );
}
