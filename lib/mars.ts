/** Mars 2000 sphere used by the MOLA MEGDR grids (same constant as api/scientific/geodesy.py). */
export const MARS_RADIUS_KM = 3396.19;

export type Coordinate = { lat: number; lon: number; name?: string };
export type Strategy = "direct" | "conservative" | "science" | "limited";
export type RouteStrategy = "shortest" | "terrain" | "resource" | "science";
export type MissionConfig = {
  crew: number; speedKmh: number; oxygenKg: number; oxygenKgPerPersonHour: number;
  energyKwh: number; energyKwhPerHour: number; reservePercent: number;
  waterLiters: number; waterLitersPerPersonDay: number;
  radiationMsvPerHour: number; maxRadiationMsv: number;
  maxHours: number; scienceHours: number; contingencyPercent: number; returnRequired: boolean;
  maxSlopeDeg: number; roverMassKg: number; drivetrainEfficiency: number;
};

const rad = (value: number) => value * Math.PI / 180;
const deg = (value: number) => value * 180 / Math.PI;
export const normalizeLon = (lon: number) => ((lon + 540) % 360) - 180;

export function greatCircleDistance(a: Coordinate, b: Coordinate): number {
  const p1 = rad(a.lat), p2 = rad(b.lat), dp = rad(b.lat - a.lat), dl = rad(normalizeLon(b.lon - a.lon));
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * MARS_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function interpolateGreatCircle(a: Coordinate, b: Coordinate, steps = 64): Coordinate[] {
  const p1 = rad(a.lat), l1 = rad(a.lon), p2 = rad(b.lat), l2 = rad(b.lon);
  const angular = greatCircleDistance(a, b) / MARS_RADIUS_KM;
  if (angular < 1e-9) return [a, b];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const f = i / steps;
    const A = Math.sin((1 - f) * angular) / Math.sin(angular);
    const B = Math.sin(f * angular) / Math.sin(angular);
    const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
    const y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
    const z = A * Math.sin(p1) + B * Math.sin(p2);
    return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: normalizeLon(deg(Math.atan2(y, x))) };
  });
}

export function routeDistance(points: Coordinate[]) {
  return points.slice(1).reduce((sum, p, i) => sum + greatCircleDistance(points[i], p), 0);
}

export function initialBearing(a: Coordinate, b: Coordinate): number {
  const p1 = rad(a.lat), p2 = rad(b.lat), dl = rad(normalizeLon(b.lon - a.lon));
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export type RouteSummary = { oneWayKm: number; effectiveKm: number; ascentOutM: number; ascentBackM: number; terrainEvaluated: boolean };
export const G_MARS = 3.71;
export const flatSummary = (oneWayKm: number): RouteSummary => ({ oneWayKm, effectiveKm: oneWayKm, ascentOutM: 0, ascentBackM: 0, terrainEvaluated: false });

/** Mirror of api/scientific/mission.py::project_mission for a full mission from base. Verified by tests/parity.test.ts. */
export function evaluateSummary(route: RouteSummary, config: MissionConfig) {
  const legs = config.returnRequired ? 2 : 1;
  const distanceKm = route.oneWayKm * legs;
  const travelHours = route.effectiveKm * legs / Math.max(0.1, config.speedKmh);
  const durationHours = travelHours + config.scienceHours;
  const factor = 1 + config.contingencyPercent / 100;
  const ascentM = route.ascentOutM + (config.returnRequired ? route.ascentBackM : 0);
  const climbKwh = config.roverMassKg * G_MARS * ascentM / Math.max(config.drivetrainEfficiency, 1e-3) / 3.6e6;
  const oxygenUsedKg = durationHours * config.crew * config.oxygenKgPerPersonHour * factor;
  const energyUsedKwh = (durationHours * config.energyKwhPerHour + climbKwh) * factor;
  const waterUsedLiters = durationHours / 24 * config.crew * config.waterLitersPerPersonDay * factor;
  const radiationMsv = durationHours * config.radiationMsvPerHour;
  const oxygenRemaining = config.oxygenKg - oxygenUsedKg;
  const energyRemaining = config.energyKwh - energyUsedKwh;
  const waterRemaining = config.waterLiters - waterUsedLiters;
  const reserve = config.reservePercent / 100;
  const norm = (rem: number, cap: number) => cap > 0 ? (rem - cap * reserve) / cap : -1;
  const margins = {
    oxygen: norm(oxygenRemaining, config.oxygenKg), energy: norm(energyRemaining, config.energyKwh), water: norm(waterRemaining, config.waterLiters),
    time: (config.maxHours - durationHours) / config.maxHours, radiation: (config.maxRadiationMsv - radiationMsv) / config.maxRadiationMsv,
  };
  const constraints = {
    oxygen: oxygenRemaining >= config.oxygenKg * reserve, energy: energyRemaining >= config.energyKwh * reserve,
    water: waterRemaining >= config.waterLiters * reserve, radiation: radiationMsv <= config.maxRadiationMsv, time: durationHours <= config.maxHours,
  };
  const limitingFactor = (Object.keys(margins) as (keyof typeof margins)[]).reduce((a, b) => margins[b] < margins[a] ? b : a);
  const feasible = Object.values(constraints).every(Boolean);
  return { distanceKm, travelHours, durationHours, oxygenUsedKg, energyUsedKwh, waterUsedLiters, radiationMsv, oxygenRemaining, energyRemaining, waterRemaining,
    margins, constraints, limitingFactor, limitingMarginPercent: margins[limitingFactor] * 100, feasible };
}

/** Flat (terrain-unaware) estimate used for instant slider feedback; terrain-aware results come from the API. */
export function evaluateMission(oneWay: Coordinate[], config: MissionConfig) {
  const r = evaluateSummary(flatSummary(routeDistance(oneWay)), config);
  return { ...r, oneWayKm: routeDistance(oneWay), constraintsOk: r.constraints };
}

export function coordinateToVector(point: Coordinate, radius = 2.02): [number, number, number] {
  const phi = rad(90 - point.lat), theta = rad(point.lon + 180);
  return [-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta)];
}

/** Inverse of coordinateToVector (any radius): globe-local point → planetocentric lat, east-positive lon. */
export function vectorToCoordinate(x: number, y: number, z: number): Coordinate {
  const r = Math.hypot(x, y, z) || 1;
  return { lat: 90 - deg(Math.acos(Math.max(-1, Math.min(1, y / r)))), lon: normalizeLon(deg(Math.atan2(z, -x)) - 180) };
}

export const DEFAULT_CONFIG: MissionConfig = {
  crew: 2, speedKmh: 4.5, oxygenKg: 18, oxygenKgPerPersonHour: 0.084,
  energyKwh: 45, energyKwhPerHour: 1.2, waterLiters: 12, waterLitersPerPersonDay: 2.5,
  radiationMsvPerHour: 0.025, maxRadiationMsv: 1, reservePercent: 20,
  maxHours: 18, scienceHours: 1.5, contingencyPercent: 15, returnRequired: true,
  maxSlopeDeg: 15, roverMassKg: 1500, drivetrainEfficiency: 0.6,
};
