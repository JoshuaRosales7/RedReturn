export const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : v.toFixed(d));
export const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
export const coord = (lat: number, lon: number) => `${Math.abs(lat).toFixed(3)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(3)}°${lon >= 0 ? "E" : "W"}`;
export const hours = (h: number | null | undefined) => (h === null || h === undefined || !Number.isFinite(h) ? "—" : `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, "0")} min`);
export const STRATEGY_LABEL: Record<string, string> = { shortest: "Shortest geometric", terrain: "Terrain-aware", resource: "Resource-conservative", science: "Science-prioritised" };
export const STRATEGY_COLOR: Record<string, string> = { shortest: "#9aa4ad", terrain: "#6fb7a7", resource: "#e0a458", science: "#b48ead" };
export const FACTOR_LABEL: Record<string, string> = { oxygen: "Oxygen", energy: "Energy", water: "Water", radiation: "Radiation", time: "Time window" };
export const factor = (k: string | null | undefined) => (k ? FACTOR_LABEL[k] ?? k.replace(/_/g, " ") : "—");
