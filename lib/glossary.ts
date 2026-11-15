/** Plain-language definitions shared by the guided tour and the glossary dialog. Keep them short, exact and free of hype. */
export type Term = { id: string; term: string; short: string; detail: string };

export const GLOSSARY: Term[] = [
  { id: "mola", term: "MOLA", short: "NASA's laser measurements of the height of Mars.",
    detail: "The Mars Orbiter Laser Altimeter flew on NASA's Mars Global Surveyor. RedReturn uses its 463 m elevation grid: one measured height every 463 m. Anything smaller — boulders, small craters, dunes — is not visible in it." },
  { id: "dem", term: "Elevation grid (DEM)", short: "A map where every cell stores a height in metres.",
    detail: "A Digital Elevation Model. Heights are metres above the MOLA reference surface (the “areoid”, Mars' equivalent of sea level). Where the grid has no value, RedReturn shows a gap — it never invents one." },
  { id: "window", term: "Stored area", short: "A piece of the MOLA grid kept on the server.",
    detail: "Jezero and Gale ship with RedReturn. For other places the API downloads the real MOLA values for the area the first time you plan there, and keeps them." },
  { id: "longrange", term: "Long-range route", short: "An overview route between points more than ~150 km apart.",
    detail: "Computed on real MOLA heights sampled every few kilometres, so it shows the big picture (distance, climbs, travel time and supplies as estimates) but cannot see crater walls or obstacles. Risk Lab, Emergency and ARES need a local excursion." },
  { id: "ls", term: "Solar longitude (Ls)", short: "Where Mars is in its year, from 0° to 360°.",
    detail: "Ls 0° is the northern spring equinox, 90° northern summer, 180° autumn, 270° winter. A Mars year lasts 687 Earth days. Dust storms are most likely from Ls 180° to 360°, when Mars is closest to the Sun." },
  { id: "ltst", term: "Local solar time", short: "The time of day on Mars at a place, from the Sun's position.",
    detail: "12:00 is when the Sun is highest. A Martian day (sol) lasts 24 h 39 min, so Mars clocks drift against Earth clocks. RedReturn computes it with NASA's Mars24 algorithm." },
  { id: "spaceweather", term: "Space weather", short: "Solar activity — flares, particles, CMEs — that can raise radiation.",
    detail: "Mars has no global magnetic field and a thin atmosphere, so solar energetic particles reach the surface more easily than on Earth. RedReturn lists NASA's recent notifications; it does not forecast doses at Mars." },
  { id: "slope", term: "Slope", short: "How steep the ground is, in degrees.",
    detail: "Measured between grid cells about 0.5–1.4 km apart, so short steep steps can be hidden. The slope limit (15° by default) is a scenario assumption you can change in Planner." },
  { id: "strategy", term: "Route strategies", short: "Four ways to choose a path.",
    detail: "Shortest (straight line), terrain-aware (avoids steep ground), resource-conservative (saves energy) and science-prioritised (visits your science stops). Comparing them shows what each choice costs." },
  { id: "margin", term: "Return margin", short: "How much is left of the scarcest resource when the crew is back.",
    detail: "Oxygen, energy, water, radiation dose and time are each checked against their limit. The smallest leftover — the “limiting factor” — is the margin. Negative means the plan fails in the model." },
  { id: "feasible", term: "“Feasible in model”", short: "Passes every check in RedReturn's calculations — not “safe”.",
    detail: "The model uses assumed consumption rates and a coarse terrain grid. A feasible plan is a starting point for discussion; nothing in RedReturn is certified for real missions." },
  { id: "montecarlo", term: "Monte Carlo ensemble", short: "Run the same plan thousands of times with slightly different inputs.",
    detail: "Risk Lab varies uncertain inputs (speed, consumption, terrain error…) within assumed ranges and counts how many runs still pass. It shows which assumptions matter most. It is not a probability of survival." },
  { id: "snapshot", term: "Snapshot", short: "Results saved in advance for the demo route.",
    detail: "If the API is unreachable, RedReturn can still show the Jezero demo from a precomputed snapshot, always labelled. It never makes up results for other places." },
  { id: "classes", term: "Data classes A–E", short: "Where each number comes from.",
    detail: "A = measured by an instrument, B = calculated from measurements, C = assumption, D = simulation output, E = data that is missing. Badges show the class next to results." },
];

export const term = (id: string) => GLOSSARY.find(t => t.id === id)!;
