import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { revealAll, trackErrors } from "./helpers";

test("home page renders every section without errors", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("הטלפון מצלצל");

  for (const name of [
    "מכירים את השיחות האלה?",
    "מה יוצא משיחה אחת.",
    "כל מה שצריך, בחבילה אחת.",
    "ככה זה נשמע בעסק כמו שלכם.",
    "כמה עולה לכם המענה הטלפוני היום?",
    "מתחברת למה שכבר עובד אצלכם.",
    "מחיר חודשי אחד. בלי הפתעות.",
    "שאלות לפני שמתחילים.",
  ]) {
    await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
  }
  // JSON-LD for search engines
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents();
  expect(ld.join(" ")).toContain("FAQPage");
  expect(errors).toEqual([]);
});

for (const theme of ["light", "dark"] as const) {
test(`no serious accessibility violations (axe, WCAG 2 AA, ${theme})`, async ({ page }) => {
  await page.addInitScript((t) => localStorage.setItem("theme", t), theme);
  for (const path of ["/", "/privacy", "/accessibility", "/terms"]) {
    await page.goto(path);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await revealAll(page);
    await page.waitForTimeout(900); // let reveal transitions finish before color-contrast checks
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(
      serious.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`),
    ).toEqual([]);
  }
});
}

test("dark mode toggle persists", async ({ page }) => {
  await page.goto("/");
  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "מעבר למצב כהה" }).click();
  await expect(html).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(html).toHaveAttribute("data-theme", "dark");
});

test("industries tabs work with mouse and keyboard", async ({ page }) => {
  await page.goto("/#industries");
  const tabs = page.getByRole("tablist", { name: "תחומים" });
  await tabs.getByRole("tab", { name: "מוסכים" }).click();
  await expect(page.locator("#industries").getByRole("tabpanel")).toContainText("טיפול 30 אלף");
  await page.keyboard.press("ArrowLeft");
  await expect(tabs.getByRole("tab", { name: "משרדי עורכי דין" })).toHaveAttribute("aria-selected", "true");
  await expect(tabs.getByRole("tab", { name: "משרדי עורכי דין" })).toBeFocused();
});

test("ROI calculator reacts to input", async ({ page }) => {
  await page.goto("/#roi");
  const calls = page.getByLabel("כמה שיחות יש לכם בחודש?");
  const savings = page.locator("#roi").getByText("חוסכים בחודש").locator("..");
  const before = await savings.textContent();
  await calls.fill("1500");
  await expect(savings).not.toHaveText(before ?? "");
  await expect(page.locator("#roi")).toContainText("4,500 דקות בחודש");
});

test("legal pages and 404 render", async ({ page }) => {
  for (const [path, title] of [
    ["/privacy", "מדיניות פרטיות"],
    ["/terms", "תנאי שימוש"],
    ["/accessibility", "הצהרת נגישות"],
  ]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  }
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("העמוד לא נמצא");
});

test("SEO routes", async ({ request }) => {
  const robots = await request.get("/robots.txt");
  expect(await robots.text()).toContain("Sitemap:");
  const sitemap = await request.get("/sitemap.xml");
  expect(await sitemap.text()).toContain("/privacy");
  const manifest = await request.get("/manifest.webmanifest");
  expect((await manifest.json()).dir).toBe("rtl");
});
