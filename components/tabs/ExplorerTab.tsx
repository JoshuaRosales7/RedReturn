"use client";
import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { CATALOG, LAYERS } from "@/data/catalog";
import { useMissionStore } from "@/lib/store";
import { coord } from "@/lib/format";
import { normalizeLon } from "@/lib/mars";
import { bringWithinLocal, diagnoseCoverage, fmtBounds, localArea, localAreaKm, MAX_ROUTE_SPAN_DEG, routeReach, routeSpanDeg, windowFor } from "@/lib/coverage";
import type { Point } from "@/lib/types";
import { CheckCircle2, Globe2, Ruler, RotateCcw, TriangleAlert } from "lucide-react";
import { Badge, Loading, NextStep, NumField, PageHead, Panel } from "../ui";
import { RegionMap, type MapFocus } from "../RegionMap";

const Globe = dynamic(() => import("../AdvancedMarsGlobe"), { ssr: false, loading: () => <div className="globe"><Loading label="Loading 3D globe…" /></div> });

/** Example routes checked against the API (all four strategies plan). Coordinates are illustrative, not gazetteer features. */
const EXAMPLES: Record<string, { origin: Point; destination: Point; note: string }> = {
  gale: { origin: { lat: -4.59, lon: 137.44, name: "Gale floor base (example coordinate)" }, destination: { lat: -4.75, lon: 137.3, name: "Gale floor target (example coordinate)" }, note: "≈13 km on the crater floor" },
};

export function ExplorerTab() {
  const s = useMissionStore();
  const [q, setQ] = useState(""); const [focus, setFocus] = useState<{ lat: number; lon: number } | null>(null);
  const [mapFocus, setMapFocus] = useState<MapFocus | null>(null);
  const results = useMemo(() => CATALOG.filter(c => (c.name + c.kind).toLowerCase().includes(q.toLowerCase())), [q]);
  const cover = s.coverage;
  const diag = diagnoseCoverage(s.origin, s.destination, cover);
  const reach = routeReach(s.origin, s.destination);
  const show = (lat: number, lon: number, z?: number) => { setFocus({ lat, lon }); setMapFocus({ lat, lon, z, key: Date.now() }); };
  const pick = (p: { lat: number; lon: number }) => s.setPoint({ lat: +p.lat.toFixed(4), lon: +normalizeLon(p.lon).toFixed(4) });
  const place = (c: (typeof CATALOG)[number], as: "origin" | "destination") => { (as === "origin" ? s.setOrigin : s.setDestination)({ lat: c.lat, lon: c.lon, name: c.name }); setFocus({ lat: c.lat, lon: c.lon }); };
  const example = (id: string) => { const e = EXAMPLES[id]; s.setStops([]); s.setOrigin(e.origin); s.setDestination(e.destination); setFocus(e.origin); };
  const planned = s.longRange?.routes.find(r => r.strategy === "terrain")?.coordinates ?? s.alternatives?.routes.find(r => r.strategy === s.alternatives?.recommended)?.coordinates;
  const km = reach.km < 10 ? reach.km.toFixed(1) : Math.round(reach.km).toLocaleString("en-US");
  return (
    <div className="stack" style={{ gap: 12 }}>
    <PageHead icon={Globe2} title="Mars Explorer">Choose where the crew starts (base) and where it goes (target) — anywhere on Mars, at any distance. A target inside the dashed box around the base (3° of latitude and longitude, roughly 150–180 km) gets the detailed local analysis; farther away, a long-range overview route. Zoom the close-up map to place points precisely.</PageHead>
    <div className="dash">
      <div className="col c4 side-sticky">
        <Panel title="Select points" tour="points">
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <span className="small muted" id="click-sets">Map click sets</span>
            <div className="seg" role="group" aria-labelledby="click-sets">
              <button aria-pressed={s.selection === "origin"} onClick={() => s.setSelection("origin")}>Base</button><button aria-pressed={s.selection === "destination"} onClick={() => s.setSelection("destination")}>Target</button>
            </div>
          </div>
          {([["Base", "origin", s.origin, s.setOrigin], ["Target", "destination", s.destination, s.setDestination]] as const).map(([label, key, p, set]) => { const w = windowFor(p, cover); return (
            <fieldset key={label} className="ptset">
              <legend className="row between" style={{ width: "100%" }}><b className="small">{label}</b>{reach.local && cover.length ? (w ? <Badge tone="ok" title={w.name}>elevation stored</Badge> : s.apiState === "offline" ? <Badge tone="warn">no stored elevation</Badge> : <Badge tone="info" title="The API downloads real MOLA elevations for this area when routes are planned">new area · downloads on plan</Badge>) : null}</legend>
              <div className="grid g2"><NumField label={`${label} latitude`} unit="°N" value={p.lat} min={-90} max={90} step={0.01} onChange={v => set({ lat: v, lon: p.lon })} /><NumField label={`${label} longitude`} unit="°E" value={p.lon} min={-180} max={180} step={0.01} onChange={v => set({ lat: p.lat, lon: v })} /></div>
              <span className="tiny dim">{p.name ?? "Custom coordinate"} · {coord(p.lat, p.lon)}{s.selection === key ? " · next map click moves this point" : ""}</span>
            </fieldset>); })}
          <div className={`reach ${reach.local ? "ok" : "long"}`} role="status">
            <Ruler size={15} aria-hidden />
            {reach.local
              ? <div><b>Distance {km} km</b> · local excursion: detailed analysis on the 463 m MOLA grid, with Risk Lab, Emergency and ARES.</div>
              : <div><b>Distance {km} km</b> · long-range route: an overview on a sampled MOLA grid with travel and supply estimates. Risk Lab, Emergency and ARES need a local excursion.</div>}
          </div>
          {!reach.local && (() => {
            const a = localAreaKm(s.origin.lat), dLat = Math.abs(s.destination.lat - s.origin.lat), dLon = routeSpanDeg({ lat: 0, lon: s.origin.lon }, { lat: 0, lon: s.destination.lon });
            return <div className="small muted" style={{ display: "grid", gap: 6 }}>
              <span>The detailed analysis needs the target within <b>{MAX_ROUTE_SPAN_DEG}° of latitude and {MAX_ROUTE_SPAN_DEG}° of longitude</b> of the base — here about {Math.round(a.ns)} km north–south and {Math.round(a.ew)} km east–west (the dashed box on the close-up map). Your target is {dLat.toFixed(1)}° in latitude and {dLon.toFixed(1)}° in longitude away.</span>
              {dLat < 25 && dLon < 25 && <button className="btn sm" style={{ justifySelf: "start" }} onClick={() => s.setDestination({ ...bringWithinLocal(s.origin, s.destination), name: "Target moved inside the local area" })}>Bring the target inside the local area</button>}
            </div>;
          })()}
          {s.stopsNotice && <p className="small" style={{ color: "var(--warn)", margin: 0 }} role="status">{s.stopsNotice}</p>}
          {reach.local && cover.length > 0 && (diag.ok
            ? <p className="small row" style={{ flexWrap: "nowrap", color: "var(--ok)" }} role="status"><CheckCircle2 size={15} aria-hidden style={{ flex: "none" }} />Both points are in the {diag.window.name} — elevations are ready.</p>
            : s.apiState === "offline"
              ? <div className="notice" role="status"><TriangleAlert size={15} aria-hidden /><div>The API is offline, so elevations for new areas cannot be downloaded. Use a green window or load the demo route.</div></div>
              : <div className="notice info" role="status"><CheckCircle2 size={15} aria-hidden /><div>This area is not stored yet. When routes are planned, the API downloads the real NASA MOLA elevations around both points (first time only).</div></div>)}
        </Panel>
        <Panel title="Stored elevation areas" right={<Badge tone="info">NASA MGS MOLA</Badge>}>
          {cover.length === 0 ? <p className="tiny dim">Window list unavailable (API offline and no snapshot).</p> : <div className="stack">
            {cover.map(c => <div key={c.id} className="win">
              <div className="row between"><b className="small">{c.name}</b><span className="tiny dim">{Math.round(c.pixel_size_m)} m cells</span></div>
              <div className="tiny muted num">{fmtBounds(c.bounds)}</div>
              <div className="row">
                {c.id === "jezero" && <button className="btn sm primary" onClick={() => s.loadDemo()}><RotateCcw size={13} aria-hidden />Load Jezero demo route</button>}
                {EXAMPLES[c.id] && <button className="btn sm" onClick={() => example(c.id)} title={EXAMPLES[c.id].note}>Use {c.id === "gale" ? "Gale" : c.id} example route</button>}
                <button className="btn sm" onClick={() => show((c.bounds.lat_min + c.bounds.lat_max) / 2, (c.bounds.lon_min + c.bounds.lon_max) / 2, 4)}>Show on map</button>
              </div>
            </div>)}
            <p className="tiny dim">Areas you plan elsewhere are added to this list after their MOLA elevations are downloaded. Elevation is never estimated or filled in.</p>
          </div>}
        </Panel>
        <Panel title="Location catalog" right={<span className="tiny dim">{results.length} / {CATALOG.length}</span>}>
          <input type="search" placeholder="Search named features…" value={q} onChange={e => setQ(e.target.value)} aria-label="Search locations" />
          <div className="stack" style={{ marginTop: 8, maxHeight: 280, overflow: "auto" }} tabIndex={-1}>
            {results.length === 0 && <p className="muted small">No match. Try “crater” or “plain”.</p>}
            {results.map(c => { const w = windowFor(c, cover); return <div key={c.id} className="row between" style={{ flexWrap: "nowrap" }}><div style={{ minWidth: 0 }}><b className="small">{c.name}</b> {w && <Badge tone="ok" title="Elevations already stored">DEM</Badge>}<div className="tiny dim">{c.kind} · {coord(c.lat, c.lon)}</div></div><div className="row" style={{ flexWrap: "nowrap" }}><button className="btn sm" onClick={() => place(c, "origin")} aria-label={`Set ${c.name} as base`}>Base</button><button className="btn sm" onClick={() => place(c, "destination")} aria-label={`Set ${c.name} as target`}>Target</button></div></div>; })}
          </div>
          <p className="tiny dim" style={{ marginTop: 8 }}>Approximate centres; verify with the USGS Planetary Gazetteer. For a short excursion at a named place, set it as base, then click the close-up map nearby for the target.</p>
        </Panel>
        <Panel title="Imagery layer" right={<Badge tone="info">NASA Mars Trek</Badge>}>
          <fieldset className="plain"><legend className="sr">Imagery layer</legend><div className="stack">{LAYERS.map(l => <label key={l.id} className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}><input type="radio" name="layer" checked={s.layer === l.id} onChange={() => s.setLayer(l.id)} /><span><b className="small">{l.name}</b> <Badge>{l.kind}</Badge><br /><span className="tiny muted">{l.note}{l.maxZoom < 3 ? " Low resolution: blurry in close-up." : ""}</span></span></label>)}</div></fieldset>
          <p className="tiny dim" style={{ marginTop: 8 }}>Imagery is for orientation only; colours are never read back as elevation or used in any calculation.</p>
        </Panel>
      </div>
      <div className="col c8">
        <h2 className="section-title">Close-up map</h2>
        <RegionMap layer={s.layer} origin={s.origin} destination={s.destination} coverage={cover} onPick={pick} focus={mapFocus} route={planned} selection={s.selection} localBox={localArea(s.origin)} />
        <h2 className="section-title">3D globe</h2>
        <Globe layer={s.layer} origin={s.origin} destination={s.destination} focus={focus} onPick={pick} coverage={cover} />
        <p className="tiny dim">Click the close-up map or the globe to move the {s.selection === "origin" ? "base" : "target"} (keyboard users: type coordinates on the left, or focus the close-up and use arrows and +/−). Both share the same base, target and imagery layer; green outlines are stored elevation areas.</p>
        <NextStep detail={reach.local ? "Points set. Inspect real MOLA elevations and slopes along the candidate routes." : "Points set. See the long-range overview route and its elevation profile."} label="Open Terrain" onClick={() => s.setTab("terrain")} />
      </div>
    </div>
    </div>
  );
}
