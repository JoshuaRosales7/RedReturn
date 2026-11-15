"use client";
import { Canvas } from "@react-three/fiber";
import { Line, OrbitControls } from "@react-three/drei";
import { useMemo, useRef, useState, type ComponentRef, type KeyboardEvent } from "react";
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { BufferAttribute, BufferGeometry, Color, PlaneGeometry, SRGBColorSpace } from "three";
import type { Heightfield, Point, RouteAlt } from "@/lib/types";
import { STRATEGY_COLOR } from "@/lib/format";
import { elevationRange, reliefColor, RELIEF_GRADIENT } from "@/lib/relief";

const SIZE = 10, FLOOR = -0.45, KM_PER_DEG = 59.274;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const srgb = (c: [number, number, number]) => new Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, SRGBColorSpace);   // vertex colours are linear: convert, otherwise the ramp looks washed out

export default function TerrainMesh3D({ hf, routes, show, origin, destination, showSlope, maxSlope }: { hf: Heightfield; routes: Pick<RouteAlt, "strategy" | "coordinates">[]; show: string[]; origin: Point; destination: Point; showSlope: boolean; maxSlope: number }) {
  const base = useMemo(() => {
    const { bounds: b } = hf; const rng = elevationRange(hf.elevation_m) ?? { lo: 0, hi: 1 };
    const widthM = (b.lon_max - b.lon_min) * Math.cos(((b.lat_max + b.lat_min) / 2) * Math.PI / 180) * KM_PER_DEG * 1000, heightM = (b.lat_max - b.lat_min) * KM_PER_DEG * 1000;
    const unit = SIZE / widthM;                                                  // world units per metre (horizontal)
    const auto = clamp(Math.round((1.3 / Math.max(1e-6, (rng.hi - rng.lo) * unit)) * 2) / 2, 1, 15);   // relief ≈ 1.3 world units tall
    return { b, ...rng, unit, sx: SIZE, sz: SIZE * (heightM / widthM), auto };
  }, [hf]);
  const [exagUser, setExag] = useState<number | null>(null);
  const [view, setView] = useState(0);
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  /** Keyboard / button camera moves (orbit around the target, zoom within the same limits as the mouse). */
  const orbit = (yawDeg: number, zoom = 1, pitchDeg = 0) => {
    const c = controls.current; if (!c) return;
    const cam = c.object, t = c.target, off = cam.position.clone().sub(t);
    off.applyAxisAngle(cam.up, (yawDeg * Math.PI) / 180);
    const r = clamp(off.length() * zoom, 3, 24), pol = clamp(Math.acos(clamp(off.y / off.length(), -1, 1)) - (pitchDeg * Math.PI) / 180, 0.15, Math.PI / 2.05);
    const az = Math.atan2(off.x, off.z);
    cam.position.set(t.x + r * Math.sin(pol) * Math.sin(az), t.y + r * Math.cos(pol), t.z + r * Math.sin(pol) * Math.cos(az));
    cam.lookAt(t); c.update();
  };
  const onKey = (e: KeyboardEvent) => {
    const k: Record<string, () => void> = { ArrowLeft: () => orbit(-15), ArrowRight: () => orbit(15), ArrowUp: () => orbit(0, 1, 8), ArrowDown: () => orbit(0, 1, -8), "+": () => orbit(0, 0.85), "=": () => orbit(0, 0.85), "-": () => orbit(0, 1.18) };
    if (k[e.key]) { e.preventDefault(); e.stopPropagation(); k[e.key](); }
  };
  const exag = exagUser ?? base.auto;
  const { b, lo, hi, unit, sx, sz } = base;

  const geo = useMemo(() => {
    const { rows, cols, elevation_m: z, slope_deg: sl } = hf;
    const g = new PlaneGeometry(sx, sz, cols - 1, rows - 1); g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as BufferAttribute, col = new Float32Array(rows * cols * 3), span = Math.max(1, hi - lo);
    for (let i = 0; i < rows * cols; i++) {
      const v = z[i]; pos.setY(i, ((v ?? lo) - lo) * unit * exag);
      const s = sl[i]; const c = v === null ? new Color(1, 0, 1) : showSlope && s !== null && s > maxSlope ? srgb([226, 70, 62]) : srgb(reliefColor((v - lo) / span));
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute("color", new BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
  }, [hf, sx, sz, lo, hi, unit, exag, showSlope, maxSlope]);

  // Side walls so the block reads as a solid slab instead of a floating sheet.
  const skirt = useMemo(() => {
    const { rows, cols } = hf, pos = geo.attributes.position as BufferAttribute;
    const ring: number[] = []; for (let c = 0; c < cols; c++) ring.push(c); for (let r = 1; r < rows; r++) ring.push(r * cols + cols - 1);
    for (let c = cols - 2; c >= 0; c--) ring.push((rows - 1) * cols + c); for (let r = rows - 2; r > 0; r--) ring.push(r * cols);
    ring.push(ring[0]);
    const p: number[] = [], idx: number[] = [];
    ring.forEach((vi, k) => { const x = pos.getX(vi), y = pos.getY(vi), zz = pos.getZ(vi); p.push(x, y, zz, x, FLOOR, zz); if (k) { const a = (k - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const s = new BufferGeometry(); s.setAttribute("position", new BufferAttribute(new Float32Array(p), 3)); s.setIndex(idx); s.computeVertexNormals(); return s;
  }, [geo, hf]);

  const to = (lat: number, lon: number, e: number | null): [number, number, number] => [((lon - b.lon_min) / (b.lon_max - b.lon_min) - .5) * sx, ((e ?? lo) - lo) * unit * exag + .05, ((b.lat_max - lat) / (b.lat_max - b.lat_min) - .5) * sz];
  const elevAt = (p: Point) => { const c = clamp(Math.round(((p.lon - b.lon_min) / (b.lon_max - b.lon_min)) * (hf.cols - 1)), 0, hf.cols - 1), r = clamp(Math.round(((b.lat_max - p.lat) / (b.lat_max - b.lat_min)) * (hf.rows - 1)), 0, hf.rows - 1); return hf.elevation_m[r * hf.cols + c]; };
  const visible = routes.filter(r => show.includes(r.strategy));
  const pin = (p: Point, color: string, key: string) => { const [x, y, z] = to(p.lat, p.lon, elevAt(p)); return <group key={key} position={[x, y, z]}><mesh position={[0, .35, 0]}><cylinderGeometry args={[.025, .025, .7, 8]} /><meshBasicMaterial color={color} /></mesh><mesh position={[0, .75, 0]}><sphereGeometry args={[.11, 16, 12]} /><meshBasicMaterial color={color} /></mesh></group>; };
  return (
    <div className="mapwrap mesh">
      <div className="mesh-stage" tabIndex={0} role="application" aria-label="3D terrain view. Arrow keys rotate and tilt, plus and minus zoom." onKeyDown={onKey}><Canvas key={view} camera={{ position: [0, sz * 0.5 + 2.6, sz * 0.62 + 5.4], fov: 38, near: .1, far: 120 }} dpr={[1, 1.5]} gl={{ antialias: true }} aria-label="3D terrain from MOLA elevations">
        <color attach="background" args={["#07090c"]} />
        <hemisphereLight args={["#d9e2ff", "#40322a", 0.9]} />
        <directionalLight position={[-6, 7, 5]} intensity={2.1} />
        <mesh geometry={geo}><meshStandardMaterial vertexColors roughness={1} metalness={0} /></mesh>
        <mesh geometry={skirt}><meshStandardMaterial color="#1b2430" roughness={1} side={2} /></mesh>
        <gridHelper args={[SIZE * 1.5, 15, "#2a394b", "#1b2531"]} position={[0, FLOOR - .01, 0]} />
        {visible.map(r => { const pts = r.coordinates.map(c => to(c.lat, c.lon, c.elevation_m)); return <group key={r.strategy}>
          <Line points={pts} color="#05070a" lineWidth={6} depthTest={false} renderOrder={5} />
          <Line points={pts} color={STRATEGY_COLOR[r.strategy]} lineWidth={3} depthTest={false} renderOrder={6} dashed={r.strategy === "shortest"} dashSize={.18} gapSize={.1} />
        </group>; })}
        {pin(origin, "#62b8a4", "base")}{pin(destination, "#e8794a", "target")}
        <OrbitControls ref={controls} target={[0, .2, 0]} enableDamping dampingFactor={.08} minDistance={3} maxDistance={24} maxPolarAngle={Math.PI / 2.05} />
      </Canvas></div>
      <div className="mesh-hud">
        <span className="chip pin-base">Base</span><span className="chip pin-target">Target</span>
        <label className="range"><span>Vertical exaggeration<b>{exag}×</b></span><input type="range" min={1} max={15} step={0.5} value={exag} onChange={e => setExag(Number(e.target.value))} aria-label="Vertical exaggeration" /></label>
        <div className="row" style={{ gap: 4, flexWrap: "nowrap" }} role="group" aria-label="Camera">
          <button className="btn sm icon" onClick={() => orbit(-20)} aria-label="Rotate left" title="Rotate left (←)"><RotateCcw size={14} /></button>
          <button className="btn sm icon" onClick={() => orbit(20)} aria-label="Rotate right" title="Rotate right (→)"><RotateCw size={14} /></button>
          <button className="btn sm icon" onClick={() => orbit(0, 0.85)} aria-label="Zoom in" title="Zoom in (+)"><ZoomIn size={14} /></button>
          <button className="btn sm icon" onClick={() => orbit(0, 1.18)} aria-label="Zoom out" title="Zoom out (−)"><ZoomOut size={14} /></button>
        </div>
        <button className="btn sm" onClick={() => { setExag(null); setView(v => v + 1); }} title="Restore the default camera and automatic exaggeration">Reset view</button>
      </div>
      <div className="mapbar">
        <div className="cbar"><span className="num tiny">{Math.round(lo)} m</span><i style={{ background: RELIEF_GRADIENT }} /><span className="num tiny">{Math.round(hi)} m</span></div>
        <span className="tiny muted">3D render of MOLA 463 m elevations · drag or arrow keys to orbit, scroll or +/− to zoom · {exag}× vertical exaggeration (picture only){showSlope ? ` · red = slope > ${maxSlope}°` : ""}{hf.elevation_m.some(v => v === null) ? " · magenta = no data (drawn at the window minimum, not measured)" : ""}</span>
      </div>
    </div>
  );
}
