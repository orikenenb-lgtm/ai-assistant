import { expect, test } from "@playwright/test";
import { revealAll, trackErrors } from "./helpers";

test("mobile: no horizontal scroll, menu works, sticky CTA appears", async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto("/");
  await revealAll(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);
  // body clips horizontal overflow, so also look for content that sticks out of the viewport
  const offenders = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "auto" || ox === "scroll" || ox === "hidden" || ox === "clip") return true;
      }
      return false;
    };
    return Array.from(document.querySelectorAll("main *, header *, footer *"))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (el.closest('[aria-hidden="true"], .sr-only')) return false;
        return (r.right > vw + 1 || r.left < -1) && !clipped(el);
      })
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
  });
  expect(offenders).toEqual([]);

  await page.getByRole("button", { name: "פתיחת התפריט" }).click();
  const menu = page.getByRole("navigation", { name: "ניווט במובייל" });
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "מחירון" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("heading", { name: "מחיר חודשי אחד. בלי הפתעות." })).toBeInViewport();

  await expect(page.getByRole("link", { name: "השאירו פרטים" })).toBeVisible();
  expect(errors).toEqual([]);
});
