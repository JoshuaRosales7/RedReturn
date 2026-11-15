/** Shared hypsometric colour ramp for the relief map, the 3D mesh and their colour bar. Colour encodes elevation for display only; it is never read back as data. */
export type RGB = [number, number, number];

const STOPS: [number, RGB][] = [
  [0.0, [44, 62, 110]], [0.18, [58, 112, 140]], [0.36, [112, 154, 128]],
  [0.55, [200, 178, 118]], [0.75, [196, 124, 78]], [1.0, [240, 228, 214]],
];

export function reliefColor(t: number): RGB {
  const x = Math.max(0, Math.min(1, t));
  for (let i = 1; i < STOPS.length; i++) {
    if (x <= STOPS[i][0]) {
      const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i], k = (x - a) / (b - a);
      return [ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k];
    }
  }
  return STOPS[STOPS.length - 1][1];
}

export const RELIEF_GRADIENT = `linear-gradient(90deg, ${STOPS.map(([p, c]) => `rgb(${c.join(",")}) ${p * 100}%`).join(", ")})`;

/** Range of valid elevations; null when the grid has no valid cell. */
export function elevationRange(z: (number | null)[]): { lo: number; hi: number } | null {
  let lo = Infinity, hi = -Infinity;
  for (const v of z) if (v !== null) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return Number.isFinite(lo) ? { lo, hi } : null;
}

/** Bilinear upsampling of a grid for DISPLAY only. A cell with any missing corner stays missing (nothing is filled). */
export function upsample(z: (number | null)[], rows: number, cols: number, f: number): { z: (number | null)[]; rows: number; cols: number } {
  const R = (rows - 1) * f + 1, C = (cols - 1) * f + 1, out = new Array<number | null>(R * C);
  for (let r = 0; r < R; r++) {
    const r0 = Math.min(rows - 2, Math.floor(r / f)), fr = r / f - r0;
    for (let c = 0; c < C; c++) {
      const c0 = Math.min(cols - 2, Math.floor(c / f)), fc = c / f - c0;
      const a = z[r0 * cols + c0], b = z[r0 * cols + c0 + 1], d = z[(r0 + 1) * cols + c0], e = z[(r0 + 1) * cols + c0 + 1];
      out[r * C + c] = a === null || b === null || d === null || e === null ? null : (a * (1 - fc) + b * fc) * (1 - fr) + (d * (1 - fc) + e * fc) * fr;
    }
  }
  return { z: out, rows: R, cols: C };
}
