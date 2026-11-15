import { describe, expect, it } from "vitest";
import { estimateLongRoute, SOL_HOURS } from "../lib/longrange";
import { DEFAULT_CONFIG, G_MARS } from "../lib/mars";
import type { LongRoute } from "../lib/types";

const route = { summary: { one_way_km: 1000, effective_km: 1100, ascent_out_m: 2000, ascent_back_m: 1500 } } as LongRoute;

describe("Long-range logistics estimate", () => {
  it("drives the slope-derated distance both ways at the configured speed", () => {
    const e = estimateLongRoute(route, DEFAULT_CONFIG, 6);
    expect(e.legs).toBe(2);
    expect(e.drivingHours).toBeCloseTo((1100 / DEFAULT_CONFIG.speedKmh) * 2, 9);
    expect(e.sols).toBe(Math.ceil(e.drivingHours / 6));
  });
  it("charges crew oxygen per hour and water per sol for every sol of the trip", () => {
    const e = estimateLongRoute(route, DEFAULT_CONFIG, 6);
    expect(e.oxygenKg).toBeCloseTo(DEFAULT_CONFIG.crew * DEFAULT_CONFIG.oxygenKgPerPersonHour * SOL_HOURS * e.sols, 9);
    expect(e.waterL).toBeCloseTo(DEFAULT_CONFIG.crew * DEFAULT_CONFIG.waterLitersPerPersonDay * e.sols, 9);
    expect(e.oxygenLoads).toBeCloseTo(e.oxygenKg / DEFAULT_CONFIG.oxygenKg, 9);
  });
  it("adds climb energy for both ascents to base power while driving", () => {
    const e = estimateLongRoute(route, DEFAULT_CONFIG, 6);
    const climb = DEFAULT_CONFIG.roverMassKg * G_MARS * 3500 / DEFAULT_CONFIG.drivetrainEfficiency / 3.6e6;
    expect(e.energyKwh).toBeCloseTo(DEFAULT_CONFIG.energyKwhPerHour * e.drivingHours + climb, 9);
  });
  it("one-way trips halve the driving and skip the return climb", () => {
    const one = estimateLongRoute(route, { ...DEFAULT_CONFIG, returnRequired: false }, 6);
    expect(one.legs).toBe(1);
    expect(one.drivingHours).toBeCloseTo(1100 / DEFAULT_CONFIG.speedKmh, 9);
  });
  it("longer driving days mean fewer sols", () => expect(estimateLongRoute(route, DEFAULT_CONFIG, 12).sols).toBeLessThan(estimateLongRoute(route, DEFAULT_CONFIG, 4).sols));
  it("zero supplies give an infinite ratio instead of dividing by zero silently", () => expect(estimateLongRoute(route, { ...DEFAULT_CONFIG, oxygenKg: 0 }, 6).oxygenLoads).toBe(Infinity));
});
