import { describe, expect, it } from "vitest";
import { buildLegs, compass, maxDistanceFromBase } from "../lib/fieldcard";
import type { Alternatives } from "../lib/types";
import snapshot from "../public/data/demo-snapshot.json";

const alt = snapshot.alternatives as unknown as Alternatives;
const route = alt.routes.find(r => r.strategy === alt.recommended)!;

describe("Field card legs", () => {
  const legs = buildLegs(route, 18);
  it("covers the whole route in order, without gaps", () => {
    expect(legs.length).toBeGreaterThan(3);
    expect(legs.length).toBeLessThanOrEqual(12);
    expect(legs[0].from).toEqual({ lat: route.coordinates[0].lat, lon: route.coordinates[0].lon });
    const last = route.coordinates[route.coordinates.length - 1];
    expect(legs[legs.length - 1].to).toEqual({ lat: last.lat, lon: last.lon });
    legs.slice(1).forEach((l, k) => expect(l.from).toEqual(legs[k].to));
    expect(legs[legs.length - 1].cumKm).toBeCloseTo(route.metrics.distance_km, 6);
    expect(legs.reduce((s, l) => s + l.km, 0)).toBeCloseTo(route.metrics.distance_km, 6);
  });
  it("arrives at the target after the modelled one-way travel time", () => expect(legs[legs.length - 1].elapsedH).toBeCloseTo(route.metrics.one_way_travel_hours, 6));
  it("spends oxygen at the mission's average rate", () => {
    const rate = route.mission.oxygen_used_kg / route.mission.duration_hours;
    expect(legs[0].o2LeftKg).toBeCloseTo(18 - rate * legs[0].elapsedH, 9);
    expect(legs[legs.length - 1].o2LeftKg).toBeLessThan(legs[0].o2LeftKg);
  });
  it("climbs equal the MOLA elevation difference between leg ends", () => {
    const sum = legs.reduce((s, l) => s + (l.climbM ?? 0), 0);
    const first = route.coordinates[0].elevation_m!, last = route.coordinates[route.coordinates.length - 1].elevation_m!;
    expect(sum).toBeCloseTo(last - first, 6);
  });
  it("names compass directions", () => { expect(compass(0)).toBe("N"); expect(compass(91)).toBe("E"); expect(compass(-45)).toBe("NW"); expect(compass(359)).toBe("N"); });
  it("measures the farthest point from base", () => expect(maxDistanceFromBase(route)).toBeGreaterThan(20));
  it("returns no legs for a degenerate route", () => expect(buildLegs({ ...route, coordinates: route.coordinates.slice(0, 1), profile: { ...route.profile, distance_km: [0] } }, 18)).toEqual([]));
});
