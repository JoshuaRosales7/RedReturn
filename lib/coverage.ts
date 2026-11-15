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
