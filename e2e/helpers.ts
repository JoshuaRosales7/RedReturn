import { expect, type Page } from "@playwright/test";

export const API = process.env.E2E_API_URL || "http://localhost:8000";
export const TAB_KEYS = { overview: "1", explorer: "2", terrain: "3", planner: "4", risk: "5", emergency: "6", ares: "7", reports: "8", field: "9" } as const;

/** Open the app and wait until the demo has been loaded and planned. */
export async function openApp(page: Page, opts: { offline?: boolean; tour?: boolean } = {}) {
  if (!opts.tour) await page.addInitScript(() => { try { localStorage.setItem("redreturn.tour.v1", "done"); } catch { /* ignore */ } });   // the guided tour is covered by its own test
  if (opts.offline) await page.route(url => url.href.startsWith(API), r => r.abort("connectionrefused"));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Can the crew reach the target/ })).toBeVisible();
  await expect(page.locator(".chip", { hasText: opts.offline ? "API offline" : "API online" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".stat", { hasText: "Recommended" })).toBeVisible({ timeout: 30_000 });
}

export async function gotoTab(page: Page, tab: keyof typeof TAB_KEYS) {
  await page.locator("body").click({ position: { x: 2, y: 2 } });
  await page.keyboard.press(TAB_KEYS[tab]);
}
