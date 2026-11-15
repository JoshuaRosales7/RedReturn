import { defineConfig, devices } from "@playwright/test";

/** Runs against an already-running stack (docker compose up: web :3000, api :8000). Uses the system Chrome (no browser download). */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [["list"], ["json", { outputFile: "test-results/e2e.json" }]],
  use: { baseURL: process.env.E2E_BASE_URL || "http://localhost:3000", trace: "retain-on-failure", screenshot: "only-on-failure", acceptDownloads: true },
  // Locally: system Chrome (no download). In CI: Playwright-installed Chromium.
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], ...(process.env.CI ? {} : { channel: "chrome" }) } }],
});
