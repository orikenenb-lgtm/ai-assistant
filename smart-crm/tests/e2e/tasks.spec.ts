import { expect, test } from "@playwright/test";
import { signUpWithOrg } from "./helpers";

/** Today's date in the tenant zone (the app's default is Asia/Jerusalem). */
function todayInJerusalem(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  return p; // YYYY-MM-DD
}

test.describe("tasks, calendar and notification preferences", () => {
  test("task linked to a contact: due today → complete → appears in completed", async ({ page }) => {
    await signUpWithOrg(page, "משימות בע״מ");

    // A contact to link the task to.
    await page.goto("/contacts?new=1");
    const contactDialog = page.getByRole("dialog");
    await contactDialog.locator("#firstName").fill("יעל");
    await contactDialog.locator("#lastName").fill("שמש");
    await contactDialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
    const contactId = page.url().split("/").pop()!;

    // Prefilled from the contact (?new=1&contact=…).
    await page.goto(`/tasks?new=1&contact=${contactId}`);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("יעל שמש")).toBeVisible();
    await dialog.locator("#task-title").fill("לשלוח קטלוג ליעל");
    await dialog.locator("#task-due").fill(`${todayInJerusalem()}T23:59`);
    await dialog.locator("#task-priority").selectOption("high");
    await dialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByText("המשימה נוצרה")).toBeVisible();

    await page.getByRole("link", { name: /^להיום/ }).click();
    const row = page.getByTestId("task-row").filter({ hasText: "לשלוח קטלוג ליעל" });
    await expect(row).toBeVisible();
    await expect(row.getByRole("link", { name: "יעל שמש" })).toBeVisible();
    await expect(row.getByText("גבוהה")).toBeVisible();

    await row.getByRole("checkbox", { name: "סימון כהושלמה" }).click();
    await expect(page.getByText("כל הכבוד! המשימה הושלמה")).toBeVisible();
    await expect(page.getByTestId("task-row").filter({ hasText: "לשלוח קטלוג ליעל" })).toHaveCount(0);

    await page.getByRole("link", { name: /^הושלמו/ }).click();
    await expect(page.getByTestId("task-row").filter({ hasText: "לשלוח קטלוג ליעל" })).toBeVisible();

    // The contact timeline shows both the creation and the completion.
    await page.goto(`/contacts/${contactId}`);
    await expect(page.getByText("משימה נוצרה")).toBeVisible();
    await expect(page.getByText("משימה הושלמה")).toBeVisible();
  });

  test("calendar event in week view: create → edit → delete", async ({ page }) => {
    await signUpWithOrg(page, "יומן בע״מ");
    await page.goto("/calendar?view=week");
    await expect(page.getByTestId("calendar-title")).toBeVisible();

    await page.getByRole("button", { name: "אירוע חדש", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#ev-title").fill("פגישת הדגמה");
    await dialog.locator("#ev-location").fill("תל אביב");
    await dialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page.getByText("האירוע נוצר")).toBeVisible();

    const event = page.getByTestId("calendar-event").filter({ hasText: "פגישת הדגמה" });
    await expect(event).toBeVisible();
    await expect(event).toContainText("09:00");

    await event.click();
    await page.getByRole("dialog").locator("#ev-title").fill("פגישת הדגמה — עודכן");
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByTestId("calendar-event").filter({ hasText: "פגישת הדגמה — עודכן" })).toBeVisible();

    // Month and agenda views show it too.
    await page.getByRole("link", { name: "סדר יום" }).click();
    // The week grid shows the same event, so wait for the agenda to replace it before clicking.
    await expect(page).toHaveURL(/view=agenda/);
    await expect(page.locator("[data-day]")).toHaveCount(0);
    await expect(page.getByTestId("calendar-event").filter({ hasText: "פגישת הדגמה — עודכן" })).toBeVisible();

    await page.getByTestId("calendar-event").filter({ hasText: "פגישת הדגמה — עודכן" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה" }).click();
    await page.getByRole("dialog").last().getByRole("button", { name: "מחיקה" }).click();
    await expect(page.getByText("האירוע נמחק")).toBeVisible();
    await expect(page.getByTestId("calendar-event").filter({ hasText: "פגישת הדגמה" })).toHaveCount(0);
  });

  test("notification preference toggle persists", async ({ page }) => {
    await signUpWithOrg(page, "התראות בע״מ");
    await page.goto("/settings/notifications");
    const email = page.getByRole("switch", { name: "תזכורות למשימות — באימייל" });
    await expect(email).toHaveAttribute("aria-checked", "false");
    await email.click();
    await expect(page.getByText("ההעדפה נשמרה")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", { name: "תזכורות למשימות — באימייל" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "תזכורות למשימות — באפליקציה" })).toHaveAttribute("aria-checked", "true");
  });
});
