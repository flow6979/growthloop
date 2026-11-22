import { useState } from "react";
import { api, type OrgRole, type ProvidersResponse } from "../api";
import { errMsg, useAsync } from "../lib";
import { Async, AsyncButton, Badge, Modal, PageHeader, useStatus } from "../components/ui";

const DEPT_ORDER = ["Exec", "Strategy", "Product", "Engineering", "Growth", "People & Trust"];
const HIGHLIGHT: Record<string, string> = {
  dreamer: "Blind context: sees only the one-liner and the goal, so it is not anchored by data or the backlog.",
  maverick: "Contrarian: must break at least one core assumption each cycle (audience, name, model, even the product).",
  skeptic: "Kills bad ideas, predicts lift and P(success); scored on calibration against real outcomes.",
};

export default function Org() {
  const org = useAsync<OrgRole[]>(() => api.org(), []);
  const providers = useAsync<ProvidersResponse>(() => api.providers(), []);
  const [editing, setEditing] = useState<OrgRole | null>(null);

  const replace = (r: OrgRole) => org.setData((prev) => (prev ?? []).map((x) => (x.key === r.key ? r : x)));
  const models = providers.data
    ? Object.entries(providers.data.providers).flatMap(([p, m]) => m.models.map((x) => `${p}:${x}`))
    : [];

  return (
    <div className="page page-wide">
      <PageHeader title="Org chart" sub="A role = prompt + model + context scope + eval rubric. Toggle roles, override models, edit prompts." />
      <datalist id="model-options">{models.map((m) => <option key={m} value={m} />)}</datalist>
      <Async state={org}>
        {(roles) => {
          const depts = [...new Set([...DEPT_ORDER, ...roles.map((r) => r.dept)])].filter((d) => roles.some((r) => r.dept === d));
          return (
            <div className="org">
              {depts.map((d) => (
                <section key={d} className="dept">
                  <h2 className="dept-title">{d} <span className="muted small">{roles.filter((r) => r.dept === d && r.active).length}/{roles.filter((r) => r.dept === d).length} active</span></h2>
                  <div className="role-grid">
                    {roles.filter((r) => r.dept === d).map((r) => <RoleCard key={r.key} r={r} onChange={replace} onEdit={() => setEditing(r)} />)}
                  </div>
                </section>
              ))}
            </div>
          );
        }}
      </Async>
      {editing && <PromptEditor r={editing} onClose={() => setEditing(null)} onSaved={(r) => { replace(r); setEditing(null); }} />}
    </div>
  );
}

function RoleCard({ r, onChange, onEdit }: { r: OrgRole; onChange: (r: OrgRole) => void; onEdit: () => void }) {
  const { toast } = useStatus();
  const [model, setModel] = useState(r.model_override ?? "");
  const hl = HIGHLIGHT[r.key];
  return (
    <article className={`card role ${r.active ? "" : "inactive"} ${hl ? "role-hl" : ""}`}>
      <div className="card-body stack-s">
        <div className="row between gap-s">
          <div>
            <div className="role-title">{r.title}</div>
            <div className="row gap-s tiny">
              <span className="mono muted">{r.key}</span>
              {r.core && <Badge tone="blue">core</Badge>}
              {r.context === "blind" && <Badge tone="violet">blind context</Badge>}
              <Badge tone="gray">{r.model_class}</Badge>
            </div>
          </div>
          <label className="switch" title={r.active ? "Active" : "Inactive"}>
            <input type="checkbox" checked={r.active} onChange={async (e) => {
              try {
                onChange(await api.updateRole(r.key, { active: e.target.checked }));
              } catch (er) {
                toast(errMsg(er), "err");
              }
            }} />
            <span />
          </label>
        </div>
        {hl && <div className="role-note small">{hl}</div>}
        <div className="small">
          <span className="muted">Model in use: </span><span className="mono">{r.model}</span>
        </div>
        <div className="row gap-s">
          <input list="model-options" className="grow mono small" placeholder="override, e.g. anthropic:claude-opus-5-5"
            value={model} onChange={(e) => setModel(e.target.value)} />
          <AsyncButton className="btn btn-sm" disabled={model === (r.model_override ?? "")} onClick={async () => {
            onChange(await api.updateRole(r.key, { model: model.trim() }));
            toast(model.trim() ? `${r.title} → ${model.trim()}` : `${r.title}: override cleared`);
          }}>Set</AsyncButton>
        </div>
        {r.model_override && r.model !== r.model_override && (
          <div className="tiny warn">Override provider has no key, so the tier model is used.</div>
        )}
        {r.rubric.length > 0 && (
          <details className="small">
            <summary className="muted">Eval rubric ({r.rubric.length})</summary>
            <ul>{r.rubric.map((x) => <li key={x}>{x}</li>)}</ul>
          </details>
        )}
        <div className="row between">
          <span className="small">
            <span className="muted">Eval avg: </span>
            {r.eval_avg != null ? <strong className={r.eval_avg >= 0.7 ? "pos" : r.eval_avg >= 0.5 ? "warn" : "neg"}>{r.eval_avg.toFixed(2)}</strong> : "—"}
            <span className="muted tiny"> (n={r.eval_n})</span>
          </span>
          <button className="btn btn-sm btn-ghost" onClick={onEdit}>
            Prompt{r.prompt_overridden ? " (edited)" : ""} ✎
          </button>
        </div>
      </div>
    </article>
  );
}

function PromptEditor({ r, onClose, onSaved }: { r: OrgRole; onClose: () => void; onSaved: (r: OrgRole) => void }) {
  const [text, setText] = useState(r.prompt);
  const { toast } = useStatus();
  return (
    <Modal title={`${r.title} prompt`} onClose={onClose} wide>
      <div className="stack-s">
        <p className="muted small">
          The company rules and product context are added automatically. {r.prompt_overridden ? "This prompt is overridden." : "This is the default prompt."}
        </p>
        <textarea rows={14} className="mono small" value={text} onChange={(e) => setText(e.target.value)} />
        <div className="row gap end">
          {r.prompt_overridden && (
            <AsyncButton className="btn" onClick={async () => {
              onSaved(await api.updateRole(r.key, { prompt: "" }));
              toast("Prompt reset to default");
            }}>Reset to default</AsyncButton>
          )}
          <button className="btn" onClick={onClose}>Cancel</button>
          <AsyncButton className="btn btn-primary" disabled={!text.trim() || text === r.prompt} onClick={async () => {
            onSaved(await api.updateRole(r.key, { prompt: text }));
            toast("Prompt saved");
          }}>Save</AsyncButton>
        </div>
      </div>
    </Modal>
  );
}
