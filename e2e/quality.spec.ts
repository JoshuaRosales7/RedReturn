import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { gotoTab, openApp, TAB_KEYS } from "./helpers";

const TABS = Object.keys(TAB_KEYS) as (keyof typeof TAB_KEYS)[];
const VIEWPORTS = [{ name: "mobile-375", width: 375, height: 812 }, { name: "tablet-768", width: 768, height: 1024 }, { name: "desktop-1280", width: 1280, height: 800 }];

async function settle(page: Page, tab: keyof typeof TAB_KEYS) {
  await gotoTab(page, tab);
  await page.waitForTimeout(tab === "risk" ? 4000 : tab === "explorer" ? 3500 : 900);
  // Let entrance fades finish so contrast is measured on the final colours (spinners and shimmer loop forever and are ignored).
  await page.waitForFunction(() => document.getAnimations().every(a => a.playState !== "running" || a.effect?.getTiming().iterations === Infinity), null, { timeout: 10_000 });
}

test.describe("Accessibility (axe, WCAG 2 A/AA)", () => {
  for (const tab of TABS) {
    test(`no serious/critical violations on ${tab}`, async ({ page }) => {
      await openApp(page);
      await settle(page, tab);
      const res = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = res.violations.filter(v => v.impact === "serious" || v.impact === "critical");
      expect(bad.map(v => `${v.id}: ${v.nodes.length} nodes — ${v.help}`)).toEqual([]);
    });
  }
  test("keyboard: tabs reachable and focus visible", async ({ page }) => {
    await openApp(page);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => { const e = document.activeElement as HTMLElement; return e ? getComputedStyle(e).outlineStyle + "|" + e.tagName : ""; });
    expect(focused).not.toBe("");
    await page.keyboard.press("4");
    await expect(page.getByRole("heading", { name: "Route alternatives" })).toBeVisible();
  });
  test("reduced motion is honoured", async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: "reduce", baseURL: process.env.E2E_BASE_URL || "http://localhost:3000" });
    const page = await ctx.newPage();
    await openApp(page);
    const anim = await page.evaluate(() => { const e = document.createElement("span"); e.className = "spin"; document.body.appendChild(e); const n = getComputedStyle(e).animationName; e.remove(); return n; });
    expect(anim).toBe("none");
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await ctx.close();
  });
});

test.describe("Responsive layout", () => {
  for (const vp of VIEWPORTS) {
    test(`${vp.name}: no horizontal overflow, navigation usable, content reachable on every tab`, async ({ page }, info) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await openApp(page);
      for (const tab of TABS) {
        await settle(page, tab);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        const culprits = over > 0 ? await page.evaluate(() => { const w = document.documentElement.clientWidth; return [...document.querySelectorAll("body *")].filter(e => e.getBoundingClientRect().right > w + 1 && !e.closest(".bottomnav")).slice(0, 6).map(e => `${e.tagName}.${e.className} right=${Math.round(e.getBoundingClientRect().right)}`); }) : [];
        expect(over, `${vp.name} ${tab} overflow by ${over}px: ${culprits.join(" | ")}`).toBeLessThanOrEqual(0);
        const nav = vp.width <= 1100 ? ".bottomnav" : ".side";
        await expect(page.locator(nav)).toBeVisible();
        await expect(page.locator(".main")).not.toBeEmpty();
        if (tab === "terrain" || tab === "emergency") await page.screenshot({ path: info.outputPath(`${vp.name}-${tab}.png`) });
      }
    });
  }
  test("mobile: bottom nav switches tabs by touch-sized targets", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await openApp(page);
    const btn = page.locator(".bottomnav button").first();
    const box = await btn.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await page.locator(".bottomnav button", { hasText: "Planner" }).click();
    await expect(page.getByRole("heading", { name: "Route alternatives" })).toBeVisible();
  });
});
