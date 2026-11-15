import type { MissionConfig, RouteStrategy } from "./mars";

export type Point = { lat: number; lon: number; name?: string };
export type Stop = { name?: string; lat: number; lon: number; dwell_hours: number; weight: number };
export type MissionResult = {
  distance_km: number; duration_hours: number; travel_hours: number; oxygen_used_kg: number; oxygen_remaining_kg: number;
  energy_used_kwh: number; energy_remaining_kwh: number; water_used_liters: number; water_remaining_liters: number; radiation_msv: number;
  constraints: Record<string, boolean>; feasible_within_model: boolean; margins: Record<string, number>; limiting_factor: string;
  limiting_margin_percent: number; climb_energy_kwh: number; terrain_status: string; certification: string; disclaimer: string;
};
export type RouteAlt = {
  strategy: RouteStrategy; status: "ok" | "downgraded"; note: string | null; objective: string; tile_id: string;
  coordinates: { lat: number; lon: number; elevation_m: number | null }[];
  profile: { distance_km: number[]; elevation_m: (number | null)[]; slope_deg: (number | null)[]; status: string[] };
  metrics: { distance_km: number; one_way_travel_hours: number; elevation_gain_m: number; elevation_loss_m: number; max_slope_deg: number | null;
    mean_slope_deg: number | null; max_local_slope_deg: number | null; terrain_resolution_m: number; samples: number; interpolated_samples: number;
    nodata_samples: number; outside_coverage_samples: number; effective_distance_km: number };
  constraints_violated: { id: string; detail: string; count: number }[];
  cost_components: Record<string, number>; mission: MissionResult; science_value: number;
  science_stops_visited?: { name: string | null; lat: number; lon: number; dwell_hours: number; weight: number }[];
};
export type Coverage = { id: string; name: string; bounds: { lat_min: number; lat_max: number; lon_min: number; lon_max: number }; rows: number; cols: number;
  pixel_size_m: number; valid_fraction: number; nodata_cells: number; elevation_min_m: number; elevation_max_m: number };
export type Alternatives = {
  tile: Coverage; resolution: { pixel_size_m: number; smallest_resolvable_feature_m: number; vertical_uncertainty_m: number; statement: string };
  routes: RouteAlt[]; recommended: RouteStrategy | null; reason: string; limitations: string[]; certification: string;
  comparison: { metric: string; label: string; values: Record<string, number>; normalised: Record<string, number> }[];
};
export type Quantiles = { p10: number; p50: number; p90: number };
export type Risk = {
  label: string; runs: number; seed: number; fraction_satisfying_constraints: number;
  monte_carlo_sampling_interval_95: { low: number; high: number; method: string };
  constraint_pass_fraction: Record<string, number>; dominant_failure_mode: string | null; dominant_failure_mode_counts: Record<string, number>;
  distributions: Record<string, Quantiles>; margin_histogram: { edges: number[]; counts: number[] };
  assumptions: { name: string; label: string; kind: string; law: string; sigma: number | null; lo: number | null; mode: number | null; hi: number | null; rationale: string }[];
  sensitivity: { name: string; label: string; kind: string; spearman_rho: number; margin_at_p10_input: number; margin_at_p90_input: number; swing_percent_points: number }[];
  uncertainty_decomposition: Record<string, { margin_p10: number; margin_p90: number; spread_percent_points: number }>;
  engine: { version: string; numpy: string; rng: string }; result_sha256: string; request_sha256?: string;
  deterministic?: MissionResult; route?: { strategy: string };
};
export type ScenarioOption = {
  id: string; label: string; status: "ok" | "blocked"; feasible_within_model: boolean; reason?: string; total_hours?: number;
  oxygen_remaining_kg?: number; energy_remaining_kwh?: number; water_remaining_liters?: number; radiation_msv?: number;
  limiting_factor?: string; limiting_margin_percent?: number; margins_percent?: Record<string, number>; constraints?: Record<string, boolean>;
  required_additional?: Record<string, number>; exhausted?: string[]; remaining_distance_km?: number; route_distance_km?: number;
};
export type Scenario = {
  disclaimer: string; incident: { progress: number; position: Point; applied: string[]; elapsed_hours: number; obstruction: unknown };
  state_at_incident: Record<string, number>; original: ScenarioOption; failure: ScenarioOption | null; options: ScenarioOption[]; revised: ScenarioOption | null;
  revised_feasible: boolean; diff: { metric: string; original: number | boolean | null; failure: number | boolean | null; revised: number | boolean | null; cause: string }[];
  contingency_levers: { id: string; action: string; limiting_margin_percent: number; delta_percent_points: number; feasible_within_model: boolean; basis: string }[];
  unavoidable_uncertainty: string[];
};
export type AresAnswer = { answer: string; provenance: "calculation"; intent: string; tools_used: string[]; evidence: string[]; uncertainty: string[];
  suggested_experiments: string[]; language_model: { available: boolean; label: string; text: string | null; note?: string } | null };
export type Heightfield = { tile_id: string; rows: number; cols: number; bounds: { lat_min: number; lat_max: number; lon_min: number; lon_max: number };
  source_pixel_m: number; display_pixel_m: number; elevation_m: (number | null)[]; slope_deg: (number | null)[]; notes: string[] };
export type DatasetLayer = { id: string; class: "A" | "B" | "C" | "D" | "E"; kind: string; name: string; organization: string; url: string | null; identifier: string | null;
  units: string | null; resolution_m: number | null; processing: string[]; limitations: string[]; license: string; integration: string; verified?: string };
export type Datasets = { classification: Record<string, string>; layers: DatasetLayer[] };
export type Snapshot = { snapshot: { generated_at_utc: string; git_commit: string | null; note: string };
  demo: { id: string; title: string; origin: Point; destination: Point; science_stops: Stop[]; config: Partial<MissionConfig>; incident: { kinds: { kind: string; magnitude: number }[]; at_progress: number }; runs: number; seed: number; narrative: string[] };
  alternatives: Alternatives; risk: Risk; scenario: Scenario; ares: Record<string, AresAnswer>; heightfield: Heightfield; datasets: Datasets; coverage: { items: Coverage[] } };
export type IncidentKind = "battery_loss" | "speed_reduction" | "oxygen_increase" | "water_loss" | "extended_science" | "travel_delay" | "comms_reduction" | "route_obstruction";
export type Incident = { kind: IncidentKind; magnitude: number };
/** Route on the long-range grid: same geometry/profile/metrics shape as a local route, without the excursion mission model. */
export type LongRoute = Pick<RouteAlt, "strategy" | "status" | "note" | "objective" | "coordinates" | "profile" | "metrics" | "constraints_violated">
  & { summary: { one_way_km: number; effective_km: number; ascent_out_m: number; ascent_back_m: number } };
export type LongRange = {
  mode: "long_range";
  grid: { spacing_m: number; factor: number; source_pixel_m: number; rows: number; cols: number; valid_fraction: number; sampling: string;
    bounds: { lat_min: number; lat_max: number; lon_min: number; lon_max: number }; source: { dataset: string; range_read_url: string; etag: string | null } };
  routes: LongRoute[]; heightfield: Heightfield; limitations: string[]; certification: string;
};
