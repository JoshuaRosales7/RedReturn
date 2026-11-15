"use client";
import { useEffect, useMemo, useRef } from "react";
import type { Heightfield, Point, RouteAlt, Stop } from "@/lib/types";
import { STRATEGY_COLOR } from "@/lib/format";
import { elevationRange, reliefColor, RELIEF_GRADIENT, upsample } from "@/lib/relief";

const KM_PER_DEG = 59.274; // Mars, spherical, R = 3396.19 km

/** Hypsometric tint + hillshade. Bilinear upsampling is for display only: it adds no information and never fills missing cells. */
function paint(hf: Heightfield, canvas: HTMLCanvasElement, showSlope: boolean, maxSlope: number) {
  const f = Math.max(1, Math.min(6, Math.floor(720 / hf.cols)));
  const g = upsample(hf.elevation_m, hf.rows, hf.cols, f);
  const { rows, cols, z } = g;
  canvas.width = cols; canvas.height = rows;
  const ctx = canvas.getContext("2d"); if (!ctx) return;
  const img = ctx.createImageData(cols, rows);
  const rng = elevationRange(hf.elevation_m); if (!rng) return;
  const span = Math.max(1, rng.hi - rng.lo), cellM = hf.display_pixel_m / f;
  const at = (r: number, c: number) => z[Math.min(rows - 1, Math.max(0, r)) * cols + Math.min(cols - 1, Math.max(0, c))];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = (r * cols + c) * 4, v = z[r * cols + c];
    if (v === null) { img.data.set([255, 0, 255, 255], i); continue; }            // missing data stays visibly missing
    const base = reliefColor((v - rng.lo) / span);
    const a = at(r - 1, c - 1), b = at(r - 1, c + 1), d = at(r + 1, c - 1), e = at(r + 1, c + 1);
    let shade = 1;
    if (a !== null && b !== null && d !== null && e !== null) {
      const dzdx = (b - a + e - d) / (4 * cellM), dzdy = (d - a + e - b) / (4 * cellM);
      shade = Math.max(0.55, Math.min(1.45, 1 + 5 * (-dzdx * 0.6 + dzdy * 0.8)));   // NW light
    }
    let [R, G, B] = base.map(x => Math.min(255, x * shade));
    const s = hf.slope_deg[Math.min(hf.rows - 1, Math.round(r / f)) * hf.cols + Math.min(hf.cols - 1, Math.round(c / f))];
    if (showSlope && s !== null && s > maxSlope) { R = R * 0.3 + 235 * 0.7; G = G * 0.3 + 60 * 0.7; B = B * 0.3 + 60 * 0.7; }
    img.data.set([R, G, B, 255], i);
  }
  ctx.putImageData(img, 0, 0);
}

export function TerrainMap({ hf, routes, show, origin, destination, stops, showSlope, maxSlope, onPick, pickLabel = "point" }: {
  hf: Heightfield; routes: Pick<RouteAlt, "strategy" | "coordinates">[]; show: string[]; origin: Point; destination: Point; stops: Stop[]; showSlope: boolean; maxSlope: number; onPick?: (p: Point) => void; pickLabel?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { if (ref.current) paint(hf, ref.current, showSlope, maxSlope); }, [hf, showSlope, maxSlope]);
  const { bounds: b } = hf;
  const W = 1000, H = (hf.rows / hf.cols) * 1000;
  const rng = useMemo(() => elevationRange(hf.elevation_m), [hf]);
  const widthKm = (b.lon_max - b.lon_min) * Math.cos(((b.lat_max + b.lat_min) / 2) * Math.PI / 180) * KM_PER_DEG;
  const px = (lat: number, lon: number) => [((lon - b.lon_min) / (b.lon_max - b.lon_min)) * W, ((b.lat_max - lat) / (b.lat_max - b.lat_min)) * H];
  const paths = useMemo(() => routes.filter(r => show.includes(r.strategy)).map(r => ({ s: r.strategy, d: r.coordinates.map((c, i) => { const [x, y] = px(c.lat, c.lon); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join("") })), [routes, show, b]); // eslint-disable-line react-hooks/exhaustive-deps
  const click = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onPick) return; const r = e.currentTarget.getBoundingClientRect();
    onPick({ lon: b.lon_min + ((e.clientX - r.left) / r.width) * (b.lon_max - b.lon_min), lat: b.lat_max - ((e.clientY - r.top) / r.height) * (b.lat_max - b.lat_min) });
  };
  const mark = (p: { lat: number; lon: number }, color: string, label: string) => { const [x, y] = px(p.lat, p.lon); const left = x > W * 0.82; return <g key={label + p.lat}><circle cx={x} cy={y} r={9} fill={color} stroke="#0a0d11" strokeWidth={3} /><text x={left ? x - 14 : x + 14} y={y + 6} textAnchor={left ? "end" : "start"} fill="#fff" fontSize={22} fontWeight={600} stroke="#000" strokeWidth={5} paintOrder="stroke">{label}</text></g>; };
  return (
    <div className="mapwrap">
      <canvas ref={ref} aria-label="Shaded relief rendered from MOLA elevations" role="img" />
      {/* Route overlay is decorative for assistive tech: the same routes are listed in the metrics table. Coordinates can be typed in Mars Explorer. */}
      <svg viewBox={`0 0 ${W} ${H}`} style={{ position: "absolute", inset: 0, cursor: onPick ? "crosshair" : "default" }} onClick={click} aria-hidden="true">
        {paths.map(p => <path key={p.s} d={p.d} fill="none" stroke="#0a0d11" strokeWidth={10} opacity={.6} strokeLinejoin="round" strokeLinecap="round" />)}
        {paths.map(p => <path key={p.s + "c"} d={p.d} fill="none" stroke={STRATEGY_COLOR[p.s]} strokeWidth={5} strokeDasharray={p.s === "shortest" ? "14 9" : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {stops.map((s, i) => mark(s, "#b48ead", `S${i + 1}`))}
        {mark(origin, "#62b8a4", "BASE")}{mark(destination, "#e8794a", "TARGET")}
      </svg>
      <div className="map-north" aria-hidden>N<span>↑</span></div>
      {onPick && <div className="map-pick" aria-hidden>Click to place the {pickLabel}</div>}
      {hf.elevation_m.some(v => v === null) && <div className="map-nodata"><i />No data (never filled)</div>}
      <div className="mapbar">
        <div className="cbar"><span className="num tiny">{rng ? `${Math.round(rng.lo)} m` : "—"}</span><i style={{ background: RELIEF_GRADIENT }} /><span className="num tiny">{rng ? `${Math.round(rng.hi)} m` : "—"}</span></div>
        <span className="tiny muted">{hf.display_pixel_m > 5000 ? `NASA MGS MOLA DEM, long-range overview grid (source ${Math.round(hf.source_pixel_m)} m)` : "NASA MGS MOLA 463 m DEM"} · ≈ {widthKm.toFixed(0)} km across · {hf.display_pixel_m > 5000 ? `${(hf.display_pixel_m / 1000).toFixed(1)} km` : `${hf.display_pixel_m.toFixed(0)} m`} cells · smoothed ×{Math.max(1, Math.min(6, Math.floor(720 / hf.cols)))} for display only; shading is a rendering, not data</span>
      </div>
    </div>
  );
}
