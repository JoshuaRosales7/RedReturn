"use client";
import { Crosshair, Maximize2, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { maxZoom, tileUrlZ, type LayerId } from "@/data/catalog";
import { greatCircleDistance, interpolateGreatCircle, normalizeLon } from "@/lib/mars";
import type { Coverage, Point } from "@/lib/types";
import { revealImg } from "./ui";

const MIN_Z = 1, MAX_Z = 8, KM_PER_DEG = 59.27;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export type MapFocus = { lat: number; lon: number; z?: number; key: number };

/**
 * Zoomable close-up map (NASA Mars Trek equirectangular tiles). Drag to pan, wheel / buttons / +− keys to zoom,
 * arrow keys to pan, click to place the selected point. Imagery only: nothing here is read back as elevation.
 */
export function RegionMap({ layer, origin, destination, coverage, onPick, focus, route, selection, localBox }: {
  layer: LayerId; origin: Point; destination: Point; coverage: Coverage[]; onPick: (p: Point) => void;
  focus: MapFocus | null; route?: { lat: number; lon: number }[]; selection: "origin" | "destination";
  /** Local analysis area around the base (targets inside get the detailed 463 m analysis). */
  localBox?: { lat_min: number; lat_max: number; lon_min: number; lon_max: number };
}) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(0); const H = Math.round(clamp(W * 0.62, 280, 420));
  const [center, setCenter] = useState<{ lat: number; lon: number }>(() => ({ lat: (origin.lat + destination.lat) / 2, lon: origin.lon + normalizeLon(destination.lon - origin.lon) / 2 }));
  const [z, setZ] = useState(6);
  const drag = useRef<{ x: number; y: number; c: { lat: number; lon: number }; moved: boolean } | null>(null);
  const [tileFail, setTileFail] = useState<{ key: string; n: number }>({ key: "", n: 0 });   // failed Trek tiles for the current layer/level

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(e => setW(Math.max(260, Math.round(e[0].contentRect.width)))); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ppd = (256 * 2 ** z) / 180;                                   // pixels per degree
  const halfLat = H / 2 / ppd;
  const cLat = halfLat >= 90 ? 0 : clamp(center.lat, -90 + halfLat, 90 - halfLat);
  const lonL = center.lon - W / 2 / ppd, latT = cLat + halfLat;
  const unwrap = (lon: number) => center.lon + normalizeLon(lon - center.lon);
  const px = (p: { lat: number; lon: number }) => [(unwrap(p.lon) - lonL) * ppd, (latT - p.lat) * ppd] as const;
  const geo = (x: number, y: number) => ({ lat: clamp(latT - y / ppd, -90, 90), lon: normalizeLon(lonL + x / ppd) });

  /** Fit both points (or centre on one) at the deepest zoom that shows them. */
  const fit = (a: Point = origin, b: Point = destination) => {
    const dLat = Math.abs(a.lat - b.lat), dLon = Math.abs(normalizeLon(a.lon - b.lon));
    let zz = MAX_Z;
    while (zz > MIN_Z && (dLon * (256 * 2 ** zz) / 180 > W * 0.7 || dLat * (256 * 2 ** zz) / 180 > H * 0.7)) zz--;
    setZ(clamp(zz, MIN_Z, 7)); setCenter({ lat: (a.lat + b.lat) / 2, lon: normalizeLon(a.lon + normalizeLon(b.lon - a.lon) / 2) });
  };
  const measured = W > 0;
  useEffect(() => { if (measured) fit(); }, [measured]); // eslint-disable-line react-hooks/exhaustive-deps -- once the real width is known
  // Base or target moved out of view (demo, catalog, typed coordinates): re-fit. Clicks inside the view keep the view.
  useEffect(() => {
    if (!measured) return;
    const inView = (p: Point) => { const [x, y] = px(p); return x >= 0 && x <= W && y >= 0 && y <= H; };
    if (!inView(origin) || !inView(destination)) fit();
  }, [origin.lat, origin.lon, destination.lat, destination.lon]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (focus) { setCenter({ lat: focus.lat, lon: focus.lon }); if (focus.z) setZ(focus.z); } }, [focus?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const zoomAt = (dz: number, x = W / 2, y = H / 2) => {
    const nz = clamp(z + dz, MIN_Z, MAX_Z); if (nz === z) return;
    const g = geo(x, y), k = 2 ** (z - nz);                            // keep the point under the cursor fixed
    setCenter({ lat: g.lat + (cLat - g.lat) * k, lon: normalizeLon(g.lon + normalizeLon(center.lon - g.lon) * k) }); setZ(nz);
  };
  useEffect(() => {
    const el = box.current; if (!el) return;
    const h = (e: WheelEvent) => { e.preventDefault(); const r = el.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top); };
    el.addEventListener("wheel", h, { passive: false }); return () => el.removeEventListener("wheel", h);
  });

  // Tiles: layers have a maximum level; deeper views scale the deepest tiles (display only).
  const tz = Math.min(z, maxZoom(layer)), tDeg = 180 / 2 ** tz, T = tDeg * ppd, nCols = 2 ** (tz + 1), nRows = 2 ** tz;
  const tiles = useMemo(() => {
    const out: { key: string; src: string; x: number; y: number }[] = [];
    const c0 = Math.floor((lonL + 180) / tDeg), c1 = Math.floor((lonL + W / ppd + 180) / tDeg);
    const r0 = Math.max(0, Math.floor((90 - latT) / tDeg)), r1 = Math.min(nRows - 1, Math.floor((90 - (latT - H / ppd)) / tDeg));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const cw = ((c % nCols) + nCols) % nCols;
      out.push({ key: `${tz}/${r}/${c}`, src: tileUrlZ(layer, tz, r, cw), x: (c * tDeg - 180 - lonL) * ppd, y: (latT - (90 - r * tDeg)) * ppd });
    }
    return out;
  }, [layer, tz, tDeg, lonL, latT, W, H, ppd, nCols, nRows]);

  const line = (pts: { lat: number; lon: number }[]) => pts.map((p, i) => { const [x, y] = px(p); return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`; }).join("");
  const gc = useMemo(() => interpolateGreatCircle(origin, destination, Math.min(256, Math.max(8, Math.round(greatCircleDistance(origin, destination) / 20)))), [origin, destination]);
  const scaleKm = (() => { const km = (100 / ppd) * KM_PER_DEG * Math.max(0.05, Math.cos((cLat * Math.PI) / 180)); const nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find(n => n >= km * 0.5) ?? km; return { km: nice, w: (nice / km) * 100 }; })();

  const down = (e: PointerEvent<HTMLDivElement>) => { if ((e.target as HTMLElement).closest("button")) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, c: { lat: cLat, lon: center.lon }, moved: false }; };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    d.moved = true; setCenter({ lat: clamp(d.c.lat + dy / ppd, -90, 90), lon: normalizeLon(d.c.lon - dx / ppd) });
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current; drag.current = null; if (!d || d.moved) return;
    const r = e.currentTarget.getBoundingClientRect(); const g = geo(e.clientX - r.left, e.clientY - r.top);
    onPick({ lat: +g.lat.toFixed(4), lon: +g.lon.toFixed(4) });
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = (W / 4) / ppd;
    const k: Record<string, () => void> = {
      ArrowLeft: () => setCenter(c => ({ ...c, lon: normalizeLon(c.lon - step) })), ArrowRight: () => setCenter(c => ({ ...c, lon: normalizeLon(c.lon + step) })),
      ArrowUp: () => setCenter(c => ({ ...c, lat: clamp(c.lat + step, -90, 90) })), ArrowDown: () => setCenter(c => ({ ...c, lat: clamp(c.lat - step, -90, 90) })),
      "+": () => zoomAt(1), "=": () => zoomAt(1), "-": () => zoomAt(-1),
    };
    if (k[e.key]) { e.preventDefault(); k[e.key](); }
  };
  const mark = (p: Point, color: string, label: string) => { const [x, y] = px(p); return <g key={label}><circle cx={x} cy={y} r={7} fill={color} stroke="#0a0d11" strokeWidth={2.5} /><text x={x + 11} y={y + 4} fill="#fff" fontSize={12} fontWeight={700} stroke="#000" strokeWidth={3.5} paintOrder="stroke">{label}</text></g>; };

  return (
    <div className="regionmap">
      <div ref={box} className="rm-stage" style={{ height: H }} tabIndex={0} role="application"
        aria-label={`Close-up map, about ${scaleKm.km} km per ${Math.round(scaleKm.w)} pixels. Drag or arrow keys to pan, plus and minus to zoom, click to place the ${selection === "origin" ? "base" : "target"}.`}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; }} onKeyDown={key}>
        {measured && tiles.map(t => <img key={t.key} src={t.src} alt="" draggable={false} className="rm-tile" style={{ left: t.x, top: t.y, width: T + 0.5, height: T + 0.5 }} ref={revealImg.ref} onLoad={revealImg.onLoad}
          onError={() => setTileFail(f => (f.key === `${layer}/${tz}` ? { key: f.key, n: f.n + 1 } : { key: `${layer}/${tz}`, n: 1 }))} />)}
        {tileFail.key === `${layer}/${tz}` && tileFail.n > 0 && <div className="rm-offline" role="status">NASA Trek imagery is not responding right now ({tileFail.n} tile{tileFail.n > 1 ? "s" : ""} failed). Clicks, coordinates, routes and the MOLA terrain analysis still work.</div>}
        {measured && <svg width={W} height={H} className="rm-overlay" aria-hidden>
          {coverage.map(c => { const [x0, y0] = px({ lat: c.bounds.lat_max, lon: c.bounds.lon_min }); const w = (c.bounds.lon_max - c.bounds.lon_min) * ppd, h = (c.bounds.lat_max - c.bounds.lat_min) * ppd; return <rect key={c.id} x={x0} y={y0} width={w} height={h} fill="rgba(98,184,164,.1)" stroke="#62b8a4" strokeWidth={1.5} strokeDasharray="5 4" />; })}
          {localBox && (() => { const [x0, y0] = px({ lat: localBox.lat_max, lon: localBox.lon_min }); const w = (localBox.lon_max - localBox.lon_min) * ppd, h = (localBox.lat_max - localBox.lat_min) * ppd; return <g>
            <rect x={x0} y={y0} width={w} height={h} fill="none" stroke="#fff" strokeOpacity={.85} strokeWidth={1.5} strokeDasharray="8 6" />
            <text x={Math.min(Math.max(x0 + 6, 6), W - 260)} y={Math.min(Math.max(y0 + 16, 16), H - 40)} fill="#fff" fontSize={11} fontWeight={600} stroke="#000" strokeWidth={3} paintOrder="stroke">Local analysis area (±3° around the base)</text>
          </g>; })()}
          <path d={line(gc)} fill="none" stroke="#0a0d11" strokeWidth={4} opacity={.5} />
          <path d={line(gc)} fill="none" stroke="#e8794a" strokeWidth={1.8} strokeDasharray={route ? "5 5" : undefined} />
          {route && route.length > 1 && <><path d={line(route)} fill="none" stroke="#0a0d11" strokeWidth={6} opacity={.55} strokeLinejoin="round" /><path d={line(route)} fill="none" stroke="#6fb7a7" strokeWidth={3} strokeLinejoin="round" /></>}
          {mark(origin, "#62b8a4", "BASE")}{mark(destination, "#e8794a", "TARGET")}
        </svg>}
        <div className="rm-controls">
          <button className="btn sm icon" onClick={() => zoomAt(1)} aria-label="Zoom in" title="Zoom in (+)" disabled={z >= MAX_Z}><Plus size={14} /></button>
          <button className="btn sm icon" onClick={() => zoomAt(-1)} aria-label="Zoom out" title="Zoom out (−)" disabled={z <= MIN_Z}><Minus size={14} /></button>
          <button className="btn sm icon" onClick={() => fit()} aria-label="Fit base and target" title="Fit base and target"><Maximize2 size={14} /></button>
          <button className="btn sm icon" onClick={() => { const p = selection === "origin" ? origin : destination; setCenter({ lat: p.lat, lon: p.lon }); setZ(zz => Math.max(zz, 6)); }} aria-label={`Centre on the ${selection === "origin" ? "base" : "target"}`} title={`Centre on the ${selection === "origin" ? "base" : "target"}`}><Crosshair size={14} /></button>
        </div>
        <div className="rm-scale" aria-hidden><i style={{ width: scaleKm.w }} /><span>{scaleKm.km.toLocaleString("en-US")} km</span></div>
        {z > maxZoom(layer) && <div className="rm-note" aria-hidden>Imagery magnified beyond its finest level</div>}
      </div>
      <div className="mapbar"><span className="tiny muted">Close-up · zoom {z} · click places the <b>{selection === "origin" ? "base" : "target"}</b> · drag to pan · NASA Mars Trek imagery (orientation only, never used as elevation){route ? " · green = planned route" : ""}{localBox ? " · dashed box = local analysis area" : ""}</span></div>
    </div>
  );
}
