"use client";
import { create } from "zustand";
import { api, ApiFailure, isAbort } from "./api";
import { DEFAULT_CONFIG, type MissionConfig, type RouteStrategy } from "./mars";
import type { Alternatives, AresAnswer, Coverage, Datasets, Heightfield, Incident, LongRange, Point, Risk, Scenario, Snapshot, Stop } from "./types";
import type { LayerId } from "@/data/catalog";
import DEMO_SCENARIO from "../api/data/demo_scenario.json";
import { decodeMission, encodeMission, type SharedMission } from "./share";
import { routeReach } from "./coverage";

export type Tab = "overview" | "explorer" | "terrain" | "planner" | "risk" | "emergency" | "ares" | "reports";
export type Source = "live" | "snapshot";
export type ResultKey = "alternatives" | "risk" | "scenario" | "heightfield" | "ares";
/** A failed request: `code` is the API error code (e.g. outside_dem_coverage) or network/timeout. */
export type ErrInfo = { code: string; message: string; offline: boolean; details?: unknown };
type Busy = { alt: boolean; risk: boolean; scenario: boolean; ares: boolean; hf: boolean };
type Demo = Pick<Snapshot["demo"], "origin" | "destination" | "science_stops" | "config" | "incident" | "runs" | "seed">;

type Store = {
  tab: Tab; visited: Tab[]; origin: Point; destination: Point; stops: Stop[]; config: MissionConfig;
  /** Route the user picked as the working plan; null = follow the recommendation. */
  strategy: RouteStrategy | null;
  incidents: Incident[]; incidentProgress: number; layer: LayerId; selection: "origin" | "destination";
  apiState: "unknown" | "online" | "offline"; snapshot: Snapshot | null;
  coverage: Coverage[]; coverageSource: Source | null;
  alternatives: Alternatives | null;
  /** Overview route when base and target are too far apart for local planning (mutually exclusive with `alternatives`). */
  longRange: LongRange | null;
  risk: Risk | null; scenario: Scenario | null; heightfield: Heightfield | null; datasets: Datasets | null;
  sources: Partial<Record<ResultKey, Source>>; errors: Partial<Record<ResultKey, ErrInfo>>; busy: Busy;
  chat: { q: string; a: AresAnswer; source: Source; key: string }[];
  setTab: (t: Tab) => void; setLayer: (l: LayerId) => void; setSelection: (s: "origin" | "destination") => void;
  setOrigin: (p: Point) => void; setDestination: (p: Point) => void; setPoint: (p: Point) => void;
  setConfig: (c: Partial<MissionConfig>) => void; setStrategy: (s: RouteStrategy | null) => void;
  setStops: (s: Stop[]) => void; setIncidents: (i: Incident[]) => void; setIncidentProgress: (v: number) => void;
  init: () => Promise<void>; loadDemo: () => void; retryConnection: () => Promise<void>; isDemo: () => boolean; planKey: () => string;
  refreshAlternatives: () => Promise<void>; reloadHeightfield: () => Promise<void>;
  runRisk: () => Promise<void>; runScenario: () => Promise<void>; ask: (q: string) => Promise<void>;
  reportBody: () => Record<string, unknown>;
};

/** Canonical demo inputs (api/data/demo_scenario.json) so the demo works with or without the precomputed snapshot. */
const DEMO_FALLBACK = DEMO_SCENARIO as unknown as Demo;
const DEBOUNCE_MS = 450;


const ctrl: Partial<Record<keyof Busy, AbortController>> = {};
const fresh = (k: keyof Busy) => { ctrl[k]?.abort(); const c = new AbortController(); ctrl[k] = c; return c; };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const round = (p: Point) => ({ lat: +p.lat.toFixed(5), lon: +p.lon.toFixed(5) });
export const toErr = (e: unknown): ErrInfo => e instanceof ApiFailure
  ? { code: e.code, message: e.offline ? "API offline" : e.message, offline: e.offline, details: e.details }
  : { code: "client_error", message: e instanceof Error ? e.message : "Unexpected error", offline: false };

/** Route that Risk Lab, Emergency and ARES analyse: the user's pick if it exists in the current plan, else the recommendation. */
export function workingStrategy(s: Pick<Store, "strategy" | "alternatives">): RouteStrategy {
  const alt = s.alternatives;
  if (s.strategy && (!alt || alt.routes.some(r => r.strategy === s.strategy))) return s.strategy;
  return alt?.recommended ?? "resource";
}

let pending: ReturnType<typeof setTimeout> | undefined;
let started = false;

export const useMissionStore = create<Store>((set, get) => {
  const body = () => {
    const s = get();
    // Point names are part of the request (and of the reproducibility hashes), exactly as scripts/build_demo_snapshot.py sends them.
    return { origin: s.origin, destination: s.destination, config: apiConfig(s.config), science_stops: s.stops };
  };
  const demo = (): Demo => get().snapshot?.demo ?? DEMO_FALLBACK;
  /** Current inputs equal the demo scenario's (the only inputs the offline snapshot may answer). */
  const matches = (d: Demo) => {
    const s = get();
    return same(round(s.origin), round(d.origin)) && same(round(s.destination), round(d.destination)) && same(s.stops.map(x => [x.lat, x.lon, x.dwell_hours]), d.science_stops.map(x => [x.lat, x.lon, x.dwell_hours]))
      && same(apiConfig(s.config), apiConfig({ ...DEFAULT_CONFIG, ...fromApiConfig(d.config as Record<string, number | boolean>) }));
  };
  const demoMatch = () => { const d = get().snapshot?.demo; return !!d && matches(d); };
  const fail = (key: ResultKey, e: unknown) => { if (!isAbort(e)) set(s => ({ errors: { ...s.errors, [key]: toErr(e) }, sources: { ...s.sources, [key]: undefined } })); };
  const ok = (key: ResultKey, source: Source) => set(s => ({ errors: { ...s.errors, [key]: undefined }, sources: { ...s.sources, [key]: source } }));
  const idle = (k: keyof Busy, c: AbortController) => { if (ctrl[k] === c) set(s => ({ busy: { ...s.busy, [k]: false } })); };
  const chatKey = () => `${get().planKey()}|${workingStrategy(get())}`;

  /** Results computed for other inputs must never be shown for the current ones: cancel in-flight work and drop dependent results. */
  const dropDownstream = () => {
    (["risk", "scenario", "ares"] as const).forEach(k => ctrl[k]?.abort());
    set(s => ({ risk: null, scenario: null, errors: { ...s.errors, risk: undefined, scenario: undefined, ares: undefined }, sources: { ...s.sources, risk: undefined, scenario: undefined }, busy: { ...s.busy, risk: false, scenario: false, ares: false } }));
  };
  const invalidate = () => {
    ctrl.hf?.abort();
    dropDownstream();
    set(s => ({ alternatives: null, longRange: null, heightfield: null, errors: { ...s.errors, alternatives: undefined, heightfield: undefined }, sources: { ...s.sources, alternatives: undefined, heightfield: undefined }, busy: { ...s.busy, hf: false } }));
  };
  /** Apply an input change; re-plan (debounced) only when the request would actually differ. */
  const change = (patch: Partial<Store>) => {
    const before = get().planKey();
    set(patch);
    if (get().planKey() === before) return;
    invalidate();
    clearTimeout(pending);
    set(s => ({ busy: { ...s.busy, alt: true } }));             // a plan is pending: show "planning", not "no analysis"
    pending = setTimeout(() => void get().refreshAlternatives(), DEBOUNCE_MS);
  };

  /** Open a mission from a shared link; a link to the demo coordinates simply loads the demo (keeps snapshot fallback and names). */
  function applyShared(m: SharedMission) {
    clearTimeout(pending);
    set({ origin: m.origin, destination: m.destination, stops: m.stops, config: { ...DEFAULT_CONFIG, ...m.config }, strategy: null, chat: [] });
    const d = demo();
    if (same(round(m.origin), round(d.origin)) && same(round(m.destination), round(d.destination)) && get().isDemo()) { get().loadDemo(); return; }
    invalidate();
    void get().refreshAlternatives();
  }

  /** Keep the address bar in step with the inputs (replaceState: no history spam), and follow links pasted into this tab. */
  function syncUrl() {
    if (typeof window === "undefined") return;
    let last = "";
    const write = () => {
      const s = get(); const h = encodeMission({ origin: s.origin, destination: s.destination, stops: s.stops, config: s.config });
      if (h === last) return; last = h;
      try { history.replaceState(history.state, "", `${location.pathname}${location.search}#${h}`); } catch { /* sandboxed frames */ }
    };
    write();
    useMissionStore.subscribe(write);
    window.addEventListener("hashchange", () => {
      const m = decodeMission(location.hash);
      if (m && location.hash.slice(1) !== last) applyShared(m);
    });
  }

  async function connect() {
    try { await api("/api/health", { timeoutMs: 4000 }); set({ apiState: "online" }); }
    catch { set({ apiState: "offline" }); return; }
    await Promise.all([
      api<Datasets>("/api/datasets", { timeoutMs: 6000 }).then(datasets => set({ datasets })).catch(() => { /* keep snapshot provenance */ }),
      api<{ items: Coverage[] }>("/api/terrain/coverage", { timeoutMs: 6000 }).then(c => set({ coverage: c.items, coverageSource: "live" })).catch(() => { /* keep snapshot coverage */ }),
    ]);
  }

  async function loadHeightfield(tile: string) {
    const c = fresh("hf"); const s = get();
    set(x => ({ busy: { ...x.busy, hf: true }, errors: { ...x.errors, heightfield: undefined } }));
    const pts = [s.origin, s.destination, ...s.stops];
    const lat = pts.map(p => p.lat), lon = pts.map(p => p.lon);
    const pad = Math.max(0.07, 0.2 * Math.max(Math.max(...lat) - Math.min(...lat), Math.max(...lon) - Math.min(...lon)));   // frame the route, not the whole window
    try {
      const q = new URLSearchParams({ tile, lat_min: String(Math.min(...lat) - pad), lat_max: String(Math.max(...lat) + pad), lon_min: String(Math.min(...lon) - pad), lon_max: String(Math.max(...lon) + pad), max_size: "128" });
      const heightfield = await api<Heightfield>(`/api/terrain/heightfield?${q}`, { signal: c.signal });
      set({ heightfield }); ok("heightfield", "live");
    } catch (e) { fail("heightfield", e); }
    finally { idle("hf", c); }
  }

  return {
    tab: "overview", visited: ["overview"], origin: DEMO_FALLBACK.origin, destination: DEMO_FALLBACK.destination, stops: DEMO_FALLBACK.science_stops, config: DEFAULT_CONFIG, strategy: null,
    incidents: DEMO_FALLBACK.incident.kinds as Incident[], incidentProgress: DEMO_FALLBACK.incident.at_progress,
    layer: "colorshade", selection: "destination", apiState: "unknown", snapshot: null, coverage: [], coverageSource: null,
    alternatives: null, longRange: null, risk: null, scenario: null, heightfield: null, datasets: null, sources: {}, errors: {},
    busy: { alt: true, risk: false, scenario: false, ares: false, hf: false }, chat: [],   // init() plans the demo route right away: first paint says "planning", not "no analysis"
    setTab: tab => set(s => ({ tab, visited: s.visited.includes(tab) ? s.visited : [...s.visited, tab] })), setLayer: layer => set({ layer }), setSelection: selection => set({ selection }),
    setOrigin: origin => change({ origin }),
    setDestination: destination => change({ destination }),
    setPoint: p => (get().selection === "origin" ? get().setOrigin(p) : get().setDestination(p)),
    setConfig: c => change({ config: { ...get().config, ...c } }),
    setStops: stops => change({ stops }),
    setStrategy: strategy => { if (strategy === get().strategy) return; set({ strategy }); dropDownstream(); },
    setIncidents: incidents => { ctrl.scenario?.abort(); set(s => ({ incidents, scenario: null, errors: { ...s.errors, scenario: undefined }, sources: { ...s.sources, scenario: undefined }, busy: { ...s.busy, scenario: false } })); },
    setIncidentProgress: incidentProgress => { ctrl.scenario?.abort(); set(s => ({ incidentProgress, scenario: null, errors: { ...s.errors, scenario: undefined }, sources: { ...s.sources, scenario: undefined }, busy: { ...s.busy, scenario: false } })); },
    planKey: () => JSON.stringify(body()),
    isDemo: () => matches(demo()),

    init: async () => {
      if (started) return;                                       // React StrictMode runs effects twice in development
      started = true;
      const connecting = connect();                              // check the API while the snapshot downloads
      let snap: Snapshot | null = null;
      try { const r = await fetch("/data/demo-snapshot.json", { signal: AbortSignal.timeout(8000) }); if (r.ok) snap = await r.json(); } catch { /* snapshot is optional */ }
      if (snap) set(s => ({ snapshot: snap, datasets: s.datasets ?? snap.datasets, ...(s.coverageSource === "live" ? {} : { coverage: snap.coverage.items, coverageSource: "snapshot" as const }) }));
      const shared = typeof window !== "undefined" ? decodeMission(window.location.hash) : null;
      if (shared) applyShared(shared); else get().loadDemo();   // plans immediately; falls back to the snapshot if the API is down
      syncUrl();
      await connecting;
    },

    retryConnection: async () => {
      set({ apiState: "unknown" });
      await connect();
      await get().refreshAlternatives();
    },

    loadDemo: () => {
      const d = demo();
      clearTimeout(pending);
      set({ origin: d.origin, destination: d.destination, stops: d.science_stops, config: { ...DEFAULT_CONFIG, ...fromApiConfig(d.config as Record<string, number | boolean>) },
        incidents: d.incident.kinds as Incident[], incidentProgress: d.incident.at_progress, strategy: null, chat: [] });
      invalidate();
      void get().refreshAlternatives();
    },

    refreshAlternatives: async () => {
      clearTimeout(pending);
      const c = fresh("alt");
      set(s => ({ busy: { ...s.busy, alt: true }, errors: { ...s.errors, alternatives: undefined } }));
      if (!routeReach(get().origin, get().destination).local) {   // too far for local planning: long-range overview instead
        ctrl.hf?.abort();
        set(s => ({ alternatives: null, heightfield: null, busy: { ...s.busy, hf: false } }));
        try {
          const longRange = await api<LongRange>("/api/routes/long-range", { body: { origin: get().origin, destination: get().destination, config: apiConfig(get().config) }, signal: c.signal, timeoutMs: 180000 });
          set({ longRange, apiState: "online" }); ok("alternatives", "live");
        } catch (e) {
          if (isAbort(e)) return;
          set(s => ({ longRange: null, ...(e instanceof ApiFailure && e.offline ? { apiState: "offline" as const } : {}), sources: { ...s.sources, alternatives: undefined } }));
          fail("alternatives", e);
        } finally { idle("alt", c); }
        return;
      }
      try {
        // Outside the cached windows the API downloads real MOLA rows for the area first (seconds to a minute).
        const alternatives = await api<Alternatives>("/api/routes/alternatives", { body: body(), signal: c.signal, timeoutMs: 120000 });
        set(s => ({ alternatives, longRange: null, apiState: "online", ...(s.coverage.some(t => t.id === alternatives.tile.id) ? {} : { coverage: [...s.coverage, alternatives.tile], coverageSource: "live" as const }) }));
        ok("alternatives", "live");
        void loadHeightfield(alternatives.tile.id);
      } catch (e) {
        if (isAbort(e)) return;
        const snap = get().snapshot;
        if (e instanceof ApiFailure && e.offline && snap && demoMatch()) {
          set({ alternatives: snap.alternatives, apiState: "offline", heightfield: snap.heightfield }); ok("alternatives", "snapshot"); ok("heightfield", "snapshot");
        } else {
          ctrl.hf?.abort();
          set(s => ({ alternatives: null, heightfield: null, busy: { ...s.busy, hf: false }, ...(e instanceof ApiFailure && e.offline ? { apiState: "offline" as const } : {}) }));
          fail("alternatives", e);
        }
      } finally { idle("alt", c); }
    },

    reloadHeightfield: async () => { const t = get().alternatives?.tile.id; if (t) await loadHeightfield(t); },

    runRisk: async () => {
      const c = fresh("risk"); set(s => ({ busy: { ...s.busy, risk: true }, errors: { ...s.errors, risk: undefined } }));
      const s0 = get(); const strategy = workingStrategy(s0); const d = demo();
      try { set({ risk: await api<Risk>("/api/risk/analyze", { body: { ...body(), strategy, runs: d.runs, seed: d.seed }, signal: c.signal, timeoutMs: 40000 }) }); ok("risk", "live"); }
      catch (e) {
        if (isAbort(e)) return;
        const snap = get().snapshot;
        if (e instanceof ApiFailure && e.offline && snap && demoMatch() && strategy === snap.alternatives.recommended) { set({ risk: snap.risk }); ok("risk", "snapshot"); }
        else fail("risk", e);
      } finally { idle("risk", c); }
    },

    runScenario: async () => {
      const c = fresh("scenario"); set(s => ({ busy: { ...s.busy, scenario: true }, errors: { ...s.errors, scenario: undefined } }));
      const s0 = get(); const strategy = workingStrategy(s0);
      try { set({ scenario: await api<Scenario>("/api/scenarios/simulate", { body: { ...body(), strategy, incidents: s0.incidents, at_progress: s0.incidentProgress }, signal: c.signal, timeoutMs: 40000 }) }); ok("scenario", "live"); }
      catch (e) {
        if (isAbort(e)) return;
        const snap = get().snapshot; const d = snap?.demo;
        if (e instanceof ApiFailure && e.offline && snap && d && demoMatch() && strategy === snap.alternatives.recommended && same(s0.incidents, d.incident.kinds) && s0.incidentProgress === d.incident.at_progress) { set({ scenario: snap.scenario }); ok("scenario", "snapshot"); }
        else fail("scenario", e);
      } finally { idle("scenario", c); }
    },

    ask: async q => {
      const c = fresh("ares"); set(s => ({ busy: { ...s.busy, ares: true }, errors: { ...s.errors, ares: undefined } }));
      const s0 = get(); const strategy = workingStrategy(s0); const key = chatKey();
      try {
        const a = await api<AresAnswer>("/api/ares/ask", { body: { ...body(), strategy, question: q, use_language_model: false }, signal: c.signal, timeoutMs: 40000 });
        set(s => ({ chat: [...s.chat, { q, a, source: "live", key }] })); ok("ares", "live");
      } catch (e) {
        if (isAbort(e)) return;
        const hit = get().snapshot?.ares[q];
        if (e instanceof ApiFailure && e.offline && hit && demoMatch() && strategy === get().snapshot?.alternatives.recommended) { set(s => ({ chat: [...s.chat, { q, a: hit, source: "snapshot", key }] })); ok("ares", "snapshot"); }
        else fail("ares", e);
      } finally { idle("ares", c); }
    },

    reportBody: () => {
      const s = get(), d = demo();
      const picked = s.strategy && workingStrategy(s) !== s.alternatives?.recommended ? { strategy: workingStrategy(s) } : {};   // omitted = API uses the recommendation
      return { ...body(), ...picked, runs: d.runs, seed: d.seed, incident_progress: s.incidentProgress, incident: s.incidents[0] ?? null, incidents: s.incidents };
    },
  };
});

/** Key identifying the inputs an ARES answer was computed for (compare with chat entries to flag stale answers). */
export const currentChatKey = (s: Store) => `${s.planKey()}|${workingStrategy(s)}`;

/** API field names for the mission configuration (single mapping, mirrored by tests/parity.test.ts). */
export function apiConfig(c: MissionConfig) {
  return {
    crew: c.crew, speed_kmh: c.speedKmh, oxygen_kg: c.oxygenKg, oxygen_kg_per_person_hour: c.oxygenKgPerPersonHour, energy_kwh: c.energyKwh,
    energy_kwh_per_hour: c.energyKwhPerHour, water_liters: c.waterLiters, water_liters_per_person_day: c.waterLitersPerPersonDay,
    radiation_msv_per_hour: c.radiationMsvPerHour, max_radiation_msv: c.maxRadiationMsv, reserve_percent: c.reservePercent, max_hours: c.maxHours,
    science_hours: c.scienceHours, contingency_percent: c.contingencyPercent, return_required: c.returnRequired,
    max_slope_deg: c.maxSlopeDeg, rover_mass_kg: c.roverMassKg, drivetrain_efficiency: c.drivetrainEfficiency,
  };
}

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
/** Inverse of apiConfig for partial API configs (e.g. the demo scenario). */
export function fromApiConfig(c: Record<string, number | boolean>): Partial<MissionConfig> {
  const map: Record<string, string> = { oxygen_kg_per_person_hour: "oxygenKgPerPersonHour", water_liters_per_person_day: "waterLitersPerPersonDay", energy_kwh_per_hour: "energyKwhPerHour", radiation_msv_per_hour: "radiationMsvPerHour" };
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [map[k] ?? camel(k), v])) as Partial<MissionConfig>;
}
