import { DEFAULT_CONFIG, type MissionConfig } from "./mars";
import type { Point, Stop } from "./types";

/** Mission inputs that fit in a shareable link: points, science stops and the settings that differ from the defaults. */
export type SharedMission = { origin: Point; destination: Point; stops: Stop[]; config: Partial<MissionConfig> };

const n = (v: number, d = 5) => String(+v.toFixed(d));
const num = (s: string | undefined) => (s === undefined || s.trim() === "" ? NaN : Number(s));
const okLat = (v: number) => Number.isFinite(v) && v >= -90 && v <= 90;
const okLon = (v: number) => Number.isFinite(v) && v >= -180 && v <= 360;

/** Encode as a URL hash body, e.g. `b=18.38,77.58&t=18.6,77.2&s=18.5,77.38,0.75&c=crew:3`. */
export function encodeMission(m: SharedMission): string {
  const q = new URLSearchParams();
  q.set("b", `${n(m.origin.lat)},${n(m.origin.lon)}`);
  q.set("t", `${n(m.destination.lat)},${n(m.destination.lon)}`);
  if (m.stops.length) q.set("s", m.stops.map(s => `${n(s.lat)},${n(s.lon)},${n(s.dwell_hours, 3)}`).join(";"));
  const diff = (Object.keys(m.config) as (keyof MissionConfig)[]).filter(k => m.config[k] !== undefined && m.config[k] !== DEFAULT_CONFIG[k]);
  if (diff.length) q.set("c", diff.map(k => `${k}:${m.config[k] === true ? 1 : m.config[k] === false ? 0 : m.config[k]}`).join(","));
  return q.toString();
}

/** Decode a hash body; returns null for anything malformed or out of range (never partially applies bad input). */
export function decodeMission(hash: string): SharedMission | null {
  const q = new URLSearchParams(hash.replace(/^#/, ""));
  const pt = (k: string): Point | null => { const [a, b] = (q.get(k) ?? "").split(",").map(num); return okLat(a) && okLon(b) ? { lat: a, lon: b } : null; };
  const origin = pt("b"), destination = pt("t");
  if (!origin || !destination) return null;
  const stops: Stop[] = [];
  for (const raw of (q.get("s") ?? "").split(";").filter(Boolean).slice(0, 5)) {
    const [lat, lon, dwell] = raw.split(",").map(num);
    if (!okLat(lat) || !okLon(lon) || !Number.isFinite(dwell) || dwell < 0 || dwell > 100) return null;
    stops.push({ name: `Stop ${stops.length + 1}`, lat, lon, dwell_hours: dwell, weight: 1 });
  }
  const config: Partial<MissionConfig> = {};
  for (const pair of (q.get("c") ?? "").split(",").filter(Boolean)) {
    const [k, v] = pair.split(":") as [keyof MissionConfig, string];
    if (!Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, k)) return null;   // own keys only: "__proto__" & co. are rejected
    const d = DEFAULT_CONFIG[k];
    const val = typeof d === "boolean" ? v === "1" : num(v);
    if (typeof val === "number" && !Number.isFinite(val)) return null;
    (config as Record<string, number | boolean>)[k] = val;
  }
  return { origin: { ...origin, name: "Shared base" }, destination: { ...destination, name: "Shared target" }, stops, config };
}
