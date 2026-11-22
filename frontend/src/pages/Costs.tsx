import { api, type CostsResponse } from "../api";
import { fmtTokens, fmtUsd, useAsync } from "../lib";
import { Async, Card, PageHeader, Progress, Stat } from "../components/ui";
import { BarList, ColumnChart } from "../components/charts";

export default function Costs() {
  const c = useAsync<CostsResponse>(() => api.costs(), [], 30000);
  return (
    <div className="page">
      <PageHeader title="Costs" sub="LLM spend by agent, model and day. Gemini free-tier calls cost $0 within quota." />
      <Async state={c}>
        {(d) => {
          const total = d.by_day.reduce((a, r) => a + (r.cost || 0), 0);
          const calls = d.by_day.reduce((a, r) => a + (r.calls || 0), 0);
          const tokens = d.by_day.reduce((a, r) => a + (r.tokens || 0), 0);
          const over = d.budget_per_day > 0 && d.spend_24h >= d.budget_per_day;
          return (
            <div className="stack">
              <div className="stat-grid stat-grid-4">
                <Stat label="Spend (24h)" value={fmtUsd(d.spend_24h, 2)} tone={over ? "red" : undefined}
                  sub={<>
                    <Progress value={d.spend_24h} max={d.budget_per_day || 1} tone={over ? "red" : undefined} />
                    <span className="muted">{d.budget_per_day > 0 ? `of ${fmtUsd(d.budget_per_day, 2)}/day budget` : "no paid budget set"}</span>
                  </>} />
                <Stat label="All-time spend" value={fmtUsd(total, 2)} />
                <Stat label="LLM calls" value={calls.toLocaleString()} />
                <Stat label="Tokens" value={fmtTokens(tokens)} />
              </div>
              <Card title="Cost per day">
                <ColumnChart points={d.by_day.map((r) => ({ x: r.day, y: r.cost || 0 }))} format={(v) => fmtUsd(v, v < 1 ? 3 : 2)}
                  refLine={d.budget_per_day || undefined} />
                {d.budget_per_day > 0 && <div className="muted tiny">Dashed line: daily budget</div>}
              </Card>
              <div className="grid-2">
                <Card title="By agent">
                  <BarList rows={d.by_agent.map((r) => ({ label: r.key ?? "unknown", value: r.cost || 0, sub: `${r.calls} calls · ${fmtTokens((r.tin || 0) + (r.tout || 0))} tok` }))}
                    format={(v) => fmtUsd(v)} />
                </Card>
                <Card title="By model">
                  <BarList rows={d.by_model.map((r) => ({ label: r.key || "unknown", value: r.cost || 0, sub: `${r.calls} calls · ${fmtTokens((r.tin || 0) + (r.tout || 0))} tok` }))}
                    format={(v) => fmtUsd(v)} />
                </Card>
              </div>
            </div>
          );
        }}
      </Async>
    </div>
  );
}
