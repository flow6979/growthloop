import { useState } from "react";
import { api, type LoopSettings, type Product, type ProvidersResponse, type Settings } from "../api";
import { errMsg, useAsync } from "../lib";
import { Async, Card, ErrorBox, Field, Loading, PageHeader, useStatus } from "../components/ui";
import {
  AutonomyForm, ChannelsForm, HostedAiForm, ModelsForm, OwnerTimeForm, RuntimeForm, useSettingsDraft,
} from "../components/SettingsForms";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
// Never send these from a possibly stale draft: they are controlled elsewhere (top bar / wizard).
const NEVER_SEND = new Set<keyof Settings>(["kill_switch", "onboarded", "provider_keys_present"]);

export default function SettingsPage() {
  const { draft, patch, remote, dirty, setDirty } = useSettingsDraft();
  const providers = useAsync<ProvidersResponse>(() => api.providers(), []);
  const { status, refresh, toast } = useStatus();
  const [saving, setSaving] = useState(false);

  if (!draft) return remote.error ? <ErrorBox error={remote.error} onRetry={remote.reload} /> : <Loading />;
  const props = { value: draft, onChange: patch };

  const save = async () => {
    if (!remote.data) return;
    const body: Record<string, unknown> = {};
    for (const k of Object.keys(draft) as (keyof Settings)[]) {
      if (NEVER_SEND.has(k)) continue;
      if (JSON.stringify(draft[k]) !== JSON.stringify(remote.data[k])) body[k] = draft[k];
    }
    if (!Object.keys(body).length) {
      setDirty(false);
      return;
    }
    setSaving(true);
    try {
      const s = await api.putSettings(body as Partial<Settings>);
      remote.setData(s);
      setDirty(false);
      refresh();
      toast(`Saved: ${Object.keys(body).join(", ")}`);
    } catch (e) {
      toast(errMsg(e), "err");
    } finally {
      setSaving(false);
    }
  };

  const loop: LoopSettings = draft.loop ?? { daily_hour: 9, weekly_day: "mon", stall_cycles_before_pivot: 3, max_ideas_per_cycle: 12, max_experiments_per_cycle: 3 };
  const setLoop = (p: Partial<LoopSettings>) => patch({ loop: { ...loop, ...p } });

  return (
    <div className="page">
      <PageHeader title="Settings" sub="Everything from setup, plus loop schedule, prices and product."
        actions={<>
          {dirty && <span className="muted small">Unsaved changes</span>}
          <button className="btn" disabled={!dirty || saving} onClick={() => { setDirty(false); remote.reload(); }}>Discard</button>
          <button className="btn btn-primary" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        </>} />

      <Card title="Loop schedule & limits">
        <div className="grid-3">
          <Field label="Daily cycle hour (local, 0–23)">
            <input type="number" min={0} max={23} value={loop.daily_hour} onChange={(e) => setLoop({ daily_hour: Number(e.target.value) })} />
          </Field>
          <Field label="Weekly cycle day">
            <select value={loop.weekly_day} onChange={(e) => setLoop({ weekly_day: e.target.value })}>
              {DAYS.map((d) => <option key={d}>{d}</option>)}
            </select>
          </Field>
          <Field label="Stalled cycles before pivot review">
            <input type="number" min={1} max={20} value={loop.stall_cycles_before_pivot} onChange={(e) => setLoop({ stall_cycles_before_pivot: Number(e.target.value) })} />
          </Field>
          <Field label="Max ideas per cycle">
            <input type="number" min={3} max={60} value={loop.max_ideas_per_cycle} onChange={(e) => setLoop({ max_ideas_per_cycle: Number(e.target.value) })} />
          </Field>
          <Field label="Max experiments per cycle">
            <input type="number" min={1} max={10} value={loop.max_experiments_per_cycle} onChange={(e) => setLoop({ max_experiments_per_cycle: Number(e.target.value) })} />
          </Field>
          {loop.max_debate_turns !== undefined && (
            <Field label="Max debate turns">
              <input type="number" min={1} max={10} value={loop.max_debate_turns} onChange={(e) => setLoop({ max_debate_turns: Number(e.target.value) })} />
            </Field>
          )}
        </div>
      </Card>

      <Card title="Your time"><OwnerTimeForm {...props} /></Card>
      <Card title="Channels you post on"><ChannelsForm {...props} /></Card>
      <Card title="Models & budget"><ModelsForm {...props} providers={providers.data} /></Card>
      <Card title="Price overrides (USD per 1M tokens)">
        <PriceOverrides value={draft.price_overrides ?? {}} providers={providers.data} onChange={(v) => patch({ price_overrides: v })} />
      </Card>
      <Card title="Hosted AI allowance"><HostedAiForm {...props} productName={status?.product.name} /></Card>
      <Card title="Autonomy & developer executor"><AutonomyForm {...props} /></Card>
      <Card title="Runtime"><RuntimeForm {...props} /></Card>
      <Card title="Product"><ProductInfo active={draft.active_product} onChange={(id) => patch({ active_product: id })} /></Card>

      {dirty && (
        <div className="savebar">
          <span>You have unsaved changes.</span>
          <button className="btn" onClick={() => { setDirty(false); remote.reload(); }}>Discard</button>
          <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      )}
    </div>
  );
}

function PriceOverrides({ value, providers, onChange }: {
  value: Record<string, [number, number]>; providers?: ProvidersResponse; onChange: (v: Record<string, [number, number]>) => void;
}) {
  const [newSpec, setNewSpec] = useState("");
  if (!providers) return <Loading />;
  const specs = [...new Set([...Object.keys(providers.prices), ...Object.keys(value)])];
  const set = (spec: string, i: 0 | 1, v: string) => {
    const base = value[spec] ?? providers.prices[spec] ?? [0, 0];
    const next: [number, number] = [base[0], base[1]];
    next[i] = Number(v) || 0;
    onChange({ ...value, [spec]: next });
  };
  const clear = (spec: string) => {
    const n = { ...value };
    delete n[spec];
    onChange(n);
  };
  return (
    <div className="stack-s">
      <p className="muted small">Defaults are built in. Override when prices change, or to price Gemini paid-tier usage.</p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Model</th><th>Default in / out</th><th>Input</th><th>Output</th><th /></tr></thead>
          <tbody>
            {specs.map((s) => {
              const def = providers.prices[s];
              const cur = value[s] ?? def ?? [0, 0];
              const over = !!value[s];
              return (
                <tr key={s}>
                  <td className="mono small">{s}</td>
                  <td className="mono small muted">{def ? `${def[0]} / ${def[1]}` : "—"}</td>
                  <td><input type="number" step="0.01" min={0} className={`w-num ${over ? "overridden" : ""}`} value={cur[0]} onChange={(e) => set(s, 0, e.target.value)} /></td>
                  <td><input type="number" step="0.01" min={0} className={`w-num ${over ? "overridden" : ""}`} value={cur[1]} onChange={(e) => set(s, 1, e.target.value)} /></td>
                  <td>{over && <button className="btn btn-ghost btn-sm" onClick={() => clear(s)}>reset</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row gap-s">
        <input className="grow mono small" placeholder="add model, e.g. openrouter:meta-llama/llama-4" value={newSpec} onChange={(e) => setNewSpec(e.target.value)} />
        <button className="btn btn-sm" disabled={!newSpec.includes(":")} onClick={() => { onChange({ ...value, [newSpec.trim()]: [0, 0] }); setNewSpec(""); }}>Add</button>
      </div>
    </div>
  );
}

function ProductInfo({ active, onChange }: { active: string; onChange: (id: string) => void }) {
  const products = useAsync<Product[]>(() => api.products(), []);
  return (
    <Async state={products}>
      {(list) => {
        const p = list.find((x) => x.id === active) ?? list[0];
        return (
          <div className="stack-s">
            {list.length > 1 && (
              <Field label="Active product" hint="Takes effect on backend restart.">
                <select value={active} onChange={(e) => onChange(e.target.value)}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              </Field>
            )}
            {!p ? <div className="muted">No products found in products/*.yaml</div> : (
              <>
                <div className="kv-grid small">
                  <div><span>Name</span>{p.name}</div>
                  <div><span>URL</span>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.url}</a> : "—"}</div>
                  <div><span>Repo</span>{p.repo ? <a href={p.repo} target="_blank" rel="noreferrer">{p.repo}</a> : "—"}</div>
                  <div><span>North star</span>{p.north_star?.metric ?? "—"} · ladder {p.north_star?.ladder?.join(" → ")}</div>
                  <div><span>Deploy</span>{p.deploy?.kind ?? "—"}</div>
                  <div><span>Metrics adapter</span>{String((p.metrics as Record<string, unknown> | undefined)?.adapter ?? "manual")}</div>
                </div>
                {p.one_liner && <div className="small"><strong>One-liner (all the Dreamer sees):</strong> {p.one_liner}</div>}
                {p.context && <details className="small"><summary className="muted">Full context</summary><pre className="code">{p.context}</pre></details>}
                <div className="muted tiny">Edit <code>products/{p.id}.yaml</code> to change product details.</div>
              </>
            )}
          </div>
        );
      }}
    </Async>
  );
}
