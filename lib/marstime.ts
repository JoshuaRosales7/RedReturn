/**
 * Mars time and Sun position — the Mars24 algorithm of NASA GISS (Allison & McEwen 2000, Planet. Space Sci. 48, 215;
 * https://www.giss.nasa.gov/tools/mars24/help/algorithm.html). Planetocentric latitude, east-positive longitude.
 * Accuracy ≈ 0.01° in Ls and a few seconds in local time — far better than the minute-level needs of EVA planning.
 */
const TT_MINUS_UTC_S = 69.184;                          // 37 leap seconds + 32.184 s (valid since 2017-01-01)
const SOL_RATIO = 1.0274912517;                         // sol length in Earth days
const rad = (d: number) => (d * Math.PI) / 180, deg = (r: number) => (r * 180) / Math.PI;
const mod = (a: number, n: number) => ((a % n) + n) % n;

const PBS: [number, number, number][] = [               // perturbations: amplitude (deg), period τ (Julian years), phase φ (deg)
  [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837], [0.0037, 15.7866, 21.736],
  [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528], [0.0018, 32.8493, 49.095],
];

export type MarsTime = {
  /** Areocentric solar longitude, degrees (0 = northern spring equinox). */
  ls: number;
  /** Mars Year (Clancy et al. numbering: MY 1 began 1955-04-11). */
  marsYear: number;
  /** Mars Sol Date (sols since 1873-12-29). */
  msd: number;
  /** Equation of time, hours (true minus mean solar time). */
  eotHours: number;
  /** Mean solar time at the prime meridian, hours. */
  mstHours: number;
  /** Solar declination, degrees. */
  declination: number;
};

export function marsTime(date: Date): MarsTime {
  const jdUt = 2440587.5 + date.getTime() / 8.64e7;
  const jdTt = jdUt + TT_MINUS_UTC_S / 86400;
  const dt = jdTt - 2451545.0;
  const M = 19.3871 + 0.52402073 * dt;
  const aFMS = 270.3871 + 0.524038496 * dt;
  const pbs = PBS.reduce((s, [A, tau, phi]) => s + A * Math.cos(rad((0.985626 * dt) / tau + phi)), 0);
  const nuM = (10.691 + 3.0e-7 * dt) * Math.sin(rad(M)) + 0.623 * Math.sin(rad(2 * M)) + 0.050 * Math.sin(rad(3 * M))
    + 0.005 * Math.sin(rad(4 * M)) + 0.0005 * Math.sin(rad(5 * M)) + pbs;
  const ls = mod(aFMS + nuM, 360);
  const eotDeg = 2.861 * Math.sin(rad(2 * ls)) - 0.071 * Math.sin(rad(4 * ls)) + 0.002 * Math.sin(rad(6 * ls)) - nuM;
  const msd = (jdTt - 2451549.5) / SOL_RATIO + 44796.0 - 0.0009626;
  const declination = deg(Math.asin(0.42565 * Math.sin(rad(ls)))) + 0.25 * Math.sin(rad(ls));
  // Mars Year: ~686.97 Earth days per year from MY 1 (1955-04-11, JD 2435208.5); snap to the Ls wrap near the boundary.
  const n = (jdUt - 2435208.5) / 686.9725;
  let marsYear = 1 + Math.floor(n);
  const frac = n - Math.floor(n);
  if (ls < 30 && frac > 0.9) marsYear += 1;
  if (ls > 330 && frac < 0.1) marsYear -= 1;
  return { ls, marsYear, msd, eotHours: eotDeg / 15, mstHours: mod(24 * msd, 24), declination };
}

/** Local true solar time (hours, 0–24) at an east longitude. */
export function localTrueSolarTime(date: Date, lonE: number): number {
  const t = marsTime(date);
  return mod(t.mstHours + lonE / 15 + t.eotHours, 24);
}

/** Solar elevation above the horizon (degrees) at a site; no refraction or terrain horizon. */
export function solarElevation(date: Date, lat: number, lonE: number): number {
  const t = marsTime(date);
  const ltst = mod(t.mstHours + lonE / 15 + t.eotHours, 24);
  const H = rad((ltst - 12) * 15), d = rad(t.declination), f = rad(lat);
  return deg(Math.asin(Math.max(-1, Math.min(1, Math.sin(f) * Math.sin(d) + Math.cos(f) * Math.cos(d) * Math.cos(H)))));
}

export const SOL_MS = SOL_RATIO * 86400000;

export type DaylightWindow = { sunrise: Date | null; sunset: Date | null; polar: "day" | "night" | null; daylightHours: number };
/** Next sunrise and sunset around `from` (searching one sol each way, 1-minute steps refined by bisection). */
export function daylightAround(from: Date, lat: number, lonE: number): DaylightWindow {
  const el = (ms: number) => solarElevation(new Date(ms), lat, lonE);
  const step = 60_000, t0 = from.getTime();
  const crossings: { t: number; rising: boolean }[] = [];
  let prev = el(t0 - SOL_MS);
  for (let t = t0 - SOL_MS + step; t <= t0 + SOL_MS; t += step) {
    const cur = el(t);
    if ((prev < 0) !== (cur < 0)) {
      let a = t - step, b = t;
      for (let i = 0; i < 20; i++) { const m = (a + b) / 2; if ((el(a) < 0) === (el(m) < 0)) a = m; else b = m; }
      crossings.push({ t: (a + b) / 2, rising: cur >= 0 });
    }
    prev = cur;
  }
  if (!crossings.length) {
    const up = el(t0) >= 0;
    return { sunrise: null, sunset: null, polar: up ? "day" : "night", daylightHours: up ? 24 * SOL_RATIO : 0 };
  }
  const up = el(t0) >= 0;
  // The daylight period that contains `from`, or else the next one.
  const rise = up ? [...crossings].reverse().find(c => c.rising && c.t <= t0) : crossings.find(c => c.rising && c.t > t0);
  const set = rise ? crossings.find(c => !c.rising && c.t > rise.t) : undefined;
  return { sunrise: rise ? new Date(rise.t) : null, sunset: set ? new Date(set.t) : null, polar: null,
    daylightHours: rise && set ? (set.t - rise.t) / 3600000 : 0 };
}

/** Northern-hemisphere season name and whether Ls falls in the perihelion "dust storm season" (Ls 180°–360°). */
export function seasonOf(ls: number, lat: number): { name: string; dustSeason: boolean } {
  const north = ["spring", "summer", "autumn", "winter"][Math.floor(mod(ls, 360) / 90)];
  const south = { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" }[north]!;
  return { name: `${lat >= 0 ? north : south} (${lat >= 0 ? "northern" : "southern"} hemisphere)`, dustSeason: ls >= 180 };
}

/** "HH:MM" from fractional hours. */
export const hhmm = (h: number) => { const m = Math.round(mod(h, 24) * 60) % 1440; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };

/** Automatic EVA start: 30 min after the next sunrise at the site (or `now` under polar day; null under polar night). */
export function suggestedEvaStart(now: Date, lat: number, lonE: number): Date | null {
  const w = daylightAround(now, lat, lonE);
  if (w.polar === "day") return now;
  if (w.polar === "night" || !w.sunrise) return null;
  const t = w.sunrise.getTime() + 30 * 60000;
  if (t > now.getTime()) return new Date(t);
  const next = daylightAround(new Date((w.sunset ?? w.sunrise).getTime() + 60000), lat, lonE);   // today's window already started
  return next.sunrise ? new Date(next.sunrise.getTime() + 30 * 60000) : null;
}
