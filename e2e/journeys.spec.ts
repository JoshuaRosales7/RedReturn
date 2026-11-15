import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { API, gotoTab, openApp } from "./helpers";

test.describe("Live stack (web + API)", () => {
  test("1. opens the dashboard", async ({ page }) => {
    await openApp(page);
    await expect(page).toHaveTitle(/RedReturn/);
    await expect(page.getByRole("tab")).toHaveCount(9);   // desktop nav visible; the mobile bottom nav is hidden by CSS
    await expect(page.locator(".legal")).toContainText("Not operational guidance");
    await expect(page.locator(".stat", { hasText: "Terrain resolution" })).toContainText("463 m");
    await expect(page.getByText("not certifiable").first()).toBeVisible();
  });

  test("2. displays real NASA MOLA terrain data", async ({ page, request }) => {
    await openApp(page);
    await gotoTab(page, "terrain");
    await expect(page.locator("canvas[aria-label^='Shaded relief']")).toBeVisible();
    await expect(page.getByText("NASA MGS MOLA 463 m DEM")).toBeVisible();
    await expect(page.locator(".stat", { hasText: "DEM resolution" })).toContainText("463 m");
    await expect(page.locator(".stat", { hasText: "Window coverage" })).toContainText("100.0%");
    await expect(page.getByText("Elevation profile and slope")).toBeVisible();
    await expect(page.locator(".recharts-line").first()).toBeVisible();
    // the API serves the raw MOLA value; -2644.46 m was cross-checked against an independent rasterio read
    const r = await request.get(`${API}/api/terrain/elevation`, { params: { lat: 18.38, lon: 77.58 } });
    const j = await r.json();
    expect(j.elevation_m).toBeCloseTo(-2644.464, 2);
    expect(j.interpolated).toBe(true);
    expect(j.units).toContain("MOLA areoid");
    // outside coverage must be a typed error, never a fabricated number
    const out = await request.get(`${API}/api/terrain/elevation`, { params: { lat: 0, lon: 0 } });
    expect(out.status()).toBe(404);
    expect((await out.json()).error.code).toBe("outside_dem_coverage");
  });

  test("3. compares routes and explains the recommendation", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "planner");
    const rows = page.locator("table.t", { hasText: "Ascent" }).first().locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.filter({ hasText: "Shortest geometric" })).toContainText("max slope");
    await expect(page.locator(".badge", { hasText: "Recommended: Resource-conservative" })).toBeVisible();
    await expect(page.getByText("Why they differ")).toBeVisible();
    await expect(page.getByText(/has the largest limiting margin/)).toBeVisible();
    const shortest = await rows.filter({ hasText: "Shortest geometric" }).locator("td").nth(5).innerText();
    const terrain = await rows.filter({ hasText: "Terrain-aware" }).locator("td").nth(5).innerText();
    expect(Number(shortest)).toBeCloseTo(18.1, 1);
    expect(Number(terrain)).toBeCloseTo(6.9, 1);
  });

  test("4. runs mission risk analysis with honest labelling and reproducible numbers", async ({ page, request }) => {
    await openApp(page);
    await gotoTab(page, "risk");
    await expect(page.getByText("not a survival probability")).toBeVisible();
    const stat = page.locator(".stat", { hasText: "Scenarios satisfying constraints" });
    await expect(stat).toContainText(/\d+\.\d%/, { timeout: 30_000 });
    await expect(stat).toContainText("sampling error only");
    await expect(page.locator(".recharts-bar-rectangle").first()).toBeVisible();
    await expect(page.getByText("Why this result?")).toBeVisible();
    // the live number must equal the committed snapshot (same seed + request ⇒ same result)
    const snap = await (await request.get("/data/demo-snapshot.json")).json();
    const shown = (await stat.locator(".v").innerText()).replace("%", "");
    expect(Number(shown)).toBeCloseTo(snap.risk.fraction_satisfying_constraints * 100, 1);
    await expect(page.getByText(snap.risk.result_sha256.slice(0, 16))).toBeVisible();
  });

  test("5-6. injects a battery failure and produces a revised return decision", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "emergency");
    await expect(page.getByText("Nothing simulated yet")).toBeVisible();
    await page.getByRole("button", { name: /Simulate failure/ }).click();
    await expect(page.getByText("Original vs failure vs revised")).toBeVisible();
    await expect(page.locator(".badge", { hasText: "Revised plan feasible in model" })).toBeVisible();
    await expect(page.getByText(/Usable battery capacity reduced 35%/)).toBeVisible();
    const options = page.locator("table.t", { hasText: "Needs extra" });
    await expect(options.locator("tr", { hasText: "Continue as planned" })).toContainText("infeasible");
    await expect(options.locator("tr", { hasText: "Continue as planned" })).toContainText("Energy -19.7%");
    await expect(options.locator("tr", { hasText: "Abort now and return to base" })).toContainText("feasible");
    await expect(options.locator("tr", { hasText: "Abort now and return to base" })).toContainText("Energy 13.5%");
    await expect(page.getByText("Unavoidable uncertainty")).toBeVisible();
    await expect(page.getByText(/not operational emergency guidance/i)).toBeVisible();
  });

  test("6b. reports when no option satisfies the model and what extra is required", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "emergency");
    const mag = page.locator("input[type=number]").first();
    await mag.fill("95");
    await page.getByRole("button", { name: /Simulate failure/ }).click();
    await expect(page.locator(".badge", { hasText: "No option satisfies the model" })).toBeVisible();
    await expect(page.locator("table.t", { hasText: "Needs extra" })).toContainText(/energy kwh \+/i);
  });

  test("7. exports PDF, JSON (with reproducibility metadata) and GeoJSON", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "reports");
    const grab = async (name: RegExp) => {
      const [d] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }), page.getByRole("button", { name }).click()]);
      const p = await d.path();
      return { name: d.suggestedFilename(), buf: fs.readFileSync(p!) };
    };
    const json = await grab(/JSON \+ reproducibility/);
    expect(json.name).toBe("redreturn-report.json");
    const rep = JSON.parse(json.buf.toString());
    expect(rep.certification).toBe("NOT_CERTIFIABLE");
    expect(rep.reproducibility.request_sha256).toMatch(/^[0-9a-f]{16}$/);
    expect(rep.reproducibility.dem_windows.jezero.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(rep.alternatives.routes).toHaveLength(4);
    const geo = await grab(/GeoJSON routes/);
    const g = JSON.parse(geo.buf.toString());
    expect(g.type).toBe("FeatureCollection");
    const lines = g.features.filter((f: any) => f.geometry.type === "LineString");
    expect(lines.length).toBe(4);
    for (const f of lines) for (const [lon, lat] of f.geometry.coordinates) { expect(lon).toBeGreaterThanOrEqual(-180); expect(lon).toBeLessThanOrEqual(180); expect(Math.abs(lat)).toBeLessThanOrEqual(90); }
    const pdf = await grab(/PDF report/);
    expect(pdf.name).toBe("redreturn-report.pdf");
    expect(pdf.buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.buf.length).toBeGreaterThan(4000);
    await expect(page.getByText("Challenge alignment")).toBeVisible();
  });

  test("ARES answers from calculations and labels provenance", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "ares");
    await page.getByRole("button", { name: "Why can the system not certify this mission?" }).click();
    await expect(page.locator(".msg .badge", { hasText: "Calculation-based" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/cannot certify this mission/)).toBeVisible();
  });
});

test.describe("API unavailable (safe fallback)", () => {
  test("8. falls back to a clearly labelled snapshot and never invents numbers", async ({ page }) => {
    await openApp(page, { offline: true });
    await expect(page.locator(".chip", { hasText: "Precomputed snapshot" })).toBeVisible();
    await gotoTab(page, "terrain");
    await expect(page.locator("canvas[aria-label^='Shaded relief']")).toBeVisible();
    await gotoTab(page, "planner");
    await expect(page.locator("table.t", { hasText: "Ascent" }).first().locator("tbody tr")).toHaveCount(4);
    await gotoTab(page, "risk");
    await expect(page.locator(".stat", { hasText: "Scenarios satisfying constraints" })).toContainText(/\d+\.\d%/, { timeout: 30_000 });
    await gotoTab(page, "emergency");
    await page.getByRole("button", { name: /Simulate failure/ }).click();
    await expect(page.locator(".badge", { hasText: "Revised plan feasible in model" })).toBeVisible();
    await gotoTab(page, "ares");
    await page.getByRole("button", { name: "Which assumption contributes the most uncertainty?" }).click();
    await expect(page.getByText(/precomputed snapshot/).first()).toBeVisible();
    // export still works offline and says so
    await gotoTab(page, "reports");
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /JSON \+ reproducibility/ }).click()]);
    expect(d.suggestedFilename()).toBe("redreturn-report-offline.json");
    // a non-demo input cannot be answered offline: explicit error, no fabricated route
    await gotoTab(page, "explorer");
    await page.getByLabel("Target latitude").fill("18.7");
    await gotoTab(page, "planner");
    await expect(page.getByText("API offline").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("table.t", { hasText: "Ascent" })).toHaveCount(0);
    await expect(page.locator(".chip", { hasText: "Precomputed snapshot" })).toHaveCount(0);      // discarded snapshot results lose their label too
    await page.getByRole("button", { name: "Load Jezero demo route" }).click();                     // recovery restores the labelled snapshot
    await expect(page.locator("table.t", { hasText: "Ascent" }).first().locator("tbody tr")).toHaveCount(4);
    await expect(page.locator(".chip", { hasText: "Precomputed snapshot" })).toBeVisible();
  });
});

test.describe("Guided tour", () => {
  test("shows on first visit, walks the sections, and is remembered", async ({ page }) => {
    await openApp(page, { tour: true });
    const dlg = page.getByRole("dialog", { name: /Guided tour/ });
    await expect(dlg).toBeVisible();
    await expect(dlg).toContainText("Welcome to RedReturn");
    await dlg.getByRole("button", { name: "Take the tour" }).click();
    await dlg.getByRole("button", { name: "Next" }).click();           // Explorer
    await dlg.getByRole("button", { name: "Next" }).click();           // Terrain
    await expect(dlg).toContainText("3 · Terrain");
    await expect(page.getByRole("heading", { name: "Terrain", level: 1 })).toBeVisible();   // the tour navigates for you
    await dlg.getByRole("button", { name: "Back" }).click();
    await expect(dlg).toContainText("2 · Mars Explorer");
    await page.keyboard.press("Escape");                                 // skip
    await expect(dlg).toBeHidden();
    await page.reload();
    await expect(page.getByRole("heading", { name: /Can the crew reach the target/ })).toBeVisible();
    await expect(page.getByRole("dialog", { name: /Guided tour/ })).toBeHidden();   // remembered
    await page.getByRole("button", { name: "Show guided tour" }).click();           // replay from the ? button
    await expect(page.getByRole("dialog", { name: /Guided tour/ })).toContainText("Welcome to RedReturn");
  });
});

test.describe("Terrain map", () => {
  test("relief map and 3D mesh both render with routes, colour bar and exaggeration control", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "terrain");
    await expect(page.locator("canvas[aria-label^='Shaded relief']")).toBeVisible();
    await expect(page.locator(".cbar")).toBeVisible();
    await page.getByRole("button", { name: "3D mesh" }).click();
    await expect(page.locator("#main .mesh canvas")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel("Vertical exaggeration")).toBeVisible();
    // A blank/black WebGL view compresses to a few hundred bytes; a rendered terrain with routes is far larger.
    await page.waitForTimeout(1500);
    const png = await page.locator("#main .mesh canvas").screenshot();
    expect(png.length).toBeGreaterThan(20_000);
  });

  test("3D mesh is not blank at tablet width (regression: canvas had no explicit height)", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await openApp(page);
    await page.locator(".bottomnav").getByRole("tab", { name: "Terrain" }).click();
    await page.getByRole("button", { name: "3D mesh" }).click();
    await page.locator(".mesh-stage").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2500);
    const box = await page.locator(".mesh-stage").boundingBox();
    expect(box!.height).toBeGreaterThan(300);
    expect((await page.locator("#main .mesh canvas").screenshot()).length).toBeGreaterThan(20_000);
  });
});

test.describe("DEM coverage guidance", () => {
  test("a failed elevation download is explained, old results are not shown, and the demo button restores a valid analysis", async ({ page }) => {
    await page.route(/\/api\/routes\/long-range$/, r => r.fulfill({ status: 502, contentType: "application/json",
      body: JSON.stringify({ error: { code: "dem_download_failed", message: "Could not download MOLA elevations for this area (is the API host online?).", details: {} } }) }));
    await openApp(page);
    await gotoTab(page, "explorer");
    await page.getByLabel("Target latitude").fill("0");
    await page.getByLabel("Target longitude").fill("0");
    await expect(page.locator(".reach.long")).toContainText("long-range route");          // shown before any calculation
    await gotoTab(page, "terrain");
    await expect(page.getByRole("heading", { name: "Elevation download failed" })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator("canvas[aria-label^='Shaded relief']")).toHaveCount(0);      // no stale map for the old coordinates
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();               // a download can succeed on retry
    await page.getByRole("button", { name: "Load Jezero demo route" }).click();
    await expect(page.locator("canvas[aria-label^='Shaded relief']")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".stat", { hasText: "Window coverage" })).toContainText("100.0%");
  });

  test("Gale example route plans inside the Gale window", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "explorer");
    await page.getByRole("button", { name: "Use Gale example route" }).click();
    await expect(page.getByText(/Both points are in the Gale/)).toBeVisible();
    await gotoTab(page, "terrain");
    await expect(page.locator(".stat", { hasText: "Window coverage" })).toContainText("Gale", { timeout: 20_000 });
    await expect(page.locator("canvas[aria-label^='Shaded relief']")).toBeVisible();
  });
});

test.describe("Onboarding", () => {
  test("tour spotlights each section, ends with a quick start, and the glossary explains key terms", async ({ page }) => {
    await openApp(page, { tour: true });
    const dlg = page.getByRole("dialog", { name: /Guided tour/ });
    await expect(dlg).toContainText("Real Mars terrain");
    await dlg.getByRole("button", { name: "Take the tour" }).click();
    await expect(page.locator('[data-tour="flow"].tour-target')).toBeVisible();            // the mission-steps strip is highlighted
    await expect(dlg).toContainText("Key idea");
    await dlg.getByRole("button", { name: "Next" }).click();
    await expect(page.locator('[data-tour="points"].tour-target')).toBeVisible();          // Explorer: point selection highlighted
    for (let k = 0; k < 9; k++) await page.keyboard.press("ArrowRight");
    await expect(dlg).toContainText("You're ready");
    await expect(dlg).toContainText("Pick a base and a target in Mars Explorer");
    await dlg.getByRole("button", { name: "Open glossary" }).click();
    const g = page.getByRole("dialog", { name: "Glossary" });
    await expect(g).toContainText("MOLA");
    await g.getByLabel("Search the glossary").fill("monte");
    await expect(g.locator("dt")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(g).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Mission steps" })).toBeVisible();
  });
});

test.describe("Shareable mission link", () => {
  test("a link reopens the same mission and the address bar follows edits", async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem("redreturn.tour.v1", "done"); } catch { /* ignore */ } });
    await page.goto("/#b=-4.59,137.44&t=-4.75,137.3&c=crew:3");
    await expect(page.locator(".stat", { hasText: "Recommended" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".kv")).toContainText("4.590°S 137.440°E");
    await expect(page.locator(".kv")).toContainText("3 · 4.5 km/h");
    await gotoTab(page, "terrain");
    await expect(page.locator(".stat", { hasText: "Window coverage" })).toContainText("Gale");
    await gotoTab(page, "explorer");
    await page.getByLabel("Target latitude").fill("-4.8");
    await expect.poll(() => page.evaluate(() => location.hash)).toContain("t=-4.8%2C137.3");
  });
});

test.describe("3D terrain controls", () => {
  test("buttons and arrow keys move the camera", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "terrain");
    await page.getByRole("button", { name: "3D mesh" }).click();
    const stage = page.locator(".mesh-stage");
    await expect(stage.locator("canvas")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1200);
    const before = await stage.screenshot();
    await page.getByRole("button", { name: "Rotate left" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await stage.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(800);
    expect(Buffer.compare(before, await stage.screenshot())).not.toBe(0);
  });
});

test.describe("Mars Explorer: any distance", () => {
  test("far points give a long-range overview (terrain, estimate) and local-only tools explain why", async ({ page }) => {
    const fixture = fs.readFileSync("e2e/fixtures/long-range-jezero-gale.json", "utf-8");
    await page.route(/\/api\/routes\/long-range$/, r => r.fulfill({ status: 200, contentType: "application/json", body: fixture }));
    await openApp(page);
    await gotoTab(page, "explorer");
    await page.getByRole("button", { name: "Set Gale Crater (Mount Sharp) as target" }).click();   // ~3,700 km away; nothing is moved
    await expect(page.locator(".reach.long")).toContainText("long-range route");
    await expect(page.getByLabel("Base latitude")).toHaveValue("18.38");
    await gotoTab(page, "terrain");
    await expect(page.getByText("Long-range overview").first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".stat", { hasText: "Grid spacing" })).toContainText("8.8 km");
    await expect(page.locator("canvas[aria-label^='Shaded relief']")).toBeVisible();
    await gotoTab(page, "planner");
    await expect(page.getByRole("heading", { name: "Long-range estimate" })).toBeVisible();
    await expect(page.locator("table.t", { hasText: "Sols" }).locator("tbody tr")).toHaveCount(2);
    await gotoTab(page, "risk");
    await expect(page.getByRole("heading", { name: "Risk Lab needs a local excursion" })).toBeVisible();
  });

  test("the close-up map zooms and places a nearby target precisely", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "explorer");
    const stage = page.locator(".rm-stage");
    await expect(stage.locator("img.rm-tile").first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Zoom in" }).click();
    const before = await page.getByLabel("Target latitude").inputValue();
    const box = (await stage.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);              // "Target" is the default selection
    await expect(page.getByLabel("Target latitude")).not.toHaveValue(before);
    await expect(page.locator(".reach.ok")).toContainText("local excursion");
    await gotoTab(page, "planner");
    await expect(page.locator("table.t", { hasText: "Ascent" }).first().locator("tbody tr")).toHaveCount(4, { timeout: 30_000 });
  });
});


test.describe("3D globe", () => {
  test("a click on the globe sets the point actually under the cursor (regression: was 90° off in longitude)", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "explorer");
    await page.locator(".globe").scrollIntoViewIfNeeded();                                  // the globe is created when it comes into view
    await expect(page.locator(".globe-res")).toBeVisible({ timeout: 60_000 });
    await page.locator(".win", { hasText: "Jezero" }).getByRole("button", { name: "Show on map" }).click();   // flies the globe over Jezero
    await page.locator(".globe").scrollIntoViewIfNeeded();
    await page.waitForTimeout(3500);
    const box = (await page.locator(".globe canvas").boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(async () => Number(await page.getByLabel("Target latitude").inputValue())).toBeGreaterThan(15);
    const lat = Number(await page.getByLabel("Target latitude").inputValue()), lon = Number(await page.getByLabel("Target longitude").inputValue());
    expect(Math.abs(lat - 18.38)).toBeLessThan(3);
    expect(Math.abs(lon - 77.58)).toBeLessThan(3);
  });
});

test.describe("Challenge features: conditions, space weather, ground view, field card", () => {
  const SW = { source: "NASA CCMC DONKI", window_days: 30, start: "2026-10-16", end: "2026-11-15", retrieved_at: "2026-11-15T00:00:00Z",
    note: "Notifications never change a calculated number.", excluded_earth_only: [{ type: "RBE", label: "Earth radiation belt enhancement", count: 3 }],
    items: [{ type: "CME", label: "Coronal mass ejection", issued: "2026-11-15T14:32Z", url: "https://ccmc.gsfc.nasa.gov/x", mentions_mars: true, summary: "CME with estimated impact at Mars." }] };
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  const IMG = { rover: { id: "perseverance", name: "Perseverance", region: "Jezero crater", credit: "NASA/JPL-Caltech" }, distance_km: 9,
    note: "Latest raw images … not at your waypoints.", images: [{ url: PIXEL, full_url: PIXEL, sol: 2024, camera: "Mcz Left", taken_utc: null, title: "Sol 2024: Mastcam-Z", credit: "NASA/JPL-Caltech/ASU", page: null }] };

  test("Overview shows season, daylight and NASA space weather; Terrain shows rover images", async ({ page }) => {
    await page.route(/\/api\/conditions\/space-weather/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SW) }));
    await page.route(/\/api\/conditions\/surface-images/, r => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(IMG) }));
    await openApp(page);
    const cond = page.locator(".panel", { hasText: "Conditions at the base" });
    await expect(cond).toContainText(/Ls \d+\.\d°/);
    await expect(cond).toContainText(/Mars Year \d+/);
    await expect(cond).toContainText(/Daylight|Polar/);
    await expect(cond).toContainText(/daylight|outside daylight|Polar/);
    await expect(page.locator(".panel", { hasText: "Space weather" })).toContainText("mentions Mars");
    await expect(page.locator(".panel", { hasText: "Space weather" })).toContainText("Earth radiation belt enhancement");
    await gotoTab(page, "terrain");
    await expect(page.locator(".gallery img")).toHaveCount(1);
    await expect(page.locator(".panel", { hasText: "Ground view from NASA rovers" })).toContainText("not at your waypoints");
  });

  test("field card lists legs and the visor steps through them", async ({ page }) => {
    await openApp(page);
    await gotoTab(page, "field");
    const rows = page.locator("table.t", { hasText: "Bearing" }).locator("tbody tr");
    await expect(rows.first()).toBeVisible({ timeout: 20_000 });
    expect(await rows.count()).toBeGreaterThan(3);
    await expect(page.locator(".stat", { hasText: "Back at base" })).toBeVisible();
    await page.getByRole("button", { name: "Visor mode" }).click();
    const visor = page.getByRole("dialog", { name: /Visor view, leg 1 of/ });
    await expect(visor).toBeVisible();
    await expect(visor).toContainText("NO LIVE POSITION");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("dialog", { name: /Visor view, leg 2 of/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /Visor view/ })).toBeHidden();
  });
});
