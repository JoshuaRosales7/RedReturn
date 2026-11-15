import { greatCircleDistance, initialBearing } from "./mars";
import type { RouteAlt } from "./types";

export type Leg = {
  n: number; from: { lat: number; lon: number }; to: { lat: number; lon: number };
  km: number; cumKm: number; bearing: number; compass: string;
  climbM: number | null; maxSlopeDeg: number | null;
  /** Elapsed hours from departure when this leg ends (model: slope-derated travel time spread along the route). */
  elapsedH: number;
  /** Oxygen left aboard at the end of the leg, kg (model: mission use spread linearly over the mission time). */
  o2LeftKg: number;
};

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (bearing: number) => POINTS[Math.round((((bearing % 360) + 360) % 360) / 22.5) % 16];

/**
 * Outbound legs of a planned route for a field card. Every number derives from the route geometry, the MOLA profile and
 * the mission model already computed by the API — nothing new is assumed except how the totals are spread along the way.
 */
export function buildLegs(route: Pick<RouteAlt, "coordinates" | "profile" | "metrics" | "mission">, oxygenLoadedKg: number, opts: { legKm?: number; maxLegs?: number } = {}): Leg[] {
  const pts = route.coordinates, dist = route.profile.distance_km, slope = route.profile.slope_deg;
  if (pts.length < 2 || dist.length !== pts.length) return [];
  const total = dist[dist.length - 1] || 0;
  if (total <= 0) return [];
  const target = Math.max(opts.legKm ?? 2, total / (opts.maxLegs ?? 12));
  const hoursPerKm = route.metrics.one_way_travel_hours / total;
  const o2PerHour = route.mission.duration_hours > 0 ? route.mission.oxygen_used_kg / route.mission.duration_hours : 0;
  const legs: Leg[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = i + 1;
    while (j < pts.length - 1 && dist[j] - dist[i] < target) j++;
    if (pts.length - 1 - j > 0 && dist[dist.length - 1] - dist[j] < target * 0.35) j = pts.length - 1;   // no tiny last leg
    const a = pts[i], b = pts[j];
    let maxS: number | null = null;
    for (let k = i + 1; k <= j; k++) { const v = slope[k]; if (v !== null && v !== undefined && (maxS === null || v > maxS)) maxS = v; }
    const elapsedH = dist[j] * hoursPerKm;
    legs.push({
      n: legs.length + 1, from: { lat: a.lat, lon: a.lon }, to: { lat: b.lat, lon: b.lon },
      km: dist[j] - dist[i], cumKm: dist[j], bearing: initialBearing(a, b), compass: compass(initialBearing(a, b)),
      climbM: a.elevation_m !== null && b.elevation_m !== null ? b.elevation_m - a.elevation_m : null, maxSlopeDeg: maxS,
      elapsedH, o2LeftKg: oxygenLoadedKg - o2PerHour * elapsedH,
    });
    i = j;
  }
  return legs;
}

/** Largest straight-line distance from the base reached along the route (how far a walk back could be). */
export function maxDistanceFromBase(route: Pick<RouteAlt, "coordinates">): number {
  const base = route.coordinates[0];
  return route.coordinates.reduce((m, p) => Math.max(m, greatCircleDistance(base, p)), 0);
}
