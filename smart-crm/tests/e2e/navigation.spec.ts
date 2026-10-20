import { expect, test } from "@playwright/test";
import { signUpWithOrg } from "./helpers";

test.describe("navigation and error states", () => {
  test("localized 404s, command palette while typing, no hydration errors on the dashboard", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(e.message));

    await signUpWithOrg(page, "ניווט בע״מ");
    // Pages with charts (charts render client-side after mount).
    for (const path of ["/dashboard", "/analytics?tab=revenue", "/analytics?tab=pipeline", "/analytics?tab=team"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
    }
    expect(errors.filter((e) => /hydrat|#418|did not match/i.test(e))).toEqual([]);

    // Missing record inside the app shell, and an unknown route.
    await page.goto("/contacts/not-a-uuid");
    await expect(page.getByRole("heading", { name: "הדף לא נמצא" })).toBeVisible();
    await expect(page.getByRole("link", { name: "חזרה ללוח הבקרה" })).toBeVisible();
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "הדף לא נמצא" })).toBeVisible();

    // Commands remain available while typing in the palette.
    await page.goto("/dashboard");
    await page.keyboard.press("Control+k");
    await page.getByTestId("command-input").fill("עסקה");
    await expect(page.getByRole("option", { name: "עסקה חדשה" })).toBeVisible();
    await page.getByRole("option", { name: "עסקה חדשה" }).click();
    await expect(page).toHaveURL(/\/deals\?new=1/);
  });
});
