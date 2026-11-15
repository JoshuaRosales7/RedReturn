import { G_MARS, type MissionConfig } from "./mars";
import type { LongRoute } from "./types";

/** Mean solar day on Mars (sol), hours. */
export const SOL_HOURS = 24.66;
const J_PER_KWH = 3.6e6;

export type LongEstimate = {
  drivingHours: number; sols: number; oxygenKg: number; waterL: number; energyKwh: number;
  oxygenLoads: number; waterLoads: number; batteryCharges: number; legs: 1 | 2;
};

/**
 * Order-of-magnitude logistics for a long route (class C: assumptions only).
 * Driving time uses the slope-derated distance at the configured speed; the crew lives aboard for every sol of the trip
 * (oxygen per hour, water per day ≈ per sol); energy = base power while driving + climb energy. Recharging, night-time loads,
 * rest days and resupply are NOT modelled — the "loads"/"charges" show how far the trip is from what the rover carries.
 */
export function estimateLongRoute(r: LongRoute, c: MissionConfig, drivingHoursPerSol: number): LongEstimate {
  const legs = c.returnRequired ? 2 : 1;
  const drivingHours = (r.summary.effective_km / c.speedKmh) * legs;
  const sols = Math.ceil(drivingHours / Math.max(0.5, drivingHoursPerSol));
  const oxygenKg = c.crew * c.oxygenKgPerPersonHour * SOL_HOURS * sols;
  const waterL = c.crew * c.waterLitersPerPersonDay * sols;
  const ascent = r.summary.ascent_out_m + (c.returnRequired ? r.summary.ascent_back_m : 0);
  const climbKwh = (c.roverMassKg * G_MARS * ascent) / Math.max(0.05, c.drivetrainEfficiency) / J_PER_KWH;
  const energyKwh = c.energyKwhPerHour * drivingHours + climbKwh;
  const ratio = (need: number, have: number) => (have > 0 ? need / have : Infinity);
  return { drivingHours, sols, oxygenKg, waterL, energyKwh, legs,
    oxygenLoads: ratio(oxygenKg, c.oxygenKg), waterLoads: ratio(waterL, c.waterLiters), batteryCharges: ratio(energyKwh, c.energyKwh) };
}
