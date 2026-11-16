"use client";
import { Plus, Siren, Trash2 } from "lucide-react";
import { useMissionStore, workingStrategy } from "@/lib/store";
import { fmt, factor, STRATEGY_LABEL } from "@/lib/format";
import type { IncidentKind } from "@/lib/types";
import { Badge, Empty, ErrorState, Loading, NextStep, Notice, NumField, PageHead, Panel, Range, SourceBadge, Spinner } from "../ui";
import { PlanStatus } from "../PlanStatus";

const KINDS: { id: IncidentKind; label: string; unit: string; def: number; max: number }[] = [
  { id: "battery_loss", label: "Battery capacity loss", unit: "%", def: 35, max: 100 },
  { id: "speed_reduction", label: "Reduced rover speed", unit: "%", def: 30, max: 95 },
  { id: "oxygen_increase", label: "Increased oxygen consumption", unit: "%", def: 25, max: 300 },
  { id: "water_loss", label: "Water supply reduction", unit: "% of capacity", def: 30, max: 100 },
  { id: "extended_science", label: "Extended science operations", unit: "h", def: 2, max: 24 },
  { id: "travel_delay", label: "Unexpected travel delay", unit: "h", def: 1.5, max: 24 },
  { id: "comms_reduction", label: "Reduced communications (assumption)", unit: "%", def: 50, max: 100 },
  { id: "route_obstruction", label: "Route segment obstruction", unit: "km radius", def: 3, max: 15 },
];

const fmtCell = (v: number | boolean | null | undefined) => (typeof v === "boolean" ? (v ? "Yes" : "No") : typeof v === "number" ? fmt(v, 2) : "—");

export function EmergencyTab() {
  const s = useMissionStore(); const sc = s.scenario; const alt = s.alternatives;
  if (!alt) return <div className="stack" style={{ gap: 12 }}><PageHead icon={Siren} title="Emergency">Break the working plan on purpose and compare recovery options. It needs a route plan first.</PageHead><Panel title="Route plan needed"><PlanStatus what="route plan" feature="The emergency simulator" /></Panel></div>;
  const strategy = workingStrategy(s); const err = s.errors.scenario;
  return (
    <div className="stack" style={{ gap: 12 }}>
    <PageHead icon={Siren} title="Emergency" right={<SourceBadge source={sc ? s.sources.scenario : undefined} />}>Break the plan on purpose, then compare continuing, rerouting, skipping science and aborting to base. Route: <b>{STRATEGY_LABEL[strategy]}</b>. Incident sizes are what-ifs with unknown likelihood.</PageHead>
    <div className="dash">
      <div className="col c4 side-sticky">
        <Panel title="1 · Choose the incident(s)" tour="incident" right={<button className="btn sm" disabled={s.incidents.length >= 4} onClick={() => s.setIncidents([...s.incidents, { kind: "travel_delay", magnitude: 1.5 }])}><Plus size={13} />Add</button>}>
          {s.incidents.map((inc, i) => { const k = KINDS.find(x => x.id === inc.kind)!; return (
            <div key={i} className="stack" style={{ marginBottom: 10 }}>
              <div className="row" style={{ flexWrap: "nowrap" }}>
                <label className="field" style={{ flex: 1, minWidth: 0 }}><span>Incident {i + 1}</span><select value={inc.kind} onChange={e => { const n = KINDS.find(x => x.id === e.target.value)!; s.setIncidents(s.incidents.map((x, j) => (j === i ? { kind: n.id, magnitude: n.def } : x))); }}>{KINDS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
                <NumField label={`Size of incident ${i + 1}`} unit={k.unit} value={inc.magnitude} min={0} max={k.max} step={k.unit === "h" ? 0.25 : 1} onChange={v => s.setIncidents(s.incidents.map((x, j) => (j === i ? { ...x, magnitude: v } : x)))} />
                <button className="btn sm" aria-label={`Remove incident ${i + 1}`} disabled={s.incidents.length === 1} onClick={() => s.setIncidents(s.incidents.filter((_, j) => j !== i))}><Trash2 size={13} /></button>
              </div>
            </div>); })}
          <Range label="Occurs after outbound progress" value={Math.round(s.incidentProgress * 100)} min={0} max={100} step={5} unit="%" onChange={v => s.setIncidentProgress(v / 100)} />
          <button className="btn primary" style={{ width: "100%", marginTop: 10 }} onClick={() => void s.runScenario()} disabled={s.busy.scenario}>{s.busy.scenario ? <><Spinner />Recalculating…</> : "2 · Simulate failure & replan"}</button>
        </Panel>
        <Notice>Research and education decision-support prototype — <b>not operational emergency guidance</b>. Incident sizes are what-ifs with unknown likelihood.</Notice>
      </div>
      <div className="col c8">
        {s.busy.scenario && !sc && <Loading label="Recomputing resources, replanning on the DEM…" />}
        {err && (err.offline
          ? <ErrorState message="API offline — the simulator cannot run" retry={() => void s.retryConnection()} retryLabel="Retry connection">Offline, only the precomputed result for the Jezero demo route with its default incidents is available. Other incidents are never estimated.</ErrorState>
          : <ErrorState message={`Simulation failed: ${err.message}`} retry={() => void s.runScenario()} />)}
        {!sc && !s.busy.scenario && !err && <Panel title="Result"><Empty title="Nothing simulated yet">Pick the incident and press “Simulate failure &amp; replan”.</Empty></Panel>}
        {sc && <>
          <Panel title="What happened" right={<span className="tiny dim num">at {fmt(sc.incident.elapsed_hours)} h · {fmt(sc.incident.position.lat, 3)}°, {fmt(sc.incident.position.lon, 3)}°</span>}>
            <ul className="small stack" style={{ margin: 0, paddingLeft: 18 }}>{sc.incident.applied.map(a => <li key={a}>{a}</li>)}</ul>
          </Panel>
          <Panel title="Original vs failure vs revised" right={sc.revised ? <Badge tone={sc.revised_feasible ? "ok" : "bad"}>{sc.revised_feasible ? "Revised plan feasible in model" : "No option satisfies the model"}</Badge> : undefined}>
            <div className="cmp" role="table" aria-label="Mission comparison">
              <div className="h" role="columnheader">Metric</div><div className="h col-orig" role="columnheader">Original</div><div className="h col-fail" role="columnheader">Failure (continue)</div><div className="h col-rev" role="columnheader">Revised ({sc.revised?.label ?? "—"})</div>
              {sc.diff.map(d => <div key={d.metric} style={{ display: "contents" }} role="row"><div title={d.cause}>{d.metric}<div className="tiny dim">{d.cause}</div></div><div className="n">{fmtCell(d.original)}</div><div className="n" style={d.failure === false ? { color: "var(--bad)" } : undefined}>{fmtCell(d.failure)}</div><div className="n" style={d.revised === true ? { color: "var(--ok)" } : undefined}>{fmtCell(d.revised)}</div></div>)}
            </div>
          </Panel>
          <Panel title="Options compared from the incident point"><div className="tscroll"><table className="t"><thead><tr><th>Option</th><th>Result</th><th>Margin</th><th>Time</th><th>Needs extra</th></tr></thead><tbody>
            {sc.options.map(o => <tr key={o.id} className={sc.revised?.id === o.id ? "sel" : ""}>
              <td><b>{o.label}</b>{sc.revised?.id === o.id && <> <Badge tone="info">chosen</Badge></>}{o.status === "blocked" && <div className="tiny dim">{o.reason}</div>}</td>
              <td>{o.status === "blocked" ? <Badge tone="bad">blocked</Badge> : o.feasible_within_model ? <Badge tone="ok">feasible</Badge> : <Badge tone="bad">infeasible</Badge>}</td>
              <td className="n">{o.status === "ok" ? `${factor(o.limiting_factor!)} ${fmt(o.limiting_margin_percent)}%` : "—"}</td><td className="n">{o.total_hours !== undefined ? `${fmt(o.total_hours)} h` : "—"}</td>
              <td className="tiny">{o.required_additional ? Object.entries(o.required_additional).filter(([, v]) => v > 0.005).map(([k, v]) => `${k.replace("_", " ")} +${fmt(v, 2)}`).join(", ") || "—" : "—"}</td></tr>)}
          </tbody></table></div></Panel>
          {sc.contingency_levers.length > 0 && <Panel title="Model-supported contingency actions" right={<Badge tone="info">class B · calculation</Badge>}><ul className="small stack" style={{ margin: 0, paddingLeft: 18 }}>{sc.contingency_levers.map(l => <li key={l.id}>{l.action}: margin {fmt(l.limiting_margin_percent)}% ({l.delta_percent_points >= 0 ? "+" : ""}{fmt(l.delta_percent_points)} pts){l.feasible_within_model ? " — feasible" : ""}</li>)}</ul></Panel>}
          <Panel title="Unavoidable uncertainty"><ul className="small muted stack" style={{ margin: 0, paddingLeft: 18 }}>{sc.unavoidable_uncertainty.map(u => <li key={u}>{u}</li>)}</ul></Panel>
          <NextStep detail="Next: ask ARES why, or export the full analysis." label="Ask ARES" onClick={() => s.setTab("ares")} />
        </>}
      </div>
    </div>
    </div>
  );
}
