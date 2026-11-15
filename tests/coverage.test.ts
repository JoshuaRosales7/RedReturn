import { describe, expect, it } from "vitest";
import { diagnoseCoverage, fmtBounds, routeReach, routeSpanDeg, windowFor } from "../lib/coverage";
import { toErr, workingStrategy } from "../lib/store";
import { ApiFailure } from "../lib/api";
import type { Alternatives, Coverage } from "../lib/types";
import snapshot from "../public/data/demo-snapshot.json";
import demo from "../api/data/demo_scenario.json";

const cover = snapshot.coverage.items as Coverage[];
const jezero = { lat: 18.38, lon: 77.58 }, gale = { lat: -4.59, lon: 137.44 }, nowhere = { lat: 0, lon: 0 };

describe("DEM coverage diagnosis", () => {
  it("finds the window containing a point", () => {
    expect(windowFor(jezero, cover)?.id).toBe("jezero");
    expect(windowFor(gale, cover)?.id).toBe("gale");
    expect(windowFor(nowhere, cover)).toBeNull();
  });
  it("normalises east longitudes above 180 before testing", () => expect(windowFor({ lat: -4.59, lon: 137.44 + 360 }, cover)?.id).toBe("gale"));
  it("rejects non-finite coordinates", () => expect(windowFor({ lat: NaN, lon: 77 }, cover)).toBeNull());
  it("accepts the demo route", () => {
    const d = diagnoseCoverage(demo.origin, demo.destination, cover);
    expect(d.ok && d.window.id).toBe("jezero");
  });
  it("names which endpoint is outside", () => {
    expect(diagnoseCoverage(nowhere, jezero, cover)).toMatchObject({ ok: false, problem: "origin" });
    expect(diagnoseCoverage(jezero, nowhere, cover)).toMatchObject({ ok: false, problem: "destination" });
    expect(diagnoseCoverage(nowhere, nowhere, cover)).toMatchObject({ ok: false, problem: "both" });
  });
  it("flags base and target in different windows", () => expect(diagnoseCoverage(jezero, gale, cover)).toMatchObject({ ok: false, problem: "different" }));
  it("reports unknown coverage instead of guessing", () => expect(diagnoseCoverage(jezero, jezero, [])).toMatchObject({ ok: false, problem: "unknown" }));
  it("formats bounds with hemispheres", () => expect(fmtBounds(cover.find(c => c.id === "gale")!.bounds)).toBe("9.41°S–1.40°S, 133.80°E–141.81°E"));
});

describe("Working route and error mapping", () => {
  const alt = snapshot.alternatives as unknown as Alternatives;
  it("follows the recommendation by default", () => expect(workingStrategy({ strategy: null, alternatives: alt })).toBe(alt.recommended));
  it("uses the user's pick when that route exists", () => expect(workingStrategy({ strategy: "shortest", alternatives: alt })).toBe("shortest"));
  it("falls back to the recommendation when the pick is not in the plan", () => expect(workingStrategy({ strategy: "science", alternatives: { ...alt, routes: alt.routes.filter(r => r.strategy !== "science") } })).toBe(alt.recommended));
  it("keeps the API error code so the UI never has to parse messages", () => {
    const e = toErr(new ApiFailure("outside_dem_coverage", "Origin and destination must both lie inside one cached MOLA window.", 422));
    expect(e).toMatchObject({ code: "outside_dem_coverage", offline: false });
    expect(toErr(new ApiFailure("network", "The API is unreachable."))).toMatchObject({ code: "network", offline: true, message: "API offline" });
  });
});

describe("Route reach (base–target distance limit)", () => {
  it("accepts the demo route and rejects Jezero → Olympus Mons", () => {
    expect(routeReach(demo.origin, demo.destination)).toMatchObject({ local: true });
    const far = routeReach(jezero, { lat: 18.65, lon: -133.8 });
    expect(far.local).toBe(false);
    expect(far.km).toBeGreaterThan(3000);
  });
  it("uses the API's 3° rule on latitude and on normalised longitude", () => {
    expect(routeSpanDeg({ lat: 0, lon: 179 }, { lat: 0, lon: -179 })).toBe(358);       // the API refuses routes across 180°
    expect(routeReach({ lat: 10, lon: 10 }, { lat: 12.9, lon: 12.9 }).local).toBe(true);
    expect(routeReach({ lat: 10, lon: 10 }, { lat: 13.1, lon: 10 }).local).toBe(false);
  });
});
