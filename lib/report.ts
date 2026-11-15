import { jsPDF } from "jspdf";
import { api } from "./api";
import type { Alternatives, Datasets, Risk, Scenario, Snapshot } from "./types";
import { fmt, STRATEGY_LABEL } from "./format";

export function download(name: string, data: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type Body = Record<string, unknown>;
export const fetchReportJson = (b: Body) => api<Record<string, unknown>>("/api/reports/json", { body: b, timeoutMs: 60000 });
export const fetchGeoJson = (b: Body) => api<Record<string, unknown>>("/api/reports/geojson", { body: b, timeoutMs: 30000 });

/** Offline GeoJSON from an already-computed alternatives result (RFC 7946, east-positive longitudes in [-180,180]). */
export function geoJsonFrom(alt: Alternatives, origin: { lat: number; lon: number }, destination: { lat: number; lon: number }) {
  const wrap = (lon: number) => ((lon + 540) % 360) - 180;
  return {
    type: "FeatureCollection",
    features: [
      ...alt.routes.map(r => ({ type: "Feature", geometry: { type: "LineString", coordinates: r.coordinates.map(c => (c.elevation_m === null ? [c.lon, c.lat] : [c.lon, c.lat, c.elevation_m])) },
        properties: { strategy: r.strategy, distance_km: r.metrics.distance_km, max_slope_deg: r.metrics.max_slope_deg, feasible_within_model: r.mission.feasible_within_model, recommended: r.strategy === alt.recommended, elevation_note: "metres above MOLA areoid (not WGS84)" } })),
      { type: "Feature", geometry: { type: "Point", coordinates: [wrap(origin.lon), origin.lat] }, properties: { role: "origin" } },
      { type: "Feature", geometry: { type: "Point", coordinates: [wrap(destination.lon), destination.lat] }, properties: { role: "destination" } },
    ],
    properties: { generator: "RedReturn (offline export from snapshot/cached result)", disclaimer: "Not certified for human exploration." },
  };
}

type Src = "live" | "snapshot" | undefined;
export function buildPdf(p: { alt: Alternatives; risk: Risk | null; scenario: Scenario | null; datasets: Datasets | null; snapshot: Snapshot | null; origin: string; destination: string; strategy: string; sources: { alternatives?: Src; risk?: Src; scenario?: Src } }) {
  const doc = new jsPDF({ unit: "pt", format: "a4" }); let y = 48; const W = 500;
  const line = (t: string, size = 10, bold = false) => { doc.setFont("helvetica", bold ? "bold" : "normal"); doc.setFontSize(size); for (const l of doc.splitTextToSize(t, W) as string[]) { if (y > 790) { doc.addPage(); y = 48; } doc.text(l, 48, y); y += size + 4; } };
  line("RedReturn — Mars mission decision report", 16, true); y += 4;
  line("Research & education prototype. Not operational guidance. Not validated or endorsed by NASA. Terrain-evaluated is not mission-safe.", 9);
  y += 6; line(`Base ${p.origin}  →  Target ${p.destination}`, 11, true);
  line(`Terrain: NASA MGS MOLA DEM, ${fmt(p.alt.tile.pixel_size_m, 0)} m grid, window "${p.alt.tile.id}". ${p.alt.resolution.statement}`, 9);
  y += 6; line("Route alternatives", 12, true);
  for (const r of p.alt.routes) line(`${STRATEGY_LABEL[r.strategy]}: ${fmt(r.metrics.distance_km)} km, ascent ${fmt(r.metrics.elevation_gain_m, 0)} m, max slope ${fmt(r.metrics.max_slope_deg)}°, limiting ${r.mission.limiting_factor} ${fmt(r.mission.limiting_margin_percent)}%, ${r.mission.feasible_within_model ? "feasible within model" : "NOT feasible"}${r.constraints_violated.length ? `; violates ${r.constraints_violated.map(v => v.id).join(", ")}` : ""}.`, 9);
  line(`Recommendation: ${p.alt.recommended ? STRATEGY_LABEL[p.alt.recommended] : "none"}. ${p.alt.reason}`, 9);
  line(`Working plan analysed below: ${STRATEGY_LABEL[p.strategy] ?? p.strategy}${p.strategy === p.alt.recommended ? " (recommended)" : " (user selection)"}.`, 9);
  if (p.risk) { y += 6; line("Uncertainty ensemble (hypothetical inputs)", 12, true); line(`${fmt(p.risk.fraction_satisfying_constraints * 100, 1)}% of ${p.risk.runs} simulated scenarios satisfy modelled constraints. This is NOT a probability of mission success or survival. Seed ${p.risk.seed}; result hash ${p.risk.result_sha256.slice(0, 16)}.`, 9); }
  if (p.scenario) { y += 6; line("Emergency scenario", 12, true); p.scenario.incident.applied.forEach(a => line(`• ${a}`, 9)); line(`Revised mission: ${p.scenario.revised ? `${p.scenario.revised.label} — ${p.scenario.revised_feasible ? "feasible within model" : "still infeasible within model"}` : "none"}.`, 9); }
  y += 6; line("Data sources", 12, true);
  (p.datasets?.layers ?? []).forEach(d => line(`[${d.class}] ${d.name} — ${d.organization}. ${d.limitations[0] ?? ""}`, 8));
  y += 6; line("Limitations", 12, true); p.alt.limitations.forEach(l => line(`• ${l}`, 9));
  y += 6; line("Provenance of these results", 12, true);
  const usedSnapshot = Object.values(p.sources).includes("snapshot");
  line(`Routes: ${p.sources.alternatives === "snapshot" ? "precomputed snapshot" : "live API calculation"}${p.risk ? `; ensemble: ${p.sources.risk === "snapshot" ? "precomputed snapshot" : "live API calculation"}` : ""}${p.scenario ? `; emergency: ${p.sources.scenario === "snapshot" ? "precomputed snapshot" : "live API calculation"}` : ""}. PDF assembled in the browser at ${new Date().toISOString().slice(0, 19)}Z.`, 8);
  if (usedSnapshot && p.snapshot) line(`Snapshot generated ${p.snapshot.snapshot.generated_at_utc}${p.snapshot.snapshot.git_commit ? ` (commit ${p.snapshot.snapshot.git_commit})` : ""} for the Jezero demo scenario; it is not live.`, 8);
  return doc;
}
