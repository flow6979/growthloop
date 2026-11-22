import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type ProvidersResponse, type Settings } from "../api";
import { errMsg, useAsync } from "../lib";
import { ErrorBox, Loading, useStatus } from "../components/ui";
import {
  AutonomyForm, ChannelsForm, HostedAiForm, ModelsForm, OwnerTimeForm, RuntimeForm, useSettingsDraft,
} from "../components/SettingsForms";

const STEPS = [
  { key: "time", title: "Your time", sub: "How much of you the company can use" },
  { key: "channels", title: "Channels", sub: "Where you will post" },
  { key: "models", title: "Models", sub: "Which AI runs the company" },
  { key: "hosted", title: "Hosted AI", sub: "Should users get free AI?" },
  { key: "autonomy", title: "Autonomy", sub: "What agents may do alone" },
  { key: "runtime", title: "Runtime", sub: "Where it runs" },
] as const;

const ONBOARDING_KEYS: (keyof Settings)[] = [
  "owner_minutes_per_day", "owner_channels", "model_tier", "llm_budget_usd_per_day", "hosted_ai_allowance",
  "autonomy", "dev_executor", "runtime_target",
];

export default function Setup() {
  const { draft, patch, remote } = useSettingsDraft();
  const providers = useAsync<ProvidersResponse>(() => api.providers(), []);
  const { status, refresh, toast } = useStatus();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const nav = useNavigate();

  if (!draft) return remote.error ? <ErrorBox error={remote.error} onRetry={remote.reload} /> : <Loading />;

  const finish = async () => {
    setSaving(true);
    setErr(null);
    try {
      const body: Partial<Settings> = {};
      for (const k of ONBOARDING_KEYS) (body as Record<string, unknown>)[k] = draft[k];
      await api.onboarding(body);
      sessionStorage.removeItem("gl_skip_setup");
      toast("Setup saved. Run your first cycle from the top bar.");
      refresh();
      nav("/");
    } catch (e) {
      setErr(e);
      toast(errMsg(e), "err");
    } finally {
      setSaving(false);
    }
  };

  const cur = STEPS[step];
  const props = { value: draft, onChange: patch };
  const last = step === STEPS.length - 1;

  return (
    <div className="wizard">
      <div className="wizard-head">
        <div>
          <h1>Set up your AI company</h1>
          <p className="muted">
            {status?.onboarded
              ? "You already finished setup. Changing anything here re-saves it (Settings has the same options)."
              : `Six quick questions before the agents start working on ${status?.product.name ?? "your product"}.`}
          </p>
        </div>
        {!status?.onboarded && (
          <button className="btn btn-ghost btn-sm" onClick={() => {
            sessionStorage.setItem("gl_skip_setup", "1");
            nav("/");
          }}>Skip for now</button>
        )}
      </div>
      <ol className="steps">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === step ? "active" : i < step ? "done" : ""}>
            <button onClick={() => setStep(i)}>
              <span className="step-n">{i < step ? "✓" : i + 1}</span>
              <span className="step-t">{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <section className="card wizard-card">
        <div className="card-head">
          <h3>{cur.title}<span className="muted"> · {cur.sub}</span></h3>
          <span className="muted small">Step {step + 1} of {STEPS.length}</span>
        </div>
        <div className="card-body">
          {cur.key === "time" && <OwnerTimeForm {...props} />}
          {cur.key === "channels" && <ChannelsForm {...props} />}
          {cur.key === "models" && <ModelsForm {...props} providers={providers.data} />}
          {cur.key === "hosted" && <HostedAiForm {...props} productName={status?.product.name ?? "the product"} />}
          {cur.key === "autonomy" && <AutonomyForm {...props} />}
          {cur.key === "runtime" && <RuntimeForm {...props} />}
        </div>
        {err ? <div className="card-body"><ErrorBox error={err} /></div> : null}
        <div className="wizard-foot">
          <button className="btn" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>← Back</button>
          {last ? (
            <button className="btn btn-primary" disabled={saving} onClick={finish}>
              {saving ? "Saving…" : "Finish setup"}
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>Next →</button>
          )}
        </div>
      </section>
    </div>
  );
}
