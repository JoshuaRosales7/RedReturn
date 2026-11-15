import { describe, expect, it } from "vitest";
import { decodeMission, encodeMission } from "../lib/share";
import { DEFAULT_CONFIG } from "../lib/mars";

const base = { origin: { lat: -4.59, lon: 137.44 }, destination: { lat: -4.75, lon: 137.3 }, stops: [], config: DEFAULT_CONFIG };

describe("Shareable mission links", () => {
  it("round-trips points, stops and changed settings only", () => {
    const h = encodeMission({ ...base, stops: [{ lat: -4.6, lon: 137.4, dwell_hours: 0.75, weight: 1 }], config: { ...DEFAULT_CONFIG, crew: 3, returnRequired: false } });
    expect(h).toContain("c=crew%3A3%2CreturnRequired%3A0");
    expect(h).not.toContain("speedKmh");                       // defaults are not written
    const m = decodeMission(`#${h}`)!;
    expect(m.origin).toMatchObject({ lat: -4.59, lon: 137.44 });
    expect(m.destination).toMatchObject({ lat: -4.75, lon: 137.3 });
    expect(m.stops).toEqual([{ name: "Stop 1", lat: -4.6, lon: 137.4, dwell_hours: 0.75, weight: 1 }]);
    expect(m.config).toEqual({ crew: 3, returnRequired: false });
  });
  it("keeps 5 decimals (~0.3 m on Mars) and no more", () => expect(encodeMission({ ...base, origin: { lat: 1.234567891, lon: 2 } })).toContain("b=1.23457%2C2"));
  it.each([
    ["missing target", "b=1,2"],
    ["latitude out of range", "b=95,2&t=1,2"],
    ["not a number", "b=a,2&t=1,2"],
    ["empty coordinate", "b=,2&t=1,2"],
    ["unknown setting", "b=1,2&t=1,2&c=__proto__:1"],
    ["bad setting value", "b=1,2&t=1,2&c=crew:x"],
    ["negative dwell", "b=1,2&t=1,2&s=1,2,-1"],
  ])("rejects a malformed link (%s)", (_, h) => expect(decodeMission(h)).toBeNull());
  it("ignores an empty hash", () => expect(decodeMission("")).toBeNull());
});
