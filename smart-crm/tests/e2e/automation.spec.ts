import { expect, test } from "@playwright/test";
import { signUpWithOrg } from "./helpers";

const CRON = { Authorization: "Bearer e2e-cron-secret" };

test.describe("automations", () => {
  test("build → publish → event fires → action runs → run history", async ({ page }) => {
    await signUpWithOrg(page, "אוטומציות בע״מ");
    await page.goto("/automations");
    await expect(page.getByText("עוד אין אוטומציות")).toBeVisible();

    // Create from the blank template (trigger: contact created).
    await page.getByRole("button", { name: "אוטומציה חדשה" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#wf-new-name").fill("ברוכים הבאים");
    await dialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page).toHaveURL(/\/automations\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("region", { name: "קנבס תהליך העבודה" })).toBeVisible();

    // Add an action after the trigger and configure it.
    await page.getByRole("button", { name: "פעולה", exact: true }).click();
    await expect(page.locator("#action-type")).toBeVisible();
    await page.locator("#action-type").selectOption("add_note");
    await page.locator("#param-body").fill("ברוכים הבאים {{contact.firstName}}!");
    await expect(page.getByText("יש שינויים שלא נשמרו")).toBeVisible();

    await page.getByRole("button", { name: "פרסום והפעלה" }).click();
    await expect(page.getByText("פורסם (גרסה 1)")).toBeVisible();
    await expect(page.getByText("פעיל", { exact: true })).toBeVisible();

    // Fire the trigger by creating a contact.
    await page.goto("/contacts");
    await page.getByRole("button", { name: "איש קשר חדש" }).first().click();
    const contactDialog = page.getByRole("dialog");
    await contactDialog.locator("#firstName").fill("דנה");
    await contactDialog.locator("#lastName").fill("כהן");
    await contactDialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
    const contactUrl = page.url();

    // Process the queue (event fan-out → automation step) the same way Vercel Cron does.
    for (let i = 0; i < 3; i++) {
      const res = await page.request.post("/api/cron/jobs", { headers: CRON });
      expect(res.status()).toBe(200);
    }
    expect((await page.request.post("/api/cron/jobs")).status()).toBe(401);

    await page.goto(contactUrl);
    await page.getByRole("tab", { name: "הערות" }).click();
    await expect(page.getByText("ברוכים הבאים דנה!")).toBeVisible();

    // Run history shows the completed run and its step log.
    await page.goto("/automations");
    await page.getByRole("link", { name: "ברוכים הבאים" }).click();
    await page.getByRole("link", { name: "היסטוריית הרצות" }).click();
    await expect(page.locator("tbody").getByText("הושלם").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "דנה כהן" })).toBeVisible();
    await page.locator("tbody").getByRole("button", { expanded: false }).first().click();
    await expect(page.getByRole("list", { name: "יומן צעדים" })).toContainText("פעולה");
  });
});
