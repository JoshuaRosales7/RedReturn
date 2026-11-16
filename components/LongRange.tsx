"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { Globe2, Route as RouteIcon } from "lucide-react";
import { useMissionStore } from "@/lib/store";
import { estimateLongRoute } from "@/lib/longrange";
import { fmt, STRATEGY_COLOR, STRATEGY_LABEL } from "@/lib/format";
import type { LongRange } from "@/lib/types";
import { Badge, Loading, Notice, Panel, Range, Stat } from "./ui";
import { ProfileChart } from "./charts";
import { TerrainMap } from "./TerrainMap";
import { GroundView } from "./Conditions";

const Mesh = dynamic(() => import("./TerrainMesh3D"), { ssr: false, loading: () => <div className="mesh-ph"><Loading label="Building 3D terrain…" lines={0} /></div> });
const kmFmt = (v: number) => Math.round(v).toLocaleString("en-US");
const terrainRoute = (lr: LongRange) => lr.routes.find(r => r.strategy === "terrain") ?? lr.routes[0];

/** Shown by analyses that only exist for local excursions (Risk Lab, Emergency, ARES, exports). */
export function LongRangeOnlyLocal({ what }: { what: string }) {
  const s = useMissionStore();
  return <div className="problem" role="status">
    <h2 className="problem-title" style={{ color: "var(--info)" }}><Globe2 size={16} aria-hidden />{what} needs a local excursion</h2>
    <p className="small">Base and target are {s.longRange ? `${kmFmt(terrainRoute(s.longRange).metrics.distance_km)} km` : "too far"} apart, so RedReturn shows a long-range overview route. {what} works with the detailed model, which needs both points within about 150 km.</p>
    <div className="row"><button className="btn sm primary" onClick={() => s.setTab("planner")}><RouteIcon size={13} aria-hidden />See long-range estimate</button><button className="btn sm" onClick={() => s.setTab("explorer")}><Globe2 size={13} aria-hidden />Pick closer points</button></div>
  </div>;
}

export function LongRangeSummary({ lr }: { lr: LongRange }) {
  const s = useMissionStore(); const r = terrainRoute(lr); const e = estimateLongRoute(r, s.config, 6);
  return <>
    <div className="kpis">
      <Stat label="Mode" value="Long-range" detail="overview route, not a local excursion" />
      <Stat label="Route length" value={`${kmFmt(r.metrics.distance_km)} km`} detail={(() => { const st = lr.routes.find(x => x.strategy === "shortest"); return st ? `terrain-aware, one way (${kmFmt(st.metrics.distance_km)} km straight)` : "terrain-aware, one way (stays west/east of the 180° meridian)"; })()} />
      <Stat label="Driving time" value={`${kmFmt(e.drivingHours)} h`} detail={`≈ ${e.sols} sols at 6 h/sol${e.legs === 2 ? ", there and back" : ""} (estimate)`} tone="warn" />
      <Stat label="Grid spacing" value={`${fmt(lr.grid.spacing_m / 1000, 1)} km`} detail="sampled MOLA, hazards invisible" tone="warn" />
    </div>
    <Notice tone="info">This is a strategic overview between distant points. For a route a crew could actually follow — and for Risk Lab, Emergency and ARES — split the trip into local legs of ≤ ~150 km in Mars Explorer.</Notice>
  </>;
}

export function LongRangeTerrain({ lr }: { lr: LongRange }) {
  const s = useMissionStore();
  const [mode, setMode] = useState<"relief" | "mesh">("relief");
  const [show, setShow] = useState<string[]>(["shortest", "terrain"]);
  const r = terrainRoute(lr);
  return <>
    <div className="kpis">
      <Stat label="Grid spacing" value={`${fmt(lr.grid.spacing_m / 1000, 1)} km`} detail={`every ${lr.grid.factor}th MOLA cell (exact values)`} tone="warn" />
      <Stat label="Route length" value={`${kmFmt(r.metrics.distance_km)} km`} detail="terrain-aware, one way" />
      <Stat label="Climb / descent" value={`${kmFmt(r.metrics.elevation_gain_m)} / ${kmFmt(r.metrics.elevation_loss_m)} m`} detail="cumulative along the route" />
      <Stat label="Area coverage" value={`${fmt(lr.grid.valid_fraction * 100, 1)}%`} detail="cells with MOLA data" tone={lr.grid.valid_fraction < 1 ? "warn" : "ok"} />
    </div>
    <div className="dash">
      <div className="col c8">
        <div className="row between">
          <div className="seg" role="group" aria-label="Terrain view"><button aria-pressed={mode === "relief"} onClick={() => setMode("relief")}>Relief map</button><button aria-pressed={mode === "mesh"} onClick={() => setMode("mesh")}>3D mesh</button></div>
          <Badge tone="warn" title={lr.grid.sampling}>Overview grid · {fmt(lr.grid.spacing_m / 1000, 1)} km</Badge>
        </div>
        {mode === "relief"
          ? <TerrainMap hf={lr.heightfield} routes={lr.routes} show={show} origin={s.origin} destination={s.destination} stops={[]} showSlope={false} maxSlope={s.config.maxSlopeDeg} />
          : <Mesh hf={lr.heightfield} routes={lr.routes} show={show} origin={s.origin} destination={s.destination} showSlope={false} maxSlope={s.config.maxSlopeDeg} />}
        <div className="legend" role="group" aria-label="Route visibility">{lr.routes.map(x => <label key={x.strategy} className="row" style={{ gap: 6, cursor: "pointer" }}><input type="checkbox" checked={show.includes(x.strategy)} onChange={() => setShow(v => v.includes(x.strategy) ? v.filter(k => k !== x.strategy) : [...v, x.strategy])} /><span><i style={{ background: STRATEGY_COLOR[x.strategy] }} />{STRATEGY_LABEL[x.strategy]}</span></label>)}</div>
      </div>
      <div className="col c4">
        <Panel title="What this overview cannot tell you"><ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>{lr.limitations.map(l => <li key={l}>{l}</li>)}</ul></Panel>
        <Notice>Slopes on a {fmt(lr.grid.spacing_m / 1000, 1)} km grid look gentle even across crater walls and scarps; the slope limit is therefore not a meaningful check here.</Notice>
      </div>
      <div className="c12"><GroundView /></div>
      <div className="c12"><Panel title="Elevation profile (overview grid)"><ProfileChart routes={lr.routes} maxSlope={s.config.maxSlopeDeg} show={show} source={`MOLA values sampled every ${fmt(lr.grid.spacing_m / 1000, 1)} km (long-range overview grid), interpolated along the route; along-track slopes at this spacing hide real steepness`} /></Panel></div>
    </div>
  </>;
}

export function LongRangePlanner({ lr }: { lr: LongRange }) {
  const s = useMissionStore(); const c = s.config;
  const [hps, setHps] = useState(6);
  return <>
    <Panel title="Long-range estimate" right={<Badge tone="warn" title="Class C: computed only from the assumptions listed below">class C · estimate</Badge>}>
      <Range label="Driving hours per sol (assumption)" value={hps} min={1} max={16} step={0.5} onChange={setHps} unit=" h" />
      <div className="tscroll" style={{ marginTop: 10 }}><table className="t"><thead><tr><th scope="col">Route</th><th scope="col">Total km</th><th scope="col">Driving</th><th scope="col">Sols</th><th scope="col">Oxygen</th><th scope="col">Water</th><th scope="col">Energy</th></tr></thead><tbody>
        {lr.routes.map(r => { const e = estimateLongRoute(r, c, hps); return <tr key={r.strategy}>
          <th scope="row" style={{ color: STRATEGY_COLOR[r.strategy], fontWeight: 600 }}>{STRATEGY_LABEL[r.strategy]}</th>
          <td className="n">{kmFmt(r.metrics.distance_km * e.legs)}</td><td className="n">{kmFmt(e.drivingHours)} h</td><td className="n">{e.sols}</td>
          <td className="n">{kmFmt(e.oxygenKg)} kg<div className="tiny dim">{fmt(e.oxygenLoads, 0)}× load</div></td>
          <td className="n">{kmFmt(e.waterL)} L<div className="tiny dim">{fmt(e.waterLoads, 0)}× load</div></td>
          <td className="n">{kmFmt(e.energyKwh)} kWh<div className="tiny dim">{fmt(e.batteryCharges, 0)}× battery</div></td>
        </tr>; })}
      </tbody></table></div>
      <p className="small" style={{ marginTop: 10 }}>With the supplies set on the left ({c.oxygenKg} kg O₂, {c.waterLiters} L water, {c.energyKwh} kWh battery), the “×” columns show how many full loads or charges this trip would need. A real long traverse needs resupply, solar recharging and rest — none of which is modelled here.</p>
      <details className="small muted"><summary style={{ cursor: "pointer" }}>Assumptions used</summary><ul style={{ paddingLeft: 18 }}>
        <li>Driving time = slope-derated distance ÷ speed ({c.speedKmh} km/h){c.returnRequired ? ", outbound and return" : ", one way"}.</li>
        <li>Sols = driving time ÷ driving hours per sol, rounded up; a sol is 24.66 h.</li>
        <li>Crew of {c.crew} uses oxygen ({c.oxygenKgPerPersonHour} kg/person/h) and water ({c.waterLitersPerPersonDay} L/person/sol) for every sol of the trip.</li>
        <li>Energy = base power ({c.energyKwhPerHour} kW) while driving + climb energy ({c.roverMassKg} kg rover, {Math.round(c.drivetrainEfficiency * 100)}% efficiency). Night-time loads and recharging are not modelled.</li>
      </ul></details>
    </Panel>
    <Notice tone="info">Change crew, speed or supplies on the left: the estimate updates instantly. For a route a crew could follow, plan local legs of ≤ ~150 km.</Notice>
  </>;
}
