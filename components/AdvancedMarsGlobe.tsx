"use client";

import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { Line, OrbitControls, Stars } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, BackSide, CanvasTexture, Color, LinearMipmapLinearFilter, Quaternion, SRGBColorSpace, Vector3, type Texture } from "three";
import { CATALOG, maxZoom, tileUrlZ, type LayerId } from "@/data/catalog";
import { coordinateToVector, greatCircleDistance, interpolateGreatCircle, vectorToCoordinate, type Coordinate } from "@/lib/mars";
import type { Coverage } from "@/lib/types";

const ATMO_V = `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`;
const ATMO_F = `uniform vec3 glow; varying vec3 vN; varying vec3 vW; void main(){ vec3 v = normalize(cameraPosition - vW); float r = pow(max(0.0,0.72-dot(vN,v)),2.7); gl_FragColor = vec4(glow, smoothstep(0.0,0.85,r)*0.32); }`;

/**
 * Stitches NASA Mars Trek equirectangular tiles of one WMTS level into a single texture
 * (level z = 2^(z+1) × 2^z tiles of 256 px). Missing tiles stay dark; nothing is invented.
 */
async function stitch(layer: LayerId, z: number, signal: { cancelled: boolean }): Promise<HTMLCanvasElement | null> {
  const cols = 2 ** (z + 1), rows = 2 ** z;
  const canvas = document.createElement("canvas"); canvas.width = cols * 256; canvas.height = rows * 256;
  const ctx = canvas.getContext("2d"); if (!ctx) return null;
  ctx.fillStyle = "#1a1310"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const jobs: [number, number][] = []; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) jobs.push([r, c]);
  let ok = 0;
  const worker = async () => {
    while (jobs.length && !signal.cancelled) {
      const [r, c] = jobs.shift()!;
      await new Promise<void>(res => {
        const img = new Image(); img.crossOrigin = "anonymous"; img.decoding = "async";
        img.onload = () => { ctx.drawImage(img, c * 256, r * 256, 256, 256); ok++; res(); };
        img.onerror = () => res();
        img.src = tileUrlZ(layer, z, r, c);
      });
    }
  };
  await Promise.all(Array.from({ length: 12 }, worker));
  return signal.cancelled || ok === 0 ? null : canvas;
}

/** Progressive texture: a quick level first, then a sharper one (desktop only, within the GPU's texture limit). */
function useMarsTexture(layer: LayerId, small: boolean) {
  const { gl } = useThree();
  const [tex, setTex] = useState<{ t: Texture; z: number } | null>(null);
  useEffect(() => {
    const signal = { cancelled: false };
    const top = Math.min(maxZoom(layer), small ? 2 : 3, Math.floor(Math.log2(gl.capabilities.maxTextureSize / 512)));
    const levels = [...new Set([Math.min(1, top), Math.min(2, top), top])];
    let current: Texture | null = null;
    (async () => {
      for (const z of levels) {
        const canvas = await stitch(layer, z, signal);
        if (!canvas || signal.cancelled) continue;
        const t = new CanvasTexture(canvas);
        t.colorSpace = SRGBColorSpace; t.anisotropy = gl.capabilities.getMaxAnisotropy(); t.minFilter = LinearMipmapLinearFilter; t.generateMipmaps = true;
        current?.dispose(); current = t;
        setTex({ t, z });
      }
    })();
    // Release the GPU copy when the globe unmounts or the layer changes (~100 MB at 4096 px; three.js does not do it for us).
    return () => { signal.cancelled = true; current?.dispose(); current = null; };
  }, [layer, small, gl]);
  return tex;
}

function Beacon({ point, color }: { point: Coordinate; color: string }) {
  const pos = useMemo(() => new Vector3(...coordinateToVector(point, 2.005)), [point]);
  const q = useMemo(() => new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), pos.clone().normalize()), [pos]);
  return <group position={pos} quaternion={q}>
    <mesh position={[0, .1, 0]}><cylinderGeometry args={[.006, .014, .2, 8]} /><meshBasicMaterial color={color} /></mesh>
    <mesh position={[0, .21, 0]}><octahedronGeometry args={[.035, 0]} /><meshBasicMaterial color={color} /></mesh>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .002, 0]}><ringGeometry args={[.03, .045, 32]} /><meshBasicMaterial color={color} transparent opacity={.85} /></mesh>
  </group>;
}

function Planet({ layer, origin, destination, coverage, onPick, small, onLevel }: { layer: LayerId; origin: Coordinate; destination: Coordinate; coverage: Coverage[]; onPick: (p: Coordinate) => void; small: boolean; onLevel: (z: number) => void }) {
  const tex = useMarsTexture(layer, small);
  useEffect(() => { if (tex) onLevel(tex.z); }, [tex, onLevel]);
  const down = useRef<{ x: number; y: number } | null>(null);
  const pick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (down.current && Math.hypot(e.clientX - down.current.x, e.clientY - down.current.y) > 4) return;   // a drag to rotate is not a click
    const p = e.point.clone().applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);                     // undo the group rotation (-90° about Y)
    onPick(vectorToCoordinate(p.x, p.y, p.z));
  };
  const arc = useMemo(() => {
    const n = Math.min(160, Math.max(8, Math.round(greatCircleDistance(origin, destination) / 40)));
    return interpolateGreatCircle(origin, destination, n).map(p => coordinateToVector(p, 2.012));
  }, [origin, destination]);
  const boxes = useMemo(() => coverage.map(c => {
    const b = c.bounds, n = 12, pts: Coordinate[] = [];
    for (let i = 0; i <= n; i++) pts.push({ lat: b.lat_max, lon: b.lon_min + (b.lon_max - b.lon_min) * i / n });
    for (let i = 1; i <= n; i++) pts.push({ lat: b.lat_max - (b.lat_max - b.lat_min) * i / n, lon: b.lon_max });
    for (let i = 1; i <= n; i++) pts.push({ lat: b.lat_min, lon: b.lon_max - (b.lon_max - b.lon_min) * i / n });
    for (let i = 1; i <= n; i++) pts.push({ lat: b.lat_min + (b.lat_max - b.lat_min) * i / n, lon: b.lon_min });
    return { id: c.id, pts: pts.map(p => coordinateToVector(p, 2.006)) };
  }), [coverage]);
  return <group rotation={[0, -Math.PI / 2, 0]}>
    <mesh onPointerDown={e => { down.current = { x: e.clientX, y: e.clientY }; }} onClick={pick}>
      <sphereGeometry args={[2, small ? 128 : 192, small ? 96 : 128]} />
      {/* keyed: a new material per texture level, so the shader is compiled with the map (three.js does not recompile on prop change) */}
      {tex ? <meshStandardMaterial key={`map-${tex.z}`} map={tex.t} roughness={.95} metalness={0} /> : <meshStandardMaterial key="placeholder" color="#6b3a26" roughness={1} />}
    </mesh>
    <mesh scale={1.07} renderOrder={-1}><sphereGeometry args={[2, 64, 48]} /><shaderMaterial vertexShader={ATMO_V} fragmentShader={ATMO_F} uniforms={{ glow: { value: new Color("#c86f56") } }} side={BackSide} blending={AdditiveBlending} transparent depthWrite={false} /></mesh>
    {boxes.map(b => <Line key={b.id} points={b.pts} color="#62b8a4" lineWidth={1.5} transparent opacity={.85} />)}
    <Line points={arc} color="#0a0d11" lineWidth={5} transparent opacity={.55} />
    <Line points={arc} color="#e8794a" lineWidth={2.5} />
    {CATALOG.map(c => <mesh key={c.id} position={coordinateToVector(c, 2.004)}><sphereGeometry args={[.01, 8, 8]} /><meshBasicMaterial color="#e9d3b0" /></mesh>)}
    <Beacon point={origin} color="#62b8a4" /><Beacon point={destination} color="#e8794a" />
  </group>;
}

/** Smoothly flies the camera above a point when `focus` changes. */
function CameraRig({ focus, reduced }: { focus: Coordinate | null; reduced: boolean }) {
  const { camera } = useThree();
  const target = useRef<Vector3 | null>(null);
  useEffect(() => { if (!focus) return; const v = new Vector3(...coordinateToVector(focus, 1)).applyAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2); target.current = v.multiplyScalar(4.6); }, [focus]);
  useFrame((_, dt) => {
    if (!target.current) return;
    if (reduced) { camera.position.copy(target.current); target.current = null; return; }
    camera.position.lerp(target.current, 1 - Math.pow(0.002, dt));
    if (camera.position.distanceTo(target.current) < 0.02) target.current = null;
  });
  return null;
}

export default function AdvancedMarsGlobe({ layer, origin, destination, focus, onPick, coverage = [] }: { layer: LayerId; origin: Coordinate; destination: Coordinate; focus: Coordinate | null; onPick: (p: Coordinate) => void; coverage?: Coverage[] }) {
  const [key, setKey] = useState(0);
  const [lost, setLost] = useState(false);
  const [level, setLevel] = useState<number | null>(null);
  const [reduced, setReduced] = useState(false);
  const [small, setSmall] = useState(false);
  useEffect(() => { setReduced(window.matchMedia("(prefers-reduced-motion: reduce)").matches); setSmall(window.innerWidth < 760); }, []);
  // Create the WebGL scene only once the globe scrolls into view, and stop rendering while it is off-screen.
  const box = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false); const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const el = box.current; if (!el) return;
    const io = new IntersectionObserver(([e]) => { setVisible(e.isIntersecting); if (e.isIntersecting) setMounted(true); }, { rootMargin: "120px" });
    io.observe(el); return () => io.disconnect();
  }, []);
  const top = Math.min(maxZoom(layer), small ? 2 : 3);
  const px = level === null ? null : 2 ** (level + 1) * 256;
  return <div ref={box} className="globe" aria-label="Interactive 3D Mars globe. Drag to rotate, scroll to zoom, click the surface to set the selected point.">
    <div className="overlay"><span className="chip pin-base">Base</span><span className="chip pin-target">Target</span><span className="chip">Drag to rotate · click to place the selected point</span></div>
    {mounted && level === null && <div className="empty" style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }} role="status"><span className="spin" aria-hidden /><span className="small">Loading NASA Trek imagery…</span></div>}
    {level !== null && level < top && <div className="globe-hint" role="status"><span className="spin" aria-hidden />Loading sharper imagery…</div>}
    {px && <div className="globe-res" aria-hidden>{px.toLocaleString("en-US")} × {(px / 2).toLocaleString("en-US")} px texture · ≈ {Math.round(21344 / px)} km/px</div>}
    {lost && <div className="empty" style={{ position: "absolute", inset: 0, zIndex: 3, background: "rgba(7,9,12,.9)" }} role="alert"><b>Graphics context lost</b><button className="btn sm" onClick={() => { setLost(false); setKey(k => k + 1); }}>Restore 3D view</button></div>}
    {mounted && <Canvas key={key} flat frameloop={visible ? "always" : "never"} camera={{ position: [0, .25, 5.4], fov: 40, near: .05, far: 180 }} dpr={[1, small ? 1.5 : 2]} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onCreated={({ gl }) => {
        gl.domElement.addEventListener("webglcontextlost", e => { e.preventDefault(); setLost(true); });
        gl.domElement.addEventListener("webglcontextrestored", () => setLost(false));
      }}>
      <color attach="background" args={["#05070a"]} />
      <Stars radius={76} depth={44} count={small ? 600 : 1500} factor={1.6} saturation={0} fade speed={reduced ? 0 : .15} />
      <Planet layer={layer} origin={origin} destination={destination} coverage={coverage} onPick={onPick} small={small} onLevel={setLevel} />
      <directionalLight position={[5, 2.5, 4]} intensity={2.2} color="#fff1e6" /><ambientLight intensity={.55} color="#9aa3a8" />
      <CameraRig focus={focus} reduced={reduced} />
      <OrbitControls autoRotate={!reduced && !focus} autoRotateSpeed={.3} enablePan={false} minDistance={2.25} maxDistance={8.5} enableDamping dampingFactor={.06} rotateSpeed={.5} zoomSpeed={.7} />
    </Canvas>}
  </div>;
}
