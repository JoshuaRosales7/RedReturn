import { greatCircleDistance, normalizeLon } from "./mars";
import type { Coverage, Point } from "./types";

/** Cached MOLA window that contains a coordinate (planetocentric lat, east-positive lon), or null. Pure geometry: says nothing about nodata cells. */
export function windowFor(p: Pick<Point, "lat" | "lon">, cover: Coverage[]): Coverage | null {
  if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) return null;
  const lon = normalizeLon(p.lon);
  return cover.find(c => p.lat >= c.bounds.lat_min && p.lat <= c.bounds.lat_max && lon >= c.bounds.lon_min && lon <= c.bounds.lon_max) ?? null;
}

export type RouteCoverage =
  | { ok: true; window: Coverage }
  | { ok: false; problem: "origin" | "destination" | "both" | "different" | "unknown"; origin: Coverage | null; destination: Coverage | null };

/** The planner needs base and target inside the same cached window; explain which condition fails. */
export function diagnoseCoverage(origin: Point, destination: Point, cover: Coverage[]): RouteCoverage {
  if (!cover.length) return { ok: false, problem: "unknown", origin: null, destination: null };
  const o = windowFor(origin, cover), d = windowFor(destination, cover);
  if (o && d && o.id === d.id) return { ok: true, window: o };
  return { ok: false, problem: !o && !d ? "both" : !o ? "origin" : !d ? "destination" : "different", origin: o, destination: d };
}

const deg = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? pos : neg}`;
/** Human-readable window extent, e.g. "14.38°N–22.38°N, 73.58°E–81.59°E". */
export const fmtBounds = (b: Coverage["bounds"]) => `${deg(b.lat_min, "N", "S")}–${deg(b.lat_max, "N", "S")}, ${deg(b.lon_min, "E", "W")}–${deg(b.lon_max, "E", "W")}`;

/** Same limit as the API (api/datasets/mola_remote.py MAX_SPAN_DEG): base and target within 3° of latitude and of longitude. */
export const MAX_ROUTE_SPAN_DEG = 3;

/** Largest of the latitude and longitude separations, in degrees (east-positive longitudes normalised to ±180, as the API does). */
export function routeSpanDeg(a: Pick<Point, "lat" | "lon">, b: Pick<Point, "lat" | "lon">): number {
  return Math.max(Math.abs(a.lat - b.lat), Math.abs(normalizeLon(a.lon) - normalizeLon(b.lon)));
}

export type Reach = { km: number; spanDeg: number; local: boolean };
/** Close enough for the detailed local analysis? (Farther apart = long-range overview route.) */
export function routeReach(a: Point, b: Point): Reach {
  const spanDeg = routeSpanDeg(a, b);
  return { km: greatCircleDistance(a, b), spanDeg, local: Number.isFinite(spanDeg) && spanDeg <= MAX_ROUTE_SPAN_DEG };
}

/** The local analysis area around a base: ±MAX_ROUTE_SPAN_DEG in latitude and longitude (the exact rule used by the API). */
export function localArea(base: Pick<Point, "lat" | "lon">) {
  const lon = normalizeLon(base.lon);
  return { lat_min: Math.max(-90, base.lat - MAX_ROUTE_SPAN_DEG), lat_max: Math.min(90, base.lat + MAX_ROUTE_SPAN_DEG), lon_min: lon - MAX_ROUTE_SPAN_DEG, lon_max: lon + MAX_ROUTE_SPAN_DEG };
}

/** Kilometres covered by the 3° rule at a latitude: north-south and east-west. */
export function localAreaKm(lat: number) {
  const kmPerDeg = 59.27;                                   // Mars, R = 3396.19 km
  return { ns: MAX_ROUTE_SPAN_DEG * kmPerDeg, ew: MAX_ROUTE_SPAN_DEG * kmPerDeg * Math.max(0.01, Math.cos((lat * Math.PI) / 180)) };
}

/** The target moved straight toward the base just enough to fall inside the local area (2% margin); unchanged if already inside. */
export function bringWithinLocal(base: Point, target: Point): Point {
  const dLat = target.lat - base.lat, dLon = normalizeLon(target.lon - base.lon);
  const span = Math.max(Math.abs(dLat), Math.abs(dLon));
  const limit = MAX_ROUTE_SPAN_DEG * 0.98;
  if (span <= limit) return target;
  const k = limit / span;
  return { lat: +(base.lat + dLat * k).toFixed(4), lon: +normalizeLon(base.lon + dLon * k).toFixed(4) };
}
