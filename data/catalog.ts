import type { Coordinate } from "@/lib/mars";

export type CatalogEntry = Coordinate & { id: string; name: string; kind: string };

/** Approximate feature centres (planetocentric, east-positive). Verify against the USGS Planetary Gazetteer before any use. */
export const CATALOG: CatalogEntry[] = [
  { id: "jezero", name: "Jezero Crater", lat: 18.38, lon: 77.58, kind: "Impact crater / paleolake" },
  { id: "gale", name: "Gale Crater (Mount Sharp)", lat: -5.4, lon: 137.8, kind: "Crater with layered central mound" },
  { id: "olympus", name: "Olympus Mons", lat: 18.65, lon: -133.8, kind: "Shield volcano" },
  { id: "valles", name: "Valles Marineris (Melas Chasma)", lat: -9.8, lon: -76.5, kind: "Canyon system" },
  { id: "arcadia", name: "Arcadia Planitia", lat: 39.2, lon: -171, kind: "Volcanic plain" },
  { id: "korolev", name: "Korolev Crater", lat: 73, lon: 165, kind: "Crater with permanent ice deposit" },
  { id: "elysium", name: "Elysium Planitia", lat: 4.5, lon: 135.9, kind: "Smooth volcanic plain" },
  { id: "hellas", name: "Hellas Planitia", lat: -42.4, lon: 70.5, kind: "Giant impact basin" },
  { id: "utopia", name: "Utopia Planitia", lat: 25.1, lon: 109.9, kind: "Northern lowland plain" },
  { id: "meridiani", name: "Meridiani Planum", lat: -1.9, lon: -5.5, kind: "Hematite-bearing plain" },
  { id: "gusev", name: "Gusev Crater", lat: -14.6, lon: 175.5, kind: "Crater at Ma'adim Vallis outlet" },
  { id: "chryse", name: "Chryse Planitia", lat: 22.3, lon: -48, kind: "Outflow-channel basin" },
  { id: "aresvallis", name: "Ares Vallis", lat: 19.3, lon: -33.5, kind: "Outflow channel" },
  { id: "deuteronilus", name: "Deuteronilus Mensae", lat: 43.9, lon: 33.7, kind: "Mesas with debris-covered glaciers" },
  { id: "noctis", name: "Noctis Labyrinthus", lat: -7, lon: -101, kind: "Fault-bounded canyon maze" },
  { id: "north", name: "Planum Boreum (north polar)", lat: 84, lon: 0, kind: "Layered polar cap" },
  { id: "south", name: "Planum Australe (south polar)", lat: -85, lon: 0, kind: "Polar cap with residual CO₂" },
  { id: "ceraunius", name: "Ceraunius Tholus", lat: 24.2, lon: -97.4, kind: "Volcano with erosion channels" },
];

/** Mars Trek WMTS layers; level-0 tiles (cols 0 and 1) answered HTTP 200 with open CORS on 2026-11-14. */
export const TREK_BASE = "https://trek.nasa.gov/tiles/Mars/EQ";
export const LAYERS = [
  { id: "colorshade", name: "MOLA color shade", kind: "Topographic (visual)", layer: "Mars_MGS_MOLA_ClrShade_merge_global_463m", ext: "jpg", maxZoom: 7, note: "Colour is not elevation." },
  { id: "viking", name: "Viking MDIM 2.1 color", kind: "Optical", layer: "Mars_Viking_MDIM21_ClrMosaic_global_232m", ext: "jpg", maxZoom: 7, note: "232 m/px mosaic." },
  { id: "themis-day", name: "THEMIS day IR", kind: "Thermal", layer: "THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018", ext: "png", maxZoom: 7, note: "Radiance image, not calibrated temperature." },
  { id: "themis-night", name: "THEMIS night IR", kind: "Thermal", layer: "THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018", ext: "png", maxZoom: 7, note: "Radiance image, not calibrated temperature." },
  { id: "tes-ti", name: "TES thermal inertia", kind: "Thermal", layer: "TES_Thermal_Inertia", ext: "png", maxZoom: 1, note: "Coarse surface-property proxy." },
] as const;
export type LayerId = (typeof LAYERS)[number]["id"];
export const tileUrl = (layerId: LayerId, col: 0 | 1) => {
  const l = LAYERS.find(x => x.id === layerId)!;
  return `${TREK_BASE}/${l.layer}/1.0.0/default/default028mm/0/0/${col}.${l.ext}`;
};

/** Highest WMTS level checked to exist for each layer (HTTP 200 on 2026-11-15); deeper requests return 404. */
export const maxZoom = (layerId: LayerId) => LAYERS.find(x => x.id === layerId)!.maxZoom;
/** Equirectangular WMTS tile: level z has 2^z rows × 2^(z+1) columns of 256 px, each 180/2^z degrees wide. */
export const tileUrlZ = (layerId: LayerId, z: number, row: number, col: number) => {
  const l = LAYERS.find(x => x.id === layerId)!;
  return `${TREK_BASE}/${l.layer}/1.0.0/default/default028mm/${z}/${row}/${col}.${l.ext}`;
};
