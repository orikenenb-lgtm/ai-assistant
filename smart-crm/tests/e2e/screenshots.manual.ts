// Manual visual check helper (not part of the test suite): npx tsx tests/e2e/screenshots.manual.ts <outDir>
import { chromium } from "@playwright/test";

const out = process.argv[2];
const base = process.env.BASE ?? "http://localhost:3100";
const email = process.env.SHOT_EMAIL;
const password = process.env.SHOT_PASSWORD ?? "E2e!Password123";
const paths = (process.env.SHOT_PATHS ?? "/login").split(",");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
for (const scheme of ["light", "dark"] as const) {
  for (const vp of [{ name: "desktop", width: 1440, height: 900 }, { name: "mobile", width: 390, height: 844 }]) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, locale: "he-IL" });
    const page = await ctx.newPage();
    if (email) {
      await page.goto(`${base}/login`);
      await page.locator("#email").fill(email);
      await page.locator("#password").fill(password);
      await page.locator("button[type=submit]").click();
      await page.waitForURL(/dashboard|onboarding/);
    }
    for (const p of paths) {
      await page.goto(`${base}${p}`);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: `${out}/${p.replaceAll("/", "_") || "root"}-${vp.name}-${scheme}.png`, fullPage: false });
    }
    await ctx.close();
  }
}
await browser.close();
