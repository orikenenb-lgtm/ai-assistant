import { expect, test, type Locator, type Page } from "@playwright/test";
import { signUpWithOrg } from "./helpers";

const column = (page: Page, stage: string) => page.getByTestId(`kanban-column-${stage}`);
const card = (scope: Page | Locator, title: string) => scope.getByTestId("deal-card").filter({ hasText: title });

/** Pointer drag from a card's handle to the middle of a column (dnd-kit needs intermediate moves). */
async function dragCard(page: Page, title: string, toStage: string) {
  const handle = page.getByRole("button", { name: `גרירת העסקה ${title}` });
  const from = await handle.boundingBox();
  const to = await column(page, toStage).boundingBox();
  if (!from || !to) throw new Error("missing bounding box");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 10, from.y + from.height / 2 + 10, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + 120, { steps: 20 });
  await page.mouse.up();
}

test.describe("sales", () => {
  test("company → lead → convert → kanban drag & keyboard → won → pipeline settings", async ({ page }) => {
    await signUpWithOrg(page, "מכירות בדיקה בע״מ");

    // --- Company
    await page.goto("/companies");
    await expect(page.getByText("עוד אין חברות")).toBeVisible();
    await page.getByRole("button", { name: "חברה חדשה" }).first().click();
    await page.getByRole("dialog").locator("#name").fill("צעצועי הגליל");
    await page.getByRole("dialog").locator("#city").fill("צפת");
    await page.getByRole("dialog").getByRole("button", { name: "יצירה" }).click();
    await expect(page).toHaveURL(/\/companies\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "צעצועי הגליל" })).toBeVisible();

    // --- Lead
    await page.goto("/leads");
    await page.getByRole("button", { name: "ליד חדש" }).first().click();
    const leadDialog = page.getByRole("dialog");
    await leadDialog.locator("#fullName").fill("דנה כהן");
    await leadDialog.locator("#companyName").fill("צעצועי הגליל");
    await leadDialog.locator("#phone").fill("050-1112233");
    await leadDialog.locator("#email").fill("dana@example.test");
    await leadDialog.locator("#estimatedValue").fill("12000");
    await leadDialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page).toHaveURL(/\/leads\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "דנה כהן" })).toBeVisible();
    await expect(page.getByTestId("lead-status")).toHaveText("חדש");

    await page.getByRole("button", { name: "סימון: מתאים" }).click();
    await expect(page.getByTestId("lead-status")).toHaveText("מתאים");

    // --- Convert to contact + deal (company matched by name, not duplicated)
    await page.getByRole("button", { name: "המרה ללקוח" }).click();
    const convert = page.getByRole("dialog");
    await expect(convert.locator("#dealTitle")).toHaveValue("צעצועי הגליל");
    await expect(convert.locator("#dealValue")).toHaveValue("12000");
    await convert.getByRole("button", { name: "המרה ללקוח" }).click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "צעצועי הגליל" })).toBeVisible();
    await expect(page.getByTestId("deal-value")).toContainText("12,000");
    await expect(page.getByRole("link", { name: "דנה כהן" })).toBeVisible();
    await page.goto("/companies");
    await expect(page.getByTestId("company-row")).toHaveCount(1);

    // A second deal created from the deals page.
    await page.goto("/deals?new=1");
    const dealDialog = page.getByRole("dialog");
    await dealDialog.locator("#title").fill("חנות הצעצוע");
    await dealDialog.locator("#value").fill("8000");
    await dealDialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "חנות הצעצוע" })).toBeVisible();

    // --- Board: both deals start in the first stage
    await page.goto("/deals");
    await expect(card(column(page, "ליד חדש"), "צעצועי הגליל")).toBeVisible();
    await expect(card(column(page, "ליד חדש"), "חנות הצעצוע")).toBeVisible();
    await expect(column(page, "ליד חדש").getByTestId("column-total")).toContainText("20,000");

    // Pointer drag to the next stage.
    await expect(page.getByTestId("kanban")).toHaveAttribute("data-hydrated", "true");
    await dragCard(page, "צעצועי הגליל", "שיחת היכרות");
    await expect(card(column(page, "שיחת היכרות"), "צעצועי הגליל")).toBeVisible();
    await expect(page.getByText("העסקה הועברה לשיחת היכרות")).toBeVisible();
    await expect(column(page, "ליד חדש").getByTestId("column-total")).toContainText("8,000");
    await expect(column(page, "שיחת היכרות").getByTestId("column-total")).toContainText("12,000");
    await page.reload();
    await expect(card(column(page, "שיחת היכרות"), "צעצועי הגליל")).toBeVisible();

    // Keyboard move: space to pick up, arrow towards the next stage (left in RTL), space to drop —
    // each step is announced to screen readers.
    await expect(page.getByTestId("kanban")).toHaveAttribute("data-hydrated", "true");
    const handle = page.getByRole("button", { name: "גרירת העסקה צעצועי הגליל" });
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(handle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByText("העסקה צעצועי הגליל מעל השלב הצעת מחיר.")).toBeAttached();
    await page.keyboard.press("Space");
    await expect(page.getByText("העסקה צעצועי הגליל הונחה בשלב הצעת מחיר.")).toBeAttached();
    await expect(card(column(page, "הצעת מחיר"), "צעצועי הגליל")).toBeVisible();
    await expect(page.getByText("העסקה הועברה להצעת מחיר")).toBeVisible();
    await page.reload();
    await expect(card(column(page, "הצעת מחיר"), "צעצועי הגליל")).toBeVisible();
    await expect(column(page, "הצעת מחיר").getByTestId("column-total")).toContainText("12,000");

    // --- Mark won on the deal page and check the forecast totals
    await card(column(page, "הצעת מחיר"), "צעצועי הגליל").getByRole("link", { name: "צעצועי הגליל" }).click();
    await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "נסגרה בהצלחה" }).click();
    await expect(page.getByTestId("deal-status")).toHaveText("נסגרה בהצלחה");
    await expect(page.getByTestId("stage-history")).toContainText("הצעת מחיר ← נסגר בהצלחה");

    await page.goto("/deals");
    const kpis = page.getByTestId("deal-kpis");
    await expect(kpis.getByText("נסגר החודש").locator("xpath=../..")).toContainText("12,000");
    await expect(kpis.getByText("שווי עסקאות פתוחות").locator("xpath=../..")).toContainText("8,000");
    await expect(card(column(page, "נסגר בהצלחה"), "צעצועי הגליל")).toBeVisible();
    await expect(column(page, "נסגר בהצלחה").getByTestId("column-total")).toContainText("12,000");

    // Lost with a reason (from the deal page) and reopen.
    await card(column(page, "ליד חדש"), "חנות הצעצוע").getByRole("link", { name: "חנות הצעצוע" }).click();
    await page.getByRole("button", { name: "סימון כאבודה" }).click();
    const lost = page.getByRole("dialog");
    await lost.locator("#lostReasonId").selectOption({ label: "מחיר" });
    await lost.locator("#lostNote").fill("הלקוח בחר ספק זול יותר");
    await lost.getByRole("button", { name: "סימון כאבודה" }).click();
    await expect(page.getByTestId("deal-status")).toHaveText("אבודה");
    await expect(page.getByText("סיבת אובדן: מחיר")).toBeVisible();
    await page.getByRole("button", { name: "פתיחה מחדש" }).click();
    await expect(page.getByTestId("deal-status")).toHaveText("פתוחה");

    // --- Settings: add a stage, move it up, and see it on the board
    await page.goto("/settings/pipelines");
    await expect(page.getByTestId("stage-row")).toHaveCount(6);
    await page.getByRole("button", { name: "הוספת שלב" }).click();
    const stageDialog = page.getByRole("dialog");
    await stageDialog.getByLabel("שם השלב").fill("הדגמת מוצר");
    await stageDialog.getByLabel("הסתברות").fill("60");
    await stageDialog.getByRole("button", { name: "הוספה" }).click();
    await expect(page.getByTestId("stage-row")).toHaveCount(7);
    const names = () => page.getByTestId("stage-row").locator("p.truncate").allTextContents();
    await expect.poll(names).toEqual(["ליד חדש", "שיחת היכרות", "הצעת מחיר", "משא ומתן", "הדגמת מוצר", "נסגר בהצלחה", "אבוד"]);
    await page.getByRole("button", { name: "העלאת השלב הדגמת מוצר" }).click();
    await expect.poll(names).toEqual(["ליד חדש", "שיחת היכרות", "הצעת מחיר", "הדגמת מוצר", "משא ומתן", "נסגר בהצלחה", "אבוד"]);

    await page.goto("/deals");
    await expect(column(page, "הדגמת מוצר")).toBeVisible();
  });
});
