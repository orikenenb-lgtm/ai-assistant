import { expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

export const PASSWORD = "E2e!Password123";

export function newEmail(prefix = "e2e") {
  return `${prefix}-${randomUUID().slice(0, 8)}@example.test`;
}

/** Finds the newest link for `email` in the dev mailbox that contains `fragment`. */
export async function linkFromMailbox(page: Page, email: string, fragment: string): Promise<string> {
  await page.goto("/dev/mailbox");
  const card = page.getByTestId("dev-email").filter({ hasText: email }).first();
  await expect(card).toBeVisible();
  const href = await card.getByTestId("dev-email-link").filter({ hasText: fragment }).first().getAttribute("href");
  if (!href) throw new Error(`no ${fragment} link for ${email}`);
  return href;
}

export async function registerAndVerify(page: Page, opts: { email?: string; name?: string } = {}) {
  const email = opts.email ?? newEmail();
  await page.goto("/register");
  await page.locator("#fullName").fill(opts.name ?? "נועה לוי");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(PASSWORD);
  await page.locator("#confirmPassword").fill(PASSWORD);
  await page.getByRole("button", { name: "הרשמה" }).click();
  await expect(page.getByText("בדקו את תיבת המייל")).toBeVisible();
  const link = await linkFromMailbox(page, email, "/auth/confirm");
  await page.goto(link);
  await expect(page.getByText("המייל אומת!")).toBeVisible();
  return email;
}

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "התחברות" }).click();
}

/** Fresh user with a verified email and a new organization; lands on the dashboard. */
export async function signUpWithOrg(page: Page, orgName = "כרם טויס בדיקות") {
  const email = await registerAndVerify(page);
  await login(page, email);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.locator("#name").fill(orgName);
  await page.getByRole("button", { name: "יצירת הארגון" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  return email;
}
