import { expect, test } from "@playwright/test";
import { linkFromMailbox, newEmail, signUpWithOrg } from "./helpers";

test.describe("quotes", () => {
  test("create 2 items → totals → PDF → send → customer accepts via public link → owner sees accepted", async ({ page, browser }) => {
    await signUpWithOrg(page, "הצעות מחיר בע״מ");

    // A contact with an email so the send dialog can also email the link.
    const customerEmail = newEmail("customer");
    await page.goto("/contacts");
    await page.getByRole("button", { name: "איש קשר חדש" }).first().click();
    const contactDialog = page.getByRole("dialog");
    await contactDialog.locator("#firstName").fill("דנה");
    await contactDialog.locator("#lastName").fill("כהן");
    await contactDialog.locator("#email").fill(customerEmail);
    await contactDialog.getByRole("button", { name: "יצירה" }).click();
    await expect(page).toHaveURL(/\/contacts\/[0-9a-f-]{36}$/);

    // New quote from the empty list.
    await page.goto("/quotes");
    await expect(page.getByText("עוד אין הצעות מחיר")).toBeVisible();
    await page.getByRole("link", { name: "הצעת מחיר חדשה" }).first().click();
    await expect(page).toHaveURL(/\/quotes\/new$/);

    await page.locator("#title").fill("הצעת מחיר לחנוכה");
    await page.locator("#contact").click();
    await page.getByPlaceholder("חיפוש…").fill("דנה");
    await page.getByRole("option", { name: "דנה כהן" }).click();
    await expect(page.locator("#contact")).toContainText("דנה כהן");

    await page.getByLabel("תיאור 1", { exact: true }).fill("בובת פרווה (Teddy) 30 ס״מ");
    await page.getByLabel("כמות 1", { exact: true }).fill("2");
    await page.getByLabel("מחיר יחידה 1", { exact: true }).fill("100");
    await page.getByRole("button", { name: "הוספת פריט" }).click();
    await page.getByLabel("תיאור 2", { exact: true }).fill("משלוח");
    await page.getByLabel("כמות 2", { exact: true }).fill("1.5");
    await page.getByLabel("מחיר יחידה 2", { exact: true }).fill("40");
    await page.getByLabel("הנחה % 2", { exact: true }).fill("10");
    await expect(page.getByTestId("quote-item")).toHaveCount(2);

    // 2×100 + 1.5×40×0.9 = 254 → VAT 18% 45.72 → 299.72 (default VAT from settings).
    await expect(page.getByTestId("quote-totals")).toContainText("254");
    await expect(page.getByTestId("quote-totals")).toContainText("45.72");
    await expect(page.getByTestId("quote-total")).toContainText("299.72");

    await page.getByRole("button", { name: "שמירת טיוטה" }).click();
    await expect(page).toHaveURL(/\/quotes\/[0-9a-f-]{36}$/);
    await expect(page.getByTestId("quote-status")).toHaveText("טיוטה");
    await expect(page.getByTestId("quote-total")).toContainText("299.72");
    const quoteUrl = page.url();

    // Staff PDF download.
    const pdfHref = await page.getByTestId("quote-pdf").getAttribute("href");
    const pdf = await page.request.get(pdfHref!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain("attachment");
    expect((await pdf.body()).subarray(0, 5).toString("latin1")).toBe("%PDF-");

    // Send: email prefilled from the contact; the raw link is shown once.
    await page.getByTestId("quote-send").click();
    const sendDialog = page.getByRole("dialog");
    await expect(sendDialog.locator("#emailTo")).toHaveValue(customerEmail);
    await sendDialog.getByTestId("quote-send-confirm").click();
    const linkDialog = page.getByTestId("quote-link-dialog");
    await expect(linkDialog.getByText("ההצעה נשלחה")).toBeVisible();
    await expect(linkDialog.getByText(`נשלח מייל ל-${customerEmail}`)).toBeVisible();
    const publicUrl = await linkDialog.getByTestId("quote-public-link").inputValue();
    expect(publicUrl).toMatch(/\/q\/[A-Za-z0-9_-]{20,}$/);
    await expect(page.getByTestId("quote-status")).toHaveText("נשלחה");
    await linkDialog.getByRole("button", { name: "סגירה" }).first().click();
    await expect(linkDialog).toHaveCount(0);
    await expect(page.getByText("הצעה שנשלחה אינה ניתנת לעריכה")).toBeVisible();

    // The emailed link is the same customer link.
    const mailed = await linkFromMailbox(page, customerEmail, "/q/");
    expect(new URL(mailed).pathname).toBe(new URL(publicUrl).pathname);

    // Customer: fresh browser context, no session.
    const customer = await browser.newContext({ locale: "he-IL" });
    const cp = await customer.newPage();
    await cp.goto(publicUrl);
    await expect(cp.getByRole("heading", { name: "הצעת מחיר לחנוכה" })).toBeVisible();
    await expect(cp.getByTestId("quote-total")).toContainText("299.72");
    await expect(cp.getByText("אינה מהווה חשבונית מס")).toBeVisible();
    const publicPdf = await cp.request.get(`${new URL(publicUrl).pathname}/pdf`);
    expect(publicPdf.status()).toBe(200);
    expect(publicPdf.headers()["content-type"]).toBe("application/pdf");

    await cp.locator("#signer-name").fill("דנה כהן");
    await cp.getByTestId("quote-accept").click();
    await expect(cp.getByText("ההצעה אושרה על ידי דנה כהן")).toBeVisible();
    await expect(cp.getByTestId("quote-accept")).toHaveCount(0);
    await customer.close();

    // Owner sees the decision and the tracking timeline.
    await page.goto(quoteUrl);
    await expect(page.getByTestId("quote-status")).toHaveText("אושרה");
    const timeline = page.getByTestId("quote-timeline");
    await expect(timeline).toContainText("נשלחה");
    await expect(timeline).toContainText("נצפתה לראשונה");
    await expect(timeline).toContainText("על ידי דנה כהן");

    await page.goto("/quotes");
    await expect(page.getByTestId("quote-row")).toHaveText("הצעת מחיר לחנוכה");
    await expect(page.getByTestId("quote-status")).toHaveText("אושרה");
  });
});
