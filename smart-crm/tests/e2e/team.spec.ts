import { expect, test } from "@playwright/test";
import { linkFromMailbox, login, newEmail, registerAndVerify, signUpWithOrg } from "./helpers";

test.describe("team", () => {
  test("owner invites an agent → agent registers and accepts → owner promotes to manager", async ({ page, browser }) => {
    test.setTimeout(120_000);
    await signUpWithOrg(page, "צוות כרם בדיקות");
    const agentEmail = newEmail("agent");

    await page.goto("/settings/team");
    await expect(page.getByTestId("member-row")).toHaveCount(1);
    await page.getByRole("button", { name: "הזמנת חבר/ת צוות" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#invite-email").fill(agentEmail);
    await expect(dialog.getByRole("radio", { name: /נציג\/ה/ })).toBeChecked();
    await dialog.getByRole("button", { name: "שליחת הזמנה" }).click();
    await expect(page.getByTestId("invitation-row").filter({ hasText: agentEmail })).toBeVisible();

    const inviteLink = await linkFromMailbox(page, agentEmail, "/invite/");

    // The invitee works in a separate browser session.
    const agentContext = await browser.newContext({ baseURL: test.info().project.use.baseURL, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
    const agent = await agentContext.newPage();
    await registerAndVerify(agent, { email: agentEmail, name: "דני הנציג" });
    await login(agent, agentEmail);
    await expect(agent).toHaveURL(/\/onboarding/);
    await agent.goto(inviteLink);
    await expect(agent.getByRole("heading", { name: "הצטרפות ל-צוות כרם בדיקות" })).toBeVisible();
    await agent.getByRole("button", { name: "קבלת ההזמנה" }).click();
    await expect(agent).toHaveURL(/\/dashboard/);
    await expect(agent.getByTestId("org-switcher")).toContainText("צוות כרם בדיקות");
    await agentContext.close();

    await page.goto("/settings/team");
    const row = page.getByTestId("member-row").filter({ hasText: agentEmail });
    await expect(row).toContainText("דני הנציג");
    await expect(row).toContainText("נציג/ה");
    await expect(page.getByTestId("invitation-row")).toHaveCount(0);

    await row.getByRole("button", { name: "פעולות: דני הנציג" }).click();
    await page.getByRole("menuitem", { name: "מנהל/ת" }).click();
    await expect(page.getByText("התפקיד עודכן")).toBeVisible();
    await expect(row).toContainText("מנהל/ת");
  });
});
