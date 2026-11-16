"use client";
import { useEffect, useMemo, useState } from "react";
import { Camera, ExternalLink, RefreshCw, Sun, Zap } from "lucide-react";
import { useMissionStore } from "@/lib/store";
import { useApiGet } from "@/lib/useApi";
import { daylightAround, hhmm, localTrueSolarTime, marsTime, seasonOf, solarElevation, suggestedEvaStart, SOL_MS } from "@/lib/marstime";
import { fmt } from "@/lib/format";
import type { SpaceWeather, SurfaceImages } from "@/lib/types";
import { Badge, Loading, Panel, Stat, revealImg } from "./ui";

/**
 * Current time, refreshed every minute. Null until mounted in the browser: reading the clock during rendering would make the
 * pre-rendered HTML (build/server time) differ from the client and break hydration.
 */
export function useNow(stepMs = 60000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), stepMs); return () => clearInterval(t); }, [stepMs]);
  return now;
}

const ltst = (d: Date, lon: number) => hhmm(localTrueSolarTime(d, lon));
const utcInput = (ms: number) => new Date(ms).toISOString().slice(0, 16);           // value for <input type="datetime-local"> (as UTC)
const fmtUtc = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export type EvaPlan = { start: Date | null; auto: boolean; end: Date | null; sunrise: Date | null; sunset: Date | null; polar: "day" | "night" | null; fitsDaylight: boolean | null };

/** EVA timing for the current mission: start (automatic or chosen), end from the modelled duration, and the daylight window. */
export function useEvaPlan(now: number | null): EvaPlan {
  const s = useMissionStore();
  const rec = s.alternatives?.routes.find(r => r.strategy === s.alternatives?.recommended) ?? s.alternatives?.routes[0];
  return useMemo(() => {
    const { lat, lon } = s.origin;
    if (now === null && s.evaStartUtc === null) return { start: null, auto: true, end: null, sunrise: null, sunset: null, polar: null, fitsDaylight: null };   // clock not read yet
    const start = s.evaStartUtc !== null ? new Date(s.evaStartUtc) : suggestedEvaStart(new Date(now!), lat, lon);
    if (!start) return { start: null, auto: s.evaStartUtc === null, end: null, sunrise: null, sunset: null, polar: "night", fitsDaylight: false };
    const w = daylightAround(start, lat, lon);
    const hours = rec?.mission.duration_hours ?? null;
    const end = hours !== null ? new Date(start.getTime() + hours * 3600000) : null;
    const lit = w.polar === "day" ? true : w.polar === "night" ? false
      : !!(w.sunrise && w.sunset && start >= w.sunrise && end && end <= w.sunset);
    return { start, auto: s.evaStartUtc === null, end, sunrise: w.sunrise, sunset: w.sunset, polar: w.polar, fitsDaylight: end ? lit : null };
  }, [s.origin, s.evaStartUtc, rec, now]);
}

/** Season, local solar time, Sun and the EVA daylight check at the base (Mars24 calculation, class B). */
export function SiteConditions() {
  const s = useMissionStore(); const now = useNow();
  const eva = useEvaPlan(now);
  if (now === null) return <Panel title="Conditions at the base" tour="conditions"><Loading label="Calculating season and daylight at the base…" /></Panel>;
  const { lat, lon } = s.origin;
  const t = marsTime(new Date(now));
  const season = seasonOf(t.ls, lat);
  const el = solarElevation(new Date(now), lat, lon);
  return (
    <Panel title="Conditions at the base" tour="conditions" right={<Badge tone="info" title="Mars24 algorithm (Allison & McEwen 2000, NASA GISS)">class B · calculated</Badge>}>
      <div className="kpis compact">
        <Stat label="Season" value={`Ls ${fmt(t.ls, 1)}°`} detail={`Mars Year ${t.marsYear} · ${season.name}`} tone={season.dustSeason ? "warn" : undefined} />
        <Stat label="Local solar time now" value={ltst(new Date(now), lon)} detail={`Sun ${el >= 0 ? `${fmt(el, 0)}° above` : `${fmt(-el, 0)}° below`} the horizon`} />
      </div>
      {season.dustSeason && <p className="small" style={{ color: "var(--warn)", margin: "8px 0 0" }}>Ls 180°–360° is the dust-storm season (around perihelion): regional storms are more likely, cutting sunlight and visibility. Check orbiter weather before going out.</p>}
      <div className="eva-time">
        <label className="field"><span>EVA start (UTC)</span>
          <input type="datetime-local" value={eva.start ? utcInput(eva.start.getTime()) : ""} onChange={e => { const v = e.target.value; if (v) s.setEvaStart(Date.parse(`${v}:00Z`)); }} />
        </label>
        <button className="btn sm" onClick={() => s.setEvaStart(null)} disabled={eva.auto} title="30 minutes after the next sunrise at the base">Auto (after sunrise)</button>
      </div>
      {eva.start ? <ul className="eva-facts small">
        <li><b>Start</b> {ltst(eva.start, lon)} local · {fmtUtc(eva.start)}{eva.auto ? " · automatic" : ""}</li>
        {eva.polar ? <li>{eva.polar === "day" ? "Polar day: the Sun does not set." : "Polar night: the Sun does not rise."}</li>
          : <li><b>Daylight</b> {eva.sunrise ? ltst(eva.sunrise, lon) : "—"} → {eva.sunset ? ltst(eva.sunset, lon) : "—"} local ({eva.sunrise && eva.sunset ? fmt((eva.sunset.getTime() - eva.sunrise.getTime()) / 3600000, 1) : "—"} h)</li>}
        {eva.end && <li><b>Back at base</b> {ltst(eva.end, lon)} local, after the modelled {fmt((eva.end.getTime() - eva.start.getTime()) / 3600000, 1)} h</li>}
        {eva.fitsDaylight !== null && <li style={{ color: eva.fitsDaylight ? "var(--ok)" : "var(--bad)" }}>{eva.fitsDaylight ? "✓ The whole excursion happens in daylight." : "✗ Part of the excursion falls outside daylight — start earlier or shorten the plan."}</li>}
      </ul> : <p className="small" style={{ color: "var(--bad)" }}>Polar night at the base: no daylight window to plan an EVA.</p>}
      <p className="tiny dim" style={{ margin: "6px 0 0" }}>Sunrise/sunset for a flat horizon, without refraction or crater walls; one sol = 24 h 39 min. Local times are true solar time at the base.</p>
    </Panel>
  );
}

/** Recent NASA DONKI notifications (context only; never changes calculated doses). */
export function SpaceWeatherPanel({ limit = 4 }: { limit?: number }) {
  const sw = useApiGet<SpaceWeather>("/api/conditions/space-weather");
  const [all, setAll] = useState(false);
  const items = sw.data?.items ?? [];
  const mars = items.filter(i => i.mentions_mars).length;
  return (
    <Panel title="Space weather" tour="spaceweather" right={<Badge tone="info" title={sw.data?.source}>NASA CCMC DONKI</Badge>}>
      {sw.loading && <Loading label="Reading NASA space-weather notifications…" />}
      {sw.error && <div className="stack small"><span className="muted">{sw.error.offline ? "Unavailable while the API is offline." : `Unavailable: ${sw.error.message}`}</span><button className="btn sm" onClick={sw.reload}><RefreshCw size={13} aria-hidden />Retry</button></div>}
      {sw.data && <>
        <p className="small" style={{ margin: "0 0 8px" }}><Zap size={13} aria-hidden style={{ verticalAlign: "-2px", color: "var(--warn)" }} /> <b>{items.length}</b> notifications in the last {sw.data.window_days} days{mars ? <>, <b>{mars}</b> mention Mars</> : ""}.</p>
        {items.length === 0 && <p className="small muted">No flare, particle or CME notifications in this period.</p>}
        <ul className="sw-list">
          {(all ? items : items.slice(0, limit)).map((i, k) => <li key={`${i.url}-${k}`}>
            <div className="row between" style={{ flexWrap: "nowrap" }}><span className="small"><b>{i.label}</b> {i.mentions_mars && <Badge tone="warn">mentions Mars</Badge>}</span><span className="tiny dim num">{i.issued?.slice(0, 16).replace("T", " ")}</span></div>
            <div className="tiny muted">{i.summary}</div>
            {i.url && <a className="tiny" href={i.url} target="_blank" rel="noreferrer noopener">NASA notification <ExternalLink size={10} aria-hidden /></a>}
          </li>)}
        </ul>
        {items.length > limit && <button className="btn sm" onClick={() => setAll(v => !v)}>{all ? "Show fewer" : `Show all ${items.length}`}</button>}
        <p className="tiny dim" style={{ margin: "8px 0 0" }}>{sw.data.note}{sw.data.excluded_earth_only.length ? ` Not shown (Earth only): ${sw.data.excluded_earth_only.map(e => `${e.count} × ${e.label}`).join(", ")}.` : ""}</p>
      </>}
    </Panel>
  );
}

/** Ground-level context: latest raw images from the NASA rover operating in the region, if any. */
export function GroundView() {
  const s = useMissionStore();
  const [nearest, setNearest] = useState(false);
  const site = `${s.origin.lat.toFixed(2)},${s.origin.lon.toFixed(2)}`;
  const [nearestFor, setNearestFor] = useState(site);
  const showNearest = nearest && nearestFor === site;               // a new base asks again instead of reusing the choice
  const q = `/api/conditions/surface-images?lat=${s.origin.lat.toFixed(2)}&lon=${s.origin.lon.toFixed(2)}&n=8${showNearest ? "&nearest=true" : ""}`;
  const r = useApiGet<SurfaceImages>(q);
  const ref = !!r.data?.reference_only;
  return (
    <Panel title="Ground view from NASA rovers" tour="groundview" right={r.data?.rover ? <Badge tone={ref ? "warn" : "info"}>{r.data.rover.name} · {r.data.rover.region}{ref ? ` · ${r.data.distance_km?.toLocaleString("en-US")} km away — reference only` : ""}</Badge> : undefined}>
      {r.loading && <Loading label="Looking for rover images of this region…" />}
      {r.error && <div className="stack small"><span className="muted">{r.error.offline ? "Unavailable while the API is offline." : `Unavailable: ${r.error.message}`}</span><button className="btn sm" onClick={r.reload}><RefreshCw size={13} aria-hidden />Retry</button></div>}
      {r.data && !r.data.rover && <div className="stack small">
        <p className="muted" style={{ margin: 0 }}><Camera size={13} aria-hidden style={{ verticalAlign: "-2px" }} /> {r.data.note} Nearest: {r.data.nearest?.name} in {r.data.nearest?.region}, {r.data.nearest?.distance_km.toLocaleString("en-US")} km away.</p>
        <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => { setNearest(true); setNearestFor(site); }}><Camera size={13} aria-hidden />Show {r.data.nearest?.name}&apos;s latest images as a general reference</button>
      </div>}
      {r.data?.rover && <>
        <div className="gallery">{r.data.images.map(im => <a key={im.url} href={im.page ?? im.full_url} target="_blank" rel="noreferrer noopener" className="shot">
          <img src={im.url} alt={`${im.title ?? `${r.data!.rover!.name} image`} (${im.camera}, sol ${im.sol})`} loading="lazy" referrerPolicy="no-referrer" {...revealImg} />
          <span className="tiny">Sol {im.sol} · {im.camera}</span>
        </a>)}</div>
        {r.data.images.length === 0 && <p className="small muted">No recent images returned by the feed.</p>}
        <p className="tiny dim" style={{ margin: "8px 0 0" }}>{r.data.note} Credit: {r.data.rover.credit}.</p>
      </>}
    </Panel>
  );
}

export const SOL_HOURS_EARTH = SOL_MS / 3600000;
