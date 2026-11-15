"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Compass, Navigation, Printer, X } from "lucide-react";
import { useMissionStore, workingStrategy } from "@/lib/store";
import { buildLegs, maxDistanceFromBase, type Leg } from "@/lib/fieldcard";
import { coord, fmt, factor, STRATEGY_LABEL } from "@/lib/format";
import { hhmm, localTrueSolarTime } from "@/lib/marstime";
import { Badge, NextStep, Notice, PageHead, Panel, SourceBadge, Stat } from "../ui";
import { PlanStatus } from "../PlanStatus";
import { useEvaPlan, useNow } from "../Conditions";

const local = (start: Date | null, hours: number, lon: number) => (start ? hhmm(localTrueSolarTime(new Date(start.getTime() + hours * 3600000), lon)) : "—");
const sign = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v))} m`);

/** Heads-up "visor" view: one leg at a time, large and high-contrast. A planning preview — there is no live position. */
function Visor({ legs, start, onClose, maxSlope, o2Reserve }: { legs: Leg[]; start: Date | null; onClose: () => void; maxSlope: number; o2Reserve: number }) {
  const [i, setI] = useState(0); const box = useRef<HTMLDivElement>(null);
  const l = legs[i];
  useEffect(() => { box.current?.focus(); }, []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(); else if (e.key === "ArrowRight") setI(v => Math.min(legs.length - 1, v + 1)); else if (e.key === "ArrowLeft") setI(v => Math.max(0, v - 1));
    };
    window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h);
  }, [legs.length, onClose]);
  const steep = l.maxSlopeDeg !== null && l.maxSlopeDeg > maxSlope;
  const lowO2 = l.o2LeftKg < o2Reserve;
  return (
    <div ref={box} className="visor" role="dialog" aria-modal="true" aria-label={`Visor view, leg ${l.n} of ${legs.length}`} tabIndex={-1}>
      <div className="visor-top"><span>LEG {l.n}/{legs.length}</span><span>PLANNING PREVIEW · NO LIVE POSITION</span><button className="visor-x" onClick={onClose} aria-label="Close visor view"><X size={22} /></button></div>
      <div className="visor-main">
        <div className="visor-arrow" aria-hidden><Navigation size={120} style={{ transform: `rotate(${l.bearing}deg)` }} /></div>
        <div className="visor-data">
          <div className="visor-big">{fmt(l.bearing, 0)}° <small>{l.compass}</small></div>
          <div className="visor-row"><span>DISTANCE</span><b>{fmt(l.km, 2)} km</b></div>
          <div className="visor-row"><span>CLIMB</span><b>{sign(l.climbM)}</b></div>
          <div className={`visor-row ${steep ? "alert" : ""}`}><span>MAX SLOPE</span><b>{fmt(l.maxSlopeDeg, 1)}°{steep ? " ⚠" : ""}</b></div>
          <div className="visor-row"><span>ARRIVE</span><b>{local(start, l.elapsedH, l.to.lon)} local</b></div>
          <div className={`visor-row ${lowO2 ? "alert" : ""}`}><span>O₂ LEFT</span><b>{fmt(l.o2LeftKg, 1)} kg</b></div>
          <div className="visor-row"><span>WAYPOINT</span><b className="num">{coord(l.to.lat, l.to.lon)}</b></div>
        </div>
      </div>
      <div className="visor-nav">
        <button onClick={() => setI(v => Math.max(0, v - 1))} disabled={i === 0}><ArrowLeft size={20} aria-hidden />Previous leg</button>
        <span>{fmt(l.cumKm, 1)} of {fmt(legs[legs.length - 1].cumKm, 1)} km outbound</span>
        <button onClick={() => setI(v => Math.min(legs.length - 1, v + 1))} disabled={i === legs.length - 1}>Next leg<ArrowRight size={20} aria-hidden /></button>
      </div>
    </div>
  );
}

export function FieldTab() {
  const s = useMissionStore(); const alt = s.alternatives; const now = useNow();
  const [visor, setVisor] = useState(false);
  const eva = useEvaPlan(now);
  const strategy = alt ? workingStrategy(s) : null;
  const route = alt?.routes.find(r => r.strategy === strategy) ?? null;
  const legs = useMemo(() => (route ? buildLegs(route, s.config.oxygenKg) : []), [route, s.config.oxygenKg]);
  if (!alt || !route) return <div className="stack" style={{ gap: 12 }}><PageHead icon={Compass} title="Field card">A tablet-ready card for the crew, leg by leg. It needs a planned local route.</PageHead><Panel title="Route plan needed" tour="fieldcard"><PlanStatus what="route plan" feature="The field card" /></Panel></div>;
  const m = route.mission, sci = s.config.scienceHours;
  const outH = route.metrics.one_way_travel_hours;
  const o2Reserve = s.config.oxygenKg * s.config.reservePercent / 100;
  const walk = maxDistanceFromBase(route);
  return (
    <div className="stack" style={{ gap: 12 }}>
      <PageHead icon={Compass} title="Field card" right={<div className="row"><SourceBadge source={s.sources.alternatives} /><button className="btn sm" onClick={() => window.print()}><Printer size={13} aria-hidden />Print card</button><button className="btn sm primary" onClick={() => setVisor(true)} disabled={!legs.length}><Navigation size={13} aria-hidden />Visor mode</button></div>}>
        The working route, leg by leg, for a tablet or a printed cue card: bearing, distance, climb, local arrival time and oxygen at every waypoint. <b>Visor mode</b> shows one leg at a time in large type, like a helmet heads-up display.
      </PageHead>
      <div className="kpis" data-tour="fieldcard">
        <Stat label="Route" value={STRATEGY_LABEL[route.strategy].split(" ")[0]} detail={`${fmt(route.metrics.distance_km)} km one way · ${legs.length} legs`} />
        <Stat label="Departure" value={eva.start ? local(eva.start, 0, s.origin.lon) : "—"} detail={eva.start ? `local solar time${eva.auto ? " (auto: after sunrise)" : ""}` : now === null ? "calculating…" : "no daylight (polar night)"} />
        <Stat label="Back at base" value={eva.start ? local(eva.start, m.duration_hours, s.origin.lon) : "—"} detail={eva.fitsDaylight === null ? "" : eva.fitsDaylight ? "within daylight" : "after sunset — adjust start"} tone={eva.fitsDaylight === false ? "bad" : eva.fitsDaylight ? "ok" : undefined} />
        <Stat label="Margin at return" value={`${fmt(m.limiting_margin_percent)}%`} detail={`limited by ${factor(m.limiting_factor).toLowerCase()} (model)`} tone={m.feasible_within_model ? "ok" : "bad"} />
      </div>
      {!m.feasible_within_model && <Notice tone="bad">This route does not satisfy the mission model ({factor(m.limiting_factor).toLowerCase()} margin {fmt(m.limiting_margin_percent)}%). The card is shown for study only.</Notice>}
      <Panel title="Outbound legs" right={<Badge tone="info" title="Derived from the MOLA route profile and the mission model">class B · derived</Badge>}>
        <div className="tscroll fieldcard" role="region" aria-label="Outbound legs table" tabIndex={0}><table className="t"><thead><tr>
          <th scope="col">Leg</th><th scope="col">To waypoint</th><th scope="col">Distance</th><th scope="col">Bearing</th><th scope="col">Climb</th><th scope="col">Max slope</th><th scope="col">Arrive (local)</th><th scope="col">O₂ left</th>
        </tr></thead><tbody>
          {legs.map(l => { const steep = l.maxSlopeDeg !== null && l.maxSlopeDeg > s.config.maxSlopeDeg; return <tr key={l.n}>
            <th scope="row">{l.n}</th><td className="num tiny">{coord(l.to.lat, l.to.lon)}</td><td className="n">{fmt(l.km, 2)} km</td>
            <td className="n">{fmt(l.bearing, 0)}° {l.compass}</td><td className="n">{sign(l.climbM)}</td>
            <td className="n" style={steep ? { color: "var(--bad)" } : undefined}>{fmt(l.maxSlopeDeg, 1)}°{steep && <span className="sr"> (above limit)</span>}</td>
            <td className="n">{local(eva.start, l.elapsedH, l.to.lon)}</td><td className="n" style={l.o2LeftKg < o2Reserve ? { color: "var(--bad)" } : undefined}>{fmt(l.o2LeftKg, 1)} kg</td>
          </tr>; })}
        </tbody></table></div>
        <ul className="eva-facts small">
          <li><b>At the target</b> — science for {fmt(sci, 2)} h{s.stops.length ? ` (+ ${s.stops.length} declared stop${s.stops.length > 1 ? "s" : ""})` : ""}; leave by {local(eva.start, outH + sci, s.destination.lon)} local.</li>
          {s.config.returnRequired && <li><b>Return</b> along the same route — back at base {local(eva.start, m.duration_hours, s.origin.lon)} local with {fmt(m.oxygen_remaining_kg, 1)} kg O₂, {fmt(m.energy_remaining_kwh, 1)} kWh and {fmt(m.water_remaining_liters, 1)} L water left (model).</li>}
          <li><b>Farthest from base</b>: {fmt(walk, 1)} km in a straight line — the distance a walk back would cover if the rover failed there.</li>
        </ul>
      </Panel>
      <div className="grid g2">
        <Panel title="Crew rules on this card">
          <ul className="small stack" style={{ margin: 0, paddingLeft: 18 }}>
            <li>Turn back if oxygen at a waypoint is below the card value — the plan assumed the modelled consumption.</li>
            <li>Red slopes exceed your {s.config.maxSlopeDeg}° limit on the 463 m grid; real ground can be steeper or rougher.</li>
            <li>Bearings are true bearings (from north) between waypoints; Mars has no global magnetic field to steer by.</li>
            <li>Times are local true solar time at each waypoint; one sol lasts 24 h 39 min.</li>
          </ul>
        </Panel>
        <Notice>Field card values come from RedReturn&apos;s models and the 463 m MOLA grid. They support planning and training, not navigation: no live position, no obstacle detection, nothing certified.</Notice>
      </div>
      <NextStep detail="Export the full analysis, or go back to compare routes." label="Go to Reports" onClick={() => s.setTab("reports")} />
      {visor && legs.length > 0 && <Visor legs={legs} start={eva.start} onClose={() => setVisor(false)} maxSlope={s.config.maxSlopeDeg} o2Reserve={o2Reserve} />}
    </div>
  );
}
