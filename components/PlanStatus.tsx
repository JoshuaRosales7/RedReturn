"use client";
import { Globe2, RefreshCw, RotateCcw, WifiOff } from "lucide-react";
import { useMissionStore } from "@/lib/store";
import { diagnoseCoverage, fmtBounds, routeReach } from "@/lib/coverage";
import { LongRangeOnlyLocal } from "./LongRange";
import { coord } from "@/lib/format";
import { Empty, Loading } from "./ui";

/** DEM windows with their extent, so the user can see where valid coordinates are. */
export function WindowList() {
  const cover = useMissionStore(s => s.coverage);
  if (!cover.length) return <p className="tiny dim">DEM window list unavailable (API offline and no snapshot).</p>;
  return <ul className="winlist">{cover.map(c => <li key={c.id}><b className="small">{c.name}</b> <span className="tiny dim num">{fmtBounds(c.bounds)} · {Math.round(c.pixel_size_m)} m cells</span></li>)}</ul>;
}

/**
 * Explains why there is no terrain analysis for the current inputs and offers recovery actions that actually help.
 * Renders nothing when an analysis is available.
 */
export function PlanStatus({ what = "terrain analysis", feature = "This analysis" }: { what?: string; feature?: string }) {
  const s = useMissionStore();
  if (s.alternatives) return null;
  if (s.longRange) return <LongRangeOnlyLocal what={feature} />;
  const err = s.errors.alternatives;
  const demoBtn = <button className="btn sm primary" onClick={s.loadDemo}><RotateCcw size={13} aria-hidden />Load Jezero demo route</button>;
  const explorerBtn = s.tab !== "explorer" && <button className="btn sm" onClick={() => s.setTab("explorer")}><Globe2 size={13} aria-hidden />Choose points in Mars Explorer</button>;

  if (s.busy.alt && !err) {
    if (!routeReach(s.origin, s.destination).local) return <Loading label="Long route: reading a sampled NASA MOLA grid between the points and planning an overview route (usually 10–60 s)…" />;
    const cached = diagnoseCoverage(s.origin, s.destination, s.coverage).ok;
    return cached || s.apiState === "offline" ? <Loading label="Sampling MOLA elevations and planning routes…" />
      : <Loading label="New area: downloading real NASA MOLA elevations for it, then planning routes (first time only, usually 5–60 s)…" />;
  }
  if (!err) return <Empty title={`No ${what} yet`} actions={demoBtn}>Choose a base and a target in Mars Explorer, or load the demo route.</Empty>;

  if (err.offline) {
    const demo = s.isDemo();
    return <div className="problem" role="alert">
      <h2 className="problem-title"><WifiOff size={16} aria-hidden />API offline — live planning unavailable</h2>
      <p className="small muted">{demo
        ? "The RedReturn API is not reachable and no precomputed snapshot is available in this build."
        : "The RedReturn API is not reachable. Offline, RedReturn can only show the precomputed snapshot of the Jezero demo route; it never estimates terrain or resources for other coordinates."}</p>
      <div className="row"><button className="btn sm" onClick={() => void s.retryConnection()} disabled={s.apiState === "unknown"}><RefreshCw size={13} aria-hidden />{s.apiState === "unknown" ? "Connecting…" : "Retry connection"}</button>{!demo && s.snapshot && demoBtn}</div>
    </div>;
  }

  if (err.code === "outside_dem_coverage") {
    const d = diagnoseCoverage(s.origin, s.destination, s.coverage);
    const o = `base (${coord(s.origin.lat, s.origin.lon)})`, t = `target (${coord(s.destination.lat, s.destination.lon)})`;
    const why = d.ok ? "The API reports the route is outside its cached elevation data." :
      d.problem === "origin" ? `The ${o} is outside every cached MOLA window.` :
      d.problem === "destination" ? `The ${t} is outside every cached MOLA window.` :
      d.problem === "both" ? `Both the ${o} and the ${t} are outside every cached MOLA window.` :
      d.problem === "different" ? `The base is in the ${d.origin?.name} window and the target in the ${d.destination?.name} window; a route must stay inside one window.` :
      "Base and target must both lie inside one cached MOLA window.";
    return <div className="problem" role="alert">
      <h2 className="problem-title">No elevation data for this route</h2>
      <p className="small muted">This API is configured to use only its cached MOLA windows (on-demand download is disabled).</p>
      <p className="small">{why} Elevation outside these windows is unavailable — RedReturn does not fill it in.</p>
      <p className="small muted" style={{ marginBottom: 4 }}>To fix it, load the demo route or move both points inside one of these windows:</p>
      <WindowList />
      <div className="row">{demoBtn}{explorerBtn}</div>
    </div>;
  }

  const hint: Record<string, string> = {
    endpoint_nodata: "The DEM has no elevation at that point. Move the base or target a little.",
    endpoint_blocked: "That point lies inside an area the planner treats as obstructed. Move it or relax the slope limit in Planner.",
    no_traversable_route: "No path stays under the slope limit with known elevation. Move a point, or raise the slope limit in Planner (a scenario assumption).",
    grid_too_large: "Local planning works for excursions up to roughly 150 km. Move the base and target closer together (the demo route is about 25 km).",
    nodata: "The MOLA DEM has no elevation here. Move the points slightly.",
    dem_download_failed: "The API could not download MOLA elevations for this new area — its host may have no internet access. Retry, or use a cached window (Jezero, Gale).",
    timeout: "The API is still working — usually downloading real MOLA elevations for a large or new area, which depends on the NASA/USGS server. Retry in a moment; finished downloads are kept, so the next try is faster.",
    stop_outside_area: "Science stops must be near the route (within about 150 km of both base and target). Remove or move the stop in Planner.",
    crosses_antimeridian: "Base and target sit on both sides of the 180° meridian; local planning does not wrap there. Move both points to the same side.",
    download_rate_limited: "Several new areas were requested in a short time. Wait a minute and retry, or use an area that is already stored.",
    dem_source_changed: "The NASA/USGS source file no longer matches the verified layout, so RedReturn refuses to read it. Use a cached window.",
    validation_error: "Some inputs are out of range. Check the coordinates and Planner values.",
  };
  const retryable = !hint[err.code] || ["dem_download_failed", "download_rate_limited", "timeout"].includes(err.code);
  const title: Record<string, string> = { grid_too_large: "Base and target are too far apart", dem_download_failed: "Elevation download failed", no_traversable_route: "No traversable route under the slope limit", download_rate_limited: "Please wait a moment", timeout: "The API is taking longer than expected", stop_outside_area: "A science stop is outside the route area" };
  return <div className="problem" role="alert">
    <h2 className="problem-title">{title[err.code] ?? "Route planning failed"}</h2>
    <p className="small"><b>{err.message}</b> {hint[err.code] ?? "This may be temporary."}</p>
    <div className="row">{retryable && <button className="btn sm" onClick={() => void s.refreshAlternatives()}><RefreshCw size={13} aria-hidden />Retry</button>}{err.code === "stop_outside_area" && <button className="btn sm primary" onClick={() => s.setStops([])}>Remove all science stops</button>}{demoBtn}{explorerBtn}</div>
  </div>;
}
