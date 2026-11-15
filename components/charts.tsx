"use client";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { RouteAlt, Risk } from "@/lib/types";
import { STRATEGY_COLOR, STRATEGY_LABEL } from "@/lib/format";

const AX = { stroke: "#6c7a89", fontSize: 11 };
const GRID = "#1b2531";
const TIP = { contentStyle: { background: "#0f141a", border: "1px solid #243040", borderRadius: 6, fontSize: 12 }, labelStyle: { color: "#9aa7b5" } };

type ProfileRoute = Pick<RouteAlt, "strategy" | "profile">;
export function ProfileChart({ routes, maxSlope, show, source = "463 m MOLA DEM, bilinear-interpolated along the route" }: { routes: ProfileRoute[]; maxSlope: number; show: string[]; source?: string }) {
  const sel = routes.filter(r => show.includes(r.strategy));
  const rows = (r: ProfileRoute, key: "elevation_m" | "slope_deg") => r.profile.distance_km.map((d, i) => ({ d: +d.toFixed(3), v: r.profile[key][i] }));
  return (
    <div className="stack" role="group" aria-label="Elevation and slope profile along route">
      <div className="tiny muted">Elevation (m above MOLA areoid) vs distance (km). Source: {source}.</div>
      <ResponsiveContainer width="100%" height={190}>
        <ComposedChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} /><XAxis type="number" dataKey="d" {...AX} domain={[0, "dataMax"]} unit=" km" /><YAxis {...AX} width={52} domain={["auto", "auto"]} />
          <Tooltip {...TIP} formatter={(v) => (typeof v === "number" ? `${v.toFixed(0)} m` : "—")} labelFormatter={d => `${d} km`} />
          {sel.map(r => <Line key={r.strategy} data={rows(r, "elevation_m")} dataKey="v" name={STRATEGY_LABEL[r.strategy]} stroke={STRATEGY_COLOR[r.strategy]} dot={false} strokeWidth={r.strategy === "shortest" ? 1.4 : 2} strokeDasharray={r.strategy === "shortest" ? "5 3" : undefined} isAnimationActive={false} connectNulls={false} />)}
        </ComposedChart>
      </ResponsiveContainer>
      <div className="tiny muted">Along-track slope (°) between consecutive samples. Dashed line = scenario slope limit ({maxSlope}°).</div>
      <ResponsiveContainer width="100%" height={150}>
        <ComposedChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} /><XAxis type="number" dataKey="d" {...AX} domain={[0, "dataMax"]} unit=" km" /><YAxis {...AX} width={52} domain={[0, (m: number) => Math.max(maxSlope + 3, Math.ceil(m))]} unit="°" />
          <Tooltip {...TIP} formatter={(v) => (typeof v === "number" ? `${v.toFixed(1)}°` : "—")} labelFormatter={d => `${d} km`} />
          <ReferenceLine y={maxSlope} stroke="#e0605a" strokeDasharray="4 3" />
          {sel.map(r => <Line key={r.strategy} data={rows(r, "slope_deg")} dataKey="v" name={STRATEGY_LABEL[r.strategy]} stroke={STRATEGY_COLOR[r.strategy]} dot={false} strokeWidth={1.6} isAnimationActive={false} />)}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MarginHistogram({ hist }: { hist: Risk["margin_histogram"] }) {
  const data = hist.counts.map((c, i) => ({ x: (hist.edges[i] + hist.edges[i + 1]) / 2, c }));
  return (
    <ResponsiveContainer width="100%" height={190}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }} barCategoryGap={1}>
        <CartesianGrid stroke={GRID} vertical={false} /><XAxis dataKey="x" {...AX} tickFormatter={v => `${Math.round(v)}`} unit="%" /><YAxis {...AX} width={40} />
        <Tooltip {...TIP} formatter={v => [`${v} runs`, "count"]} labelFormatter={v => `limiting margin ≈ ${Number(v).toFixed(0)}%`} />
        <ReferenceLine x={0} stroke="#e0605a" />
        <Bar dataKey="c" isAnimationActive={false}>{data.map((d, i) => <Cell key={i} fill={d.x < 0 ? "#e0605a" : "#62b8a4"} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Tornado({ rows }: { rows: Risk["sensitivity"] }) {
  const data = rows.slice(0, 7).map(r => ({ name: r.label, swing: +r.swing_percent_points.toFixed(1), kind: r.kind }));
  const color: Record<string, string> = { measurement: "#7fa8d8", model: "#e3a84f", scenario: "#b48ead" };
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34 + 30)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid stroke={GRID} horizontal={false} /><XAxis type="number" {...AX} unit=" pts" /><YAxis type="category" dataKey="name" width={170} {...AX} />
        <Tooltip {...TIP} formatter={v => [`${v} percentage points`, "swing P10→P90 input"]} />
        <Bar dataKey="swing" isAnimationActive={false}>{data.map((d, i) => <Cell key={i} fill={color[d.kind]} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CompareBars({ rows, strategies }: { rows: { label: string; values: Record<string, number>; normalised: Record<string, number> }[]; strategies: string[] }) {
  return (
    <div className="stack" aria-label="Why the alternatives differ">
      {rows.map(r => (
        <div key={r.label}>
          <div className="tiny muted">{r.label}</div>
          {strategies.map(s => (
            <div key={s} className="row" style={{ flexWrap: "nowrap", gap: 8 }}>
              <span className="tiny" style={{ width: 118, color: STRATEGY_COLOR[s] }}>{STRATEGY_LABEL[s]}</span>
              <div className="bar" style={{ flex: 1 }}><i style={{ width: `${Math.max(2, r.normalised[s] * 100)}%`, background: STRATEGY_COLOR[s] }} /></div>
              <span className="num tiny" style={{ width: 54, textAlign: "right" }}>{r.values[s].toFixed(r.values[s] < 20 ? 1 : 0)}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
