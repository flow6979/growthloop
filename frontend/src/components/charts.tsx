import { useEffect, useState } from "react";

/** Measure container width so SVG text is never stretched. */
function useWidth(fallback = 640) {
  const [el, ref] = useState<HTMLDivElement | null>(null);
  const [w, setW] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [ref, w] as const;
}

export interface Point { x: string; y: number }

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * p;
}

/** Simple responsive line chart with optional horizontal reference line (e.g. target). */
export function LineChart({ points, height = 200, refLine, refLabel, format = (v) => String(v), yMax }: {
  points: Point[]; height?: number; refLine?: number | null; refLabel?: string;
  format?: (v: number) => string; yMax?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  const H = height;
  const pad = { l: 40, r: 12, t: 12, b: 24 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const maxV = yMax ?? niceMax(Math.max(...points.map((p) => p.y), refLine ?? 0, 1));
  const x = (i: number) => pad.l + (points.length <= 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - (v / maxV) * ih;
  const path = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join("");
  const area = points.length
    ? `${path}L${x(points.length - 1).toFixed(1)},${pad.t + ih}L${x(0).toFixed(1)},${pad.t + ih}Z`
    : "";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * maxV);
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(W / 90))));

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height }} role="img"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          if (!points.length) return;
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * W;
          const i = points.length <= 1 ? 0 : Math.round(((px - pad.l) / iw) * (points.length - 1));
          setHover(Math.max(0, Math.min(points.length - 1, i)));
        }}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="axis">{format(Math.round(t * 100) / 100)}</text>
          </g>
        ))}
        {points.map((p, i) =>
          i % labelEvery === 0 || i === points.length - 1 ? (
            <text key={p.x + i} x={x(i)} y={H - 6} textAnchor="middle" className="axis">{p.x.slice(5)}</text>
          ) : null)}
        {refLine != null && refLine <= maxV && (
          <g>
            <line x1={pad.l} x2={W - pad.r} y1={y(refLine)} y2={y(refLine)} className="refline" />
            <text x={W - pad.r} y={y(refLine) - 4} textAnchor="end" className="axis ref-label">
              {refLabel ?? format(refLine)}
            </text>
          </g>
        )}
        <path d={area} className="area" />
        <path d={path} className="line" />
        {points.length <= 40 && points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.y)} r={2.5} className="dot" />)}
        {hover !== null && points[hover] && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} className="hoverline" />
            <circle cx={x(hover)} cy={y(points[hover].y)} r={4} className="dot dot-hover" />
          </g>
        )}
      </svg>
      {hover !== null && points[hover] && (
        <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <div className="muted">{points[hover].x}</div>
          <strong>{format(points[hover].y)}</strong>
        </div>
      )}
    </div>
  );
}

export function Sparkline({ values, width = 90, height = 24, max }: {
  values: number[]; width?: number; height?: number; max?: number;
}) {
  if (!values.length) return <span className="muted">—</span>;
  const m = max ?? Math.max(...values, 1e-9);
  const min = max !== undefined ? 0 : Math.min(...values, 0);
  const span = m - min || 1;
  const x = (i: number) => (values.length === 1 ? width / 2 : (i / (values.length - 1)) * (width - 4) + 2);
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  return (
    <svg width={width} height={height} className="spark">
      <path d={d} className="line" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={2.2} className="dot" />
    </svg>
  );
}

/** Horizontal labelled bars. */
export function BarList({ rows, format = (v) => String(v), empty = "No data" }: {
  rows: { label: string; value: number; sub?: string }[]; format?: (v: number) => string; empty?: string;
}) {
  if (!rows.length) return <div className="muted small">{empty}</div>;
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <div className="barlist">
      {rows.map((r) => (
        <div key={r.label} className="barlist-row">
          <div className="barlist-label" title={r.label}>{r.label}</div>
          <div className="barlist-track">
            <div className="barlist-bar" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
          <div className="barlist-value">
            {format(r.value)}
            {r.sub && <span className="muted"> · {r.sub}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Vertical column chart, e.g. cost per day. */
export function ColumnChart({ points, height = 160, format = (v) => String(v), refLine }: {
  points: Point[]; height?: number; format?: (v: number) => string; refLine?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, W] = useWidth();
  if (!points.length) return <div className="muted small" ref={ref}>No data</div>;
  const H = height;
  const pad = { l: 44, r: 8, t: 10, b: 22 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const maxV = Math.max(...points.map((p) => p.y), refLine ?? 0) * 1.1 || 1;
  const bw = iw / points.length;
  const y = (v: number) => pad.t + ih - (v / maxV) * ih;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(W / 70))));
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height }} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={pad.l} x2={W - pad.r} y1={y(f * maxV)} y2={y(f * maxV)} className="grid" />
            <text x={pad.l - 6} y={y(f * maxV) + 3} textAnchor="end" className="axis">{format(f * maxV)}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <g key={p.x + i} onMouseEnter={() => setHover(i)}>
            <rect x={pad.l + i * bw} y={pad.t} width={bw} height={ih} fill="transparent" />
            <rect x={pad.l + i * bw + bw * 0.15} y={y(p.y)} width={bw * 0.7} height={Math.max(0, pad.t + ih - y(p.y))}
              className={`col ${hover === i ? "col-hover" : ""}`} rx={2} />
            {(i % labelEvery === 0 || i === points.length - 1) && (
              <text x={pad.l + i * bw + bw / 2} y={H - 6} textAnchor="middle" className="axis">{p.x.slice(5)}</text>
            )}
          </g>
        ))}
        {refLine != null && refLine > 0 && (
          <line x1={pad.l} x2={W - pad.r} y1={y(refLine)} y2={y(refLine)} className="refline" />
        )}
      </svg>
      {hover !== null && (
        <div className="chart-tip" style={{ left: `${((pad.l + hover * bw + bw / 2) / W) * 100}%` }}>
          <div className="muted">{points[hover].x}</div>
          <strong>{format(points[hover].y)}</strong>
        </div>
      )}
    </div>
  );
}
