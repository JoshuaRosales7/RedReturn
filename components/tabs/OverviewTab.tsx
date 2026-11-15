"use client";
import { CheckCircle2, CircleAlert, LayoutDashboard, RotateCcw, XCircle } from "lucide-react";
import { useMissionStore, workingStrategy } from "@/lib/store";
import { greatCircleDistance } from "@/lib/mars";
import { coord, fmt, factor, STRATEGY_LABEL } from "@/lib/format";
import { Badge, Notice, PageHead, Panel, SourceBadge, Stat } from "../ui";
import { PlanStatus } from "../PlanStatus";
import { LongRangeSummary } from "../LongRange";
import { MissionFlow } from "../MissionFlow";
import { ShareButton } from "../ShareButton";
import { SiteConditions, SpaceWeatherPanel } from "../Conditions";

function Check({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const I = ok ? CheckCircle2 : warn ? CircleAlert : XCircle;
  return <li className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><I size={16} aria-label={ok ? "Done" : warn ? "Pending" : "Not met"} color={ok ? "var(--ok)" : warn ? "var(--warn)" : "var(--bad)"} style={{ flex: "none", marginTop: 2 }} /><span>{children}</span></li>;
}

export function OverviewTab() {
  const s = useMissionStore();
  const alt = s.alternatives; const rec = alt?.routes.find(r => r.strategy === alt.recommended);
  const working = alt ? workingStrategy(s) : null; const picked = working && working !== alt?.recommended;
  const dist = greatCircleDistance(s.origin, s.destination);
  const m = rec?.mission;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <PageHead icon={LayoutDashboard} title="Overview" right={<div className="row"><SourceBadge source={s.sources.alternatives} /><ShareButton /><button className="btn sm primary" onClick={s.loadDemo} title="Restore the Jezero demo inputs (base, target, science stop, config, incident)"><RotateCcw size={13} aria-hidden />Reload Jezero demo</button></div>}>Your mission at a glance. Follow the steps below from left to right — each one opens the section that does it.</PageHead>
      <MissionFlow />
      {!alt && s.longRange && <LongRangeSummary lr={s.longRange} />}
      {!alt && !s.longRange && <Panel title="Route analysis"><PlanStatus /></Panel>}
      {alt && <div className="kpis">
        <Stat label="Recommended" value={alt.recommended ? STRATEGY_LABEL[alt.recommended].split(" ")[0] : "None"} detail={alt.recommended ? (picked ? `meets every modelled constraint · you are analysing ${STRATEGY_LABEL[working!]}` : "meets every modelled constraint (not a safety rating)") : "no route satisfies all constraints"} tone={alt.recommended ? "ok" : "bad"} />
        <Stat label="Return margin" value={m ? `${fmt(m.limiting_margin_percent)}%` : "—"} detail={m ? `limited by ${factor(m.limiting_factor).toLowerCase()}` : undefined} tone={m ? (m.feasible_within_model ? "ok" : "bad") : undefined} />
        <Stat label="Terrain resolution" value={`${fmt(alt.resolution.pixel_size_m, 0)} m`} detail="hazards < ~1 km unresolved" tone="warn" />
        <Stat label="Data gaps on route" value={rec ? rec.metrics.nodata_samples + rec.metrics.outside_coverage_samples : "—"} detail={`${rec ? rec.metrics.interpolated_samples : "—"} interpolated samples`} />
      </div>}
      <div className="grid g2"><SiteConditions /><SpaceWeatherPanel /></div>
      <Panel title="Mission">
        <div className="grid g2">
          <div className="stack">
            <h2 style={{ fontSize: 20 }}>Can the crew reach the target, do the science, and return?</h2>
            <p className="muted" style={{ margin: 0 }}>Plan a Mars surface excursion with real NASA MOLA elevations, see why alternatives differ, stress it with failures, and get a revised mission when the plan breaks. Every number is traceable; nothing is certified.</p>
          </div>
          <dl className="kv" style={{ alignContent: "start" }}>
            <dt>Base</dt><dd>{coord(s.origin.lat, s.origin.lon)}</dd><dt>Target</dt><dd>{coord(s.destination.lat, s.destination.lon)}</dd>
            {rec && <><dt title="MOLA elevation at the route ends, metres above the MOLA areoid (interpolated between grid cells)">Elevation base / target</dt><dd>{fmt(rec.coordinates[0]?.elevation_m, 0)} / {fmt(rec.coordinates[rec.coordinates.length - 1]?.elevation_m, 0)} m</dd></>}
            <dt>Great-circle</dt><dd>{fmt(dist)} km one way</dd><dt>Crew / speed</dt><dd>{s.config.crew} · {s.config.speedKmh} km/h</dd>
            <dt>Science time</dt><dd>{fmt(s.config.scienceHours)} h{s.stops.length ? ` + ${s.stops.length} stop(s)` : ""}</dd><dt>Slope limit</dt><dd>{s.config.maxSlopeDeg}° (scenario)</dd>
            <dt>Reserve / contingency</dt><dd>{s.config.reservePercent}% / {s.config.contingencyPercent}%</dd>
          </dl>
        </div>
      </Panel>
      <div className="dash">
        <div className="c5"><Panel title="Readiness summary">
          {!alt ? <p className="small muted">Available once routes are planned for the current base and target.</p> : (
            <ul className="stack" style={{ listStyle: "none", margin: 0, padding: 0 }}>
              <Check ok={true}>Numeric terrain coverage: MOLA window <b>{alt.tile.id}</b>, {fmt(alt.tile.valid_fraction * 100, 1)}% valid cells.</Check>
              <Check ok={!!rec && rec.constraints_violated.length === 0}>{rec ? `Recommended route is within the ${s.config.maxSlopeDeg}° slope cap on the ${fmt(alt.resolution.pixel_size_m, 0)} m grid (terrain-evaluated, not terrain-safe).` : "No route satisfies slope/data constraints."}</Check>
              <Check ok={!!m?.feasible_within_model}>Resource &amp; time constraints {m?.feasible_within_model ? "pass" : "fail"} within the model.</Check>
              <Check ok={!!s.risk} warn>{s.risk ? `Uncertainty ensemble run (${s.risk.runs} scenarios).` : "Uncertainty ensemble not yet run (Risk Lab)."}</Check>
              <Check ok={!!s.scenario} warn>{s.scenario ? "Emergency scenario evaluated." : "No failure scenario evaluated (Emergency)."}</Check>
              <Check ok={false}>Certification: <b>not certifiable</b> — no rover-scale hazard data, assumption-based resource model.</Check>
            </ul>
          )}
        </Panel>
        </div><div className="c7"><Panel title="The decision story">
          {s.snapshot && s.isDemo() ? <ol className="stack" style={{ margin: 0, paddingLeft: 18 }}>{s.snapshot.demo.narrative.map(n => <li key={n}>{n}</li>)}</ol> : s.apiState === "unknown" && !s.snapshot ? <p className="small muted">Loading the demo story…</p> : <p className="small muted">{s.snapshot ? "The demo story describes the Jezero demo route. Your current inputs differ, so follow the steps below for your own route — or reload the demo." : "Demo story unavailable in this build."}</p>}
        </Panel></div>
      </div>
      <Notice tone="info">Challenge: <b>Interplanetary Survival Guide: Martian Map</b> (NASA Space Apps 2026). RedReturn layers topographic (MOLA numeric), optical (Viking), thermal (THEMIS/TES) and radiation (published surface dose, as a model parameter) context for a route a crew could plan. <Badge tone="warn">Prototype</Badge></Notice>
    </div>
  );
}
