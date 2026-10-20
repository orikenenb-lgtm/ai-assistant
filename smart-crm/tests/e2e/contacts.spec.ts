import { expect, test } from "@playwright/test";
import path from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";
import { signUpWithOrg } from "./helpers";

test.describe("contacts", () => {
  test("create → search → detail → note → file → tags → consent → edit → delete", async ({ page }) => {
    await signUpWithOrg(page, "אנשי קשר בע״מ");
    await page.goto("/contacts");
    await expect(page.getByText("עוד אין אנשי קשר")).toBeVisible();

    await page.getByRole("button", { name: "איש קשר חדש" }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#firstName").fill("רונית");
    await dialog.locator("#lastName").fill("לוי");
    await dialog.locator("#phone").fill("050-7654321");
    await dialog.locator("#email").fill("ronit@example.test");
    await dialog.getByRole("button", { name: "יצירה" }).click();

    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { name: "רונית לוי" })).toBeVisible();
    await expect(page.getByText("050-765-4321")).toBeVisible();
    await expect(page.getByText("איש קשר נוצר")).toBeVisible();

    // Note → appears in notes and on the timeline.
    await page.getByRole("tab", { name: "הערות" }).click();
    await page.getByPlaceholder(/כתבו הערה/).fill("מעוניינת בקטלוג החורף");
    await page.getByRole("button", { name: "הוספת הערה" }).click();
    await expect(page.getByText("מעוניינת בקטלוג החורף")).toBeVisible();

    // File upload + authorized download link.
    await page.getByRole("tab", { name: "קבצים" }).click();
    // In-memory payload: non-ASCII *paths* are unreliable in the sandbox browser; names are fine.
    await page.locator('input[type="file"]').setInputFiles({ name: "הצעה.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n% test\n") });
    await expect(page.getByText("הצעה.pdf")).toBeVisible();
    const href = await page.getByRole("link", { name: "הורדה" }).getAttribute("href");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-disposition"]).toContain("attachment");

    // Tag created inline.
    await page.getByRole("button", { name: "תגית" }).click();
    await page.getByPlaceholder("חיפוש תגית…").fill("VIP");
    await page.getByRole("button", { name: 'יצירת התגית "VIP"' }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "הסרת התגית VIP" })).toBeVisible();

    // Opt-out.
    await page.getByRole("button", { name: "סימון הסרה" }).click();
    await expect(page.getByText("WhatsApp: הוסר")).toBeVisible();

    // Edit.
    await page.getByRole("button", { name: "עריכה" }).click();
    await page.getByRole("dialog").locator("#lastName").fill("לוי-כהן");
    await page.getByRole("dialog").getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("heading", { name: "רונית לוי-כהן" })).toBeVisible();

    // Search from the list.
    await page.goto("/contacts");
    await page.getByRole("searchbox").fill("כהן");
    await expect(page.getByTestId("contact-row")).toHaveCount(1);
    await page.getByRole("searchbox").fill("לא-קיים");
    await expect(page.getByText("לא נמצאו תוצאות")).toBeVisible();

    // Command palette search.
    await page.getByTestId("open-command-palette").click();
    await page.getByTestId("command-input").fill("רונית");
    await page.getByRole("option", { name: /רונית/ }).click();
    await expect(page.getByRole("heading", { name: "רונית לוי-כהן" })).toBeVisible();

    // Delete.
    await page.getByRole("button", { name: "מחיקה" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מחיקה" }).click();
    await expect(page).toHaveURL(/\/contacts$/);
    await expect(page.getByText("עוד אין אנשי קשר")).toBeVisible();
  });

  test("CSV import, duplicate detection and merge", async ({ page }) => {
    await signUpWithOrg(page, "ייבוא בע״מ");
    const dir = path.resolve("test-results/fixtures");
    mkdirSync(dir, { recursive: true });
    const csv = path.join(dir, "contacts.csv");
    writeFileSync(csv, "﻿שם מלא,טלפון,אימייל,חברה\nדנה כהן,050-1111111,dana@x.test,צעצועים בע״מ\nדני כהן,0501111111,,צעצועים בע״מ\nאבי לוי,052-2222222,avi@x.test,\n");
    await page.goto("/contacts/import");
    await page.getByTestId("csv-input").setInputFiles(csv);
    await expect(page.getByLabel("שם מלא", { exact: true })).toHaveValue("fullName");
    await expect(page.getByLabel("טלפון", { exact: true })).toHaveValue("phone");
    await page.getByRole("button", { name: "ייבוא" }).last().click();
    await expect(page.getByText("הייבוא הושלם")).toBeVisible();
    // Row 3 duplicates row 2's phone → skipped.
    await expect(page.locator("div.rounded-xl", { hasText: "נוצרו" }).last()).toContainText("2");

    await page.goto("/contacts");
    await expect(page.getByTestId("contact-row")).toHaveCount(2);

    // Create a duplicate manually: the form warns about it.
    await page.getByRole("button", { name: "איש קשר חדש" }).first().click();
    await page.getByRole("dialog").locator("#firstName").fill("דנה");
    await page.getByRole("dialog").locator("#phone").fill("0501111111");
    await page.getByRole("dialog").locator("#email").focus();
    await expect(page.getByText("ייתכן שקיים כבר איש קשר")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "יצירה" }).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

    await page.goto("/contacts/duplicates");
    await expect(page.getByText("אותו טלפון", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "מיזוג" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "מיזוג" }).click();
    await expect(page.getByText("לא נמצאו כפילויות")).toBeVisible();
  });
});
