import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signUpWithOrg } from "./helpers";

/** Connects a mock (demo) WhatsApp number from /settings/whatsapp. */
async function connectMockAccount(page: Page, displayName: string) {
  await page.goto("/settings/whatsapp");
  await page.getByRole("button", { name: "חיבור מספר" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator("#wa-provider")).toHaveValue("mock");
  await expect(dialog.getByText("מצב הדגמה שומר הכל מקומית")).toBeVisible();
  await dialog.locator("#wa-displayName").fill(displayName);
  await dialog.locator("#wa-phoneNumber").fill("03-555-1234");
  await dialog.locator("#wa-phoneNumberId").fill(`pn_${randomUUID().slice(0, 12)}`);
  await dialog.locator("#wa-wabaId").fill(`waba_${randomUUID().slice(0, 12)}`);
  await dialog.getByRole("button", { name: "חיבור מספר" }).click();
  await expect(dialog).toBeHidden();
  const card = page.getByTestId("wa-account").filter({ hasText: displayName });
  await expect(card).toBeVisible();
  await expect(card.getByText("הדגמה — לא נשלח באמת")).toBeVisible();
  return card;
}

/** Posts a signed inbound webhook through the dev simulator (real route + job pipeline). */
async function simulateInbound(page: Page, from: string, name: string, text: string) {
  await page.goto("/settings/whatsapp");
  const sim = page.getByTestId("wa-simulator");
  await sim.locator("#sim-from").fill(from);
  await sim.locator("#sim-name").fill(name);
  await sim.locator("#sim-text").fill(text);
  await sim.getByRole("button", { name: "הדמיית הודעה נכנסת" }).click();
  await expect(page.getByText("ההודעה הנכנסת התקבלה")).toBeVisible();
}

const lastStatus = (page: Page) => page.getByTestId("message-status").last();

test.describe("whatsapp inbox", () => {
  test("connect mock number → inbound → reply → ticks → assign → note → close", async ({ page }) => {
    await signUpWithOrg(page, "תיבת וואטסאפ בע״מ");

    await page.goto("/inbox");
    await expect(page.getByText("עדיין לא חיברתם מספר WhatsApp")).toBeVisible();
    await page.getByRole("link", { name: "חיבור WhatsApp" }).click();
    await expect(page).toHaveURL(/\/settings\/whatsapp$/);

    const card = await connectMockAccount(page, "מוקד מכירות");
    // Webhook instructions show the callback URL, never secrets.
    await expect(page.getByText("/api/webhooks/whatsapp")).toBeVisible();
    await expect(page.getByText("e2e-meta-secret")).toHaveCount(0);

    await card.getByRole("button", { name: "סנכרון מ-Meta" }).click();
    await expect(page.getByText("סונכרנו 4 תבניות")).toBeVisible();
    await expect(card.getByTestId("wa-template")).toHaveCount(4);
    await card.getByRole("button", { name: "בדיקת חיבור" }).click();
    await expect(page.getByText("החיבור תקין")).toBeVisible();

    await simulateInbound(page, "050-111-2233", "דנה כהן", "שלום");

    await page.goto("/inbox");
    const row = page.getByTestId("conversation-row").filter({ hasText: "דנה כהן" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("שלום");
    await row.click();
    await expect(page).toHaveURL(/\/inbox\?c=[0-9a-f-]{36}$/);
    await expect(page.getByTestId("message").filter({ hasText: "שלום" })).toHaveAttribute("data-direction", "inbound");
    await expect(page.getByTestId("window-indicator")).toContainText("חלון השירות פתוח");

    // Reply inside the 24h window → queued → delivered by the (dev) worker → sent.
    await page.getByRole("textbox", { name: "הודעה" }).fill("היי דנה, איך אפשר לעזור?");
    await page.keyboard.press("Enter");
    const outbound = page.getByTestId("message").filter({ hasText: "היי דנה, איך אפשר לעזור?" });
    await expect(outbound).toHaveAttribute("data-direction", "outbound");
    await expect(lastStatus(page)).toHaveAttribute("data-status", "sent");

    // Status webhooks (signed, through the real route) advance the ticks.
    for (const [label, status] of [
      ["סימון כנמסרה", "delivered"],
      ["סימון כנקראה", "read"],
    ] as const) {
      await page.getByRole("button", { name: "סימולציה (פיתוח בלבד)" }).click();
      await page.getByRole("menuitem", { name: label }).click();
      await expect(lastStatus(page)).toHaveAttribute("data-status", status);
    }

    // Assign to self (owner sees the assignee picker).
    await page.getByRole("combobox", { name: "משויך ל" }).selectOption({ label: "נועה לוי" });
    await expect(row).toContainText("נועה לוי");

    // Internal note — visible to the team only.
    await page.getByRole("tab", { name: "הערה פנימית" }).click();
    await page.getByRole("textbox", { name: "הערה פנימית" }).fill("לקוחה חוזרת — לבדוק הנחה");
    await page.getByRole("button", { name: "הוספת הערה" }).click();
    await expect(page.getByTestId("internal-note").filter({ hasText: "לקוחה חוזרת — לבדוק הנחה" })).toBeVisible();

    // Close → leaves the "open" list, shows under "closed".
    await page.getByRole("group", { name: "סטטוס" }).getByRole("button", { name: "סגורה" }).click();
    await expect(page.getByRole("group", { name: "סטטוס" }).getByRole("button", { name: "סגורה" })).toHaveAttribute("aria-pressed", "true");
    await expect(row).toHaveCount(0);
    await page.getByRole("combobox", { name: "סטטוס" }).selectOption("closed");
    await expect(page.getByTestId("conversation-row").filter({ hasText: "דנה כהן" })).toBeVisible();
  });

  test("opt-out keyword blocks replies; contact page opens the conversation", async ({ page }) => {
    await signUpWithOrg(page, "הסרה בע״מ");
    await connectMockAccount(page, "קו שירות");
    await simulateInbound(page, "052-999-8877", "יוסי לוי", "הסר");

    await page.goto("/inbox");
    const row = page.getByTestId("conversation-row").filter({ hasText: "יוסי לוי" });
    await row.click();
    await expect(page.getByRole("status").filter({ hasText: "איש הקשר ביקש להסיר אותו" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "הודעה" })).toHaveCount(0);

    // Contact card → WhatsApp button → /inbox?contact=<id> resolves to the same conversation.
    const conversationUrl = page.url();
    await page.getByRole("link", { name: "לכרטיס איש הקשר" }).click();
    await expect(page.getByRole("heading", { name: "יוסי לוי" })).toBeVisible();
    await expect(page.getByText("WhatsApp: הוסר")).toBeVisible();
    await page.getByRole("link", { name: "WhatsApp", exact: true }).click();
    await expect(page).toHaveURL(conversationUrl);
    await expect(page.getByTestId("message").filter({ hasText: "הסר" })).toBeVisible();
  });
});
