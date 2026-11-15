"use client";
import { Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import { useMissionStore, workingStrategy } from "@/lib/store";
import { routeReach } from "@/lib/coverage";
import { fmt, factor, STRATEGY_COLOR, STRATEGY_LABEL, hours } from "@/lib/format";
import { Badge, Loading, NextStep, NumField, Notice, PageHead, Panel, Range, SourceBadge } from "../ui";
import { PlanStatus } from "../PlanStatus";
import { LongRangePlanner } from "../LongRange";
import { CompareBars } from "../charts";

export function PlannerTab() {
  const s = useMissionStore(); const c = s.config; const alt = s.alternatives;
  const working = workingStrategy(s); const picked = !!alt && working !== alt.recommended;
  return (
    <div className="stack" style={{ gap: 12 }}>
    <PageHead icon={RouteIcon} title="Planner" right={<SourceBadge source={s.sources.alternatives} />}>{s.longRange && !alt ? "Set the crew, rover and supplies on the left; the long-range estimate on the right updates with them." : "Set the crew, rover, consumables, reserves and science stops on the left; the four route strategies re-plan automatically on the right. Pick the route to analyse in Risk Lab and Emergency."}</PageHead>
    <div className="dash">
      <div className="col c4">
        <Panel title="Crew & rover"><div className="grid g2">
          <NumField label="Crew" value={c.crew} min={1} max={12} onChange={v => s.setConfig({ crew: Math.round(v) })} />
          <NumField label="Speed" unit="km/h" value={c.speedKmh} min={0.5} max={50} step={0.1} onChange={v => s.setConfig({ speedKmh: v })} />
          <NumField label="Max slope" unit="°" value={c.maxSlopeDeg} min={1} max={45} onChange={v => s.setConfig({ maxSlopeDeg: v })} hint="scenario assumption" />
          <NumField label="Rover mass" unit="kg" value={c.roverMassKg} min={100} max={100000} step={50} onChange={v => s.setConfig({ roverMassKg: v })} hint="assumption" />
        </div></Panel>
        <Panel title="Consumables (loaded)"><div className="grid g2">
          <NumField label="Oxygen" unit="kg" value={c.oxygenKg} min={0} step={0.5} onChange={v => s.setConfig({ oxygenKg: v })} />
          <NumField label="Battery" unit="kWh" value={c.energyKwh} min={0} step={1} onChange={v => s.setConfig({ energyKwh: v })} />
          <NumField label="Water" unit="L" value={c.waterLiters} min={0} step={0.5} onChange={v => s.setConfig({ waterLiters: v })} />
          <NumField label="Base power" unit="kWh/h" value={c.energyKwhPerHour} min={0.01} step={0.1} onChange={v => s.setConfig({ energyKwhPerHour: v })} />
          <NumField label="O₂ rate" unit="kg/p/h" value={c.oxygenKgPerPersonHour} min={0.001} step={0.001} onChange={v => s.setConfig({ oxygenKgPerPersonHour: v })} />
          <NumField label="Water rate" unit="L/p/day" value={c.waterLitersPerPersonDay} min={0.1} step={0.1} onChange={v => s.setConfig({ waterLitersPerPersonDay: v })} />
        </div></Panel>
        <Panel title="Duration, reserves, return"><div className="stack">
          <Range label="Time window" value={c.maxHours} min={4} max={72} onChange={v => s.setConfig({ maxHours: v })} unit=" h" />
          <Range label="Science time at target" value={c.scienceHours} min={0} max={12} step={0.25} onChange={v => s.setConfig({ scienceHours: v })} unit=" h" />
          <Range label="Reserve to keep" value={c.reservePercent} min={0} max={60} onChange={v => s.setConfig({ reservePercent: v })} unit="%" />
          <Range label="Contingency on use" value={c.contingencyPercent} min={0} max={60} onChange={v => s.setConfig({ contingencyPercent: v })} unit="%" />
          <NumField label="Radiation rate" unit="mSv/h" value={c.radiationMsvPerHour} min={0} step={0.005} onChange={v => s.setConfig({ radiationMsvPerHour: v })} hint="≈0.64 mSv/day published MSL RAD (assumption)" />
          <NumField label="Dose limit" unit="mSv" value={c.maxRadiationMsv} min={0.01} step={0.1} onChange={v => s.setConfig({ maxRadiationMsv: v })} hint="scenario limit, not regulatory" />
          <label className="row small"><input type="checkbox" checked={c.returnRequired} onChange={e => s.setConfig({ returnRequired: e.target.checked })} />Return to base required (RedReturn rule)</label>
        </div></Panel>
        <Panel title="Science stops" right={<button className="btn sm" disabled={s.stops.length >= 5 || !routeReach(s.origin, s.destination).local} title={routeReach(s.origin, s.destination).local ? undefined : "Science stops need a local excursion (base and target within ~150 km)"} onClick={() => s.setStops([...s.stops, { name: `Stop ${s.stops.length + 1}`, lat: +((s.origin.lat + s.destination.lat) / 2).toFixed(3), lon: +((s.origin.lon + s.destination.lon) / 2).toFixed(3), dwell_hours: 0.75, weight: 1 }])}><Plus size={13} />Add</button>}>
          {s.stopsNotice && <p className="tiny" style={{ color: "var(--warn)", margin: "0 0 6px" }} role="status">{s.stopsNotice}</p>}
          {s.stops.length === 0 && <p className="tiny muted">None. Without declared stops the science-prioritised strategy is disabled (no science-value dataset exists to rank terrain).</p>}
          {s.stops.map((st, i) => <div key={i} className="grid g3" style={{ marginBottom: 8, alignItems: "end" }}>
            <NumField label={`Stop ${i + 1} lat`} value={st.lat} min={-90} max={90} step={0.01} onChange={v => s.setStops(s.stops.map((x, j) => (j === i ? { ...x, lat: v } : x)))} /><NumField label={`Stop ${i + 1} lon`} value={st.lon} min={-180} max={180} step={0.01} onChange={v => s.setStops(s.stops.map((x, j) => (j === i ? { ...x, lon: v } : x)))} />
            <div className="row" style={{ flexWrap: "nowrap" }}><NumField label="Dwell h" value={st.dwell_hours} min={0} max={100} step={0.25} onChange={v => s.setStops(s.stops.map((x, j) => (j === i ? { ...x, dwell_hours: v } : x)))} /><button className="btn sm" aria-label={`Remove stop ${i + 1}`} onClick={() => s.setStops(s.stops.filter((_, j) => j !== i))}><Trash2 size={13} /></button></div>
          </div>)}
        </Panel>
      </div>
      <div className="col c8">
        {!alt && s.longRange && <LongRangePlanner lr={s.longRange} />}
        {!alt && !s.longRange && <Panel title="Route alternatives" tour="routes"><PlanStatus what="route plan" /></Panel>}
        {alt && s.busy.alt && <Loading label="Re-planning routes on the DEM…" />}
        {alt && <>
          <Panel title="Route alternatives" tour="routes" right={alt.recommended ? <Badge tone="ok" title="Best modelled margin among routes meeting every modelled constraint. Not a safety rating.">Recommended: {STRATEGY_LABEL[alt.recommended]}</Badge> : <Badge tone="bad">No route meets all constraints</Badge>}>
            <div className="row between small" style={{ marginBottom: 8 }}><span className="muted">Working plan (used by Risk Lab, Emergency, ARES, Reports): <b style={{ color: STRATEGY_COLOR[working] }}>{STRATEGY_LABEL[working]}</b>{picked ? " — your selection" : alt.recommended ? " — recommended" : ""}</span>{picked && alt.recommended && <button className="btn sm" onClick={() => s.setStrategy(null)}>Use recommended route</button>}</div>
            {picked && alt.routes.find(r => r.strategy === working)?.constraints_violated.length ? <Notice>The selected route violates modelled constraints; downstream analyses will show how it fails, not make it acceptable.</Notice> : null}
            <div className="tscroll"><table className="t"><thead><tr><th scope="col"><span className="sr">Working plan</span></th><th scope="col">Route</th><th>km</th><th>Time</th><th>Ascent</th><th>Max°</th><th>Energy</th><th>Limit</th><th>Status</th></tr></thead><tbody>
              {alt.routes.map(r => { const m = r.mission; const sel = working === r.strategy; return (
                <tr key={r.strategy} className={sel ? "sel" : ""}>
                  <td><input type="radio" name="strategy" aria-label={`Use ${STRATEGY_LABEL[r.strategy]} as working plan`} checked={sel} onChange={() => s.setStrategy(r.strategy === alt.recommended ? null : r.strategy)} /></td>
                  <td style={{ color: STRATEGY_COLOR[r.strategy] }}><b>{STRATEGY_LABEL[r.strategy]}</b>{r.status === "downgraded" && <div><Badge tone="warn">downgraded</Badge></div>}</td>
                  <td className="n">{fmt(r.metrics.distance_km)}</td><td className="n">{hours(m.duration_hours)}</td><td className="n">{fmt(r.metrics.elevation_gain_m, 0)} m</td>
                  <td className="n" style={(r.metrics.max_slope_deg ?? 0) > c.maxSlopeDeg ? { color: "var(--bad)" } : undefined}>{fmt(r.metrics.max_slope_deg)}</td><td className="n">{fmt(m.energy_used_kwh)} kWh</td>
                  <td className="n">{factor(m.limiting_factor)} {fmt(m.limiting_margin_percent)}%</td>
                  <td>{r.constraints_violated.length ? r.constraints_violated.map(v => <Badge key={v.id} tone="bad">{v.id.replace("_", " ")}</Badge>) : m.feasible_within_model ? <Badge tone="ok">feasible in model</Badge> : <Badge tone="bad">fails {factor(m.limiting_factor).toLowerCase()}</Badge>}</td>
                </tr>); })}
            </tbody></table></div>
            <p className="small" style={{ marginTop: 10 }}><b>Why:</b> {alt.reason}</p>
            {alt.routes.filter(r => r.note).map(r => <Notice key={r.strategy}>{STRATEGY_LABEL[r.strategy]}: {r.note}</Notice>)}
          </Panel>
          <div className="grid g2">
            <Panel title="Why they differ"><CompareBars rows={alt.comparison} strategies={alt.routes.map(r => r.strategy)} /></Panel>
            <Panel title="Objective of each strategy"><div className="stack">{alt.routes.map(r => <div key={r.strategy}><b className="small" style={{ color: STRATEGY_COLOR[r.strategy] }}>{STRATEGY_LABEL[r.strategy]}</b><div className="tiny muted">{r.objective}</div><div className="tiny dim num">{Object.entries(r.cost_components).map(([k, v]) => `${k.replace(/_/g, " ")}: ${fmt(v, 2)}`).join(" · ")}</div></div>)}</div></Panel>
          </div>
          <Notice tone="info">Routes use cell-centre elevations of a {fmt(alt.resolution.pixel_size_m, 0)} m grid; infeasible = blocked, never extrapolated. Resource figures are model outputs under your assumptions, not forecasts. “Feasible in model” is not “safe”.</Notice>
          <NextStep detail="Next: see how much the decision depends on uncertain inputs." label="Quantify uncertainty in Risk Lab" onClick={() => s.setTab("risk")} />
        </>}
      </div>
    </div>
    </div>
  );
}
