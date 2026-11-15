import { describe, expect, it } from "vitest";
import { daylightAround, hhmm, localTrueSolarTime, marsTime, seasonOf, solarElevation } from "../lib/marstime";

const angDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("Mars24 time (Allison & McEwen 2000)", () => {
  it("reproduces the published worked example (2000-01-06 00:00 UTC)", () => {
    const t = marsTime(new Date(Date.UTC(2000, 0, 6)));
    expect(t.ls).toBeCloseTo(277.18758, 1);                // paper: Ls = 277.18758°
    expect(t.msd).toBeCloseTo(44795.9998, 3);              // MSD ≈ 44795.9998 (TT-UTC differs by the leap seconds since 2000)
  });
  it.each([
    ["MY 36", Date.UTC(2021, 1, 7), 36],
    ["MY 37", Date.UTC(2022, 11, 26), 37],
    ["MY 38", Date.UTC(2024, 10, 12), 38],
  ])("%s starts near the northern spring equinox (Ls ≈ 0°)", (_, ms, my) => {
    const t = marsTime(new Date(ms));
    expect(angDiff(t.ls, 0)).toBeLessThan(1);             // Ls advances ~0.5°/day; the dates are calendar days
    expect(marsTime(new Date(ms + 3 * 86400000)).marsYear).toBe(my);
    expect(marsTime(new Date(ms - 3 * 86400000)).marsYear).toBe(my - 1);
  });
  it("a sol lasts 24 h 39 min 35 s in mean solar time", () => {
    const a = new Date(Date.UTC(2026, 10, 15)), b = new Date(a.getTime() + 88775244);
    expect(Math.abs(localTrueSolarTime(b, 77.58) - localTrueSolarTime(a, 77.58))).toBeLessThan(0.02);
  });
  it("local time advances one hour per 15° of east longitude", () => {
    const d = new Date(Date.UTC(2026, 10, 15, 12));
    expect(((localTrueSolarTime(d, 30) - localTrueSolarTime(d, 15) + 24) % 24)).toBeCloseTo(1, 9);
  });
});

describe("Sun position and daylight", () => {
  it("the Sun is highest near local noon and below the horizon near midnight", () => {
    const base = Date.UTC(2026, 10, 15);
    let best = { t: 0, el: -99 };
    for (let k = 0; k < 1480; k++) { const t = base + k * 60000; const el = solarElevation(new Date(t), 18.38, 77.58); if (el > best.el) best = { t, el }; }
    expect(Math.abs(localTrueSolarTime(new Date(best.t), 77.58) - 12)).toBeLessThan(0.05);
    const midnight = best.t + 12 * 3600000 * 1.0274912517;
    expect(solarElevation(new Date(midnight), 18.38, 77.58)).toBeLessThan(0);
  });
  it("finds a sunrise before and a sunset after local noon at the equator, ~12 h apart", () => {
    const base = Date.UTC(2026, 10, 15);
    let noon = base; for (let k = 0; k < 1480; k++) { const t = base + k * 60000; if (Math.abs(localTrueSolarTime(new Date(t), 0) - 12) < 0.02) { noon = t; break; } }
    const w = daylightAround(new Date(noon), 0, 0);
    expect(w.polar).toBeNull();
    expect(w.sunrise!.getTime()).toBeLessThan(noon);
    expect(w.sunset!.getTime()).toBeGreaterThan(noon);
    expect(w.daylightHours).toBeGreaterThan(11.5);
    expect(w.daylightHours).toBeLessThan(13.5);
    expect(Math.abs(solarElevation(w.sunrise!, 0, 0))).toBeLessThan(0.05);
  });
  it("reports polar day / night instead of inventing sunrise times", () => {
    // Northern summer solstice region (Ls ≈ 90°): polar day at 85°N, polar night at 85°S.
    let d = Date.UTC(2023, 6, 1); for (let k = 0; k < 800 && angDiff(marsTime(new Date(d)).ls, 90) > 0.6; k++) d += 86400000;
    expect(daylightAround(new Date(d), 85, 0).polar).toBe("day");
    expect(daylightAround(new Date(d), -85, 0).polar).toBe("night");
  });
  it("names the season by hemisphere and flags the dust-storm season", () => {
    expect(seasonOf(10, 18)).toEqual({ name: "spring (northern hemisphere)", dustSeason: false });
    expect(seasonOf(10, -5)).toEqual({ name: "autumn (southern hemisphere)", dustSeason: false });
    expect(seasonOf(250, 18).dustSeason).toBe(true);
  });
  it("formats hours", () => { expect(hhmm(13.5)).toBe("13:30"); expect(hhmm(23.999)).toBe("00:00"); });
});
