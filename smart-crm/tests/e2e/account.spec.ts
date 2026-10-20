import { expect, test } from "@playwright/test";
import { totp } from "../../src/server/auth/totp";
import { login, signUpWithOrg } from "./helpers";

test.describe("account security", () => {
  test("enable MFA with an authenticator code → sign out → sign-in requires the code", async ({ page }) => {
    test.setTimeout(120_000);
    const email = await signUpWithOrg(page, "אבטחה בע״מ");

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "החשבון שלי" })).toBeVisible();
    await page.getByRole("button", { name: "הפעלת אימות דו-שלבי" }).click();
    await expect(page.getByRole("img", { name: "QR" })).toBeVisible();
    const secret = (await page.getByTestId("mfa-secret").innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{16,}$/);

    // A wrong code is rejected and MFA stays off.
    await page.locator("#mfa-code").fill("000000");
    await page.getByRole("button", { name: "אימות והפעלה" }).click();
    await expect(page.getByTestId("mfa-secret")).toBeVisible();

    await page.locator("#mfa-code").fill(totp(secret));
    await page.getByRole("button", { name: "אימות והפעלה" }).click();
    await expect(page.getByText("אימות דו-שלבי הופעל")).toBeVisible();
    await expect(page.getByTestId("mfa-secret")).toBeHidden();

    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: "התנתקות" }).click();
    await expect(page).toHaveURL(/\/login/);

    // Password alone is not enough: the app keeps redirecting to the challenge.
    await login(page, email);
    await expect(page).toHaveURL(/\/mfa/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/mfa/);

    await page.locator("#code").fill("000000");
    await page.getByRole("button", { name: "אימות", exact: true }).click();
    await expect(page.getByText("הקוד שגוי או שפג תוקפו")).toBeVisible();

    // Enrollment consumed the current 30 s step (replay protection), so use the
    // next step's code — still inside the server's ±1 step drift window.
    await page.locator("#code").fill(totp(secret, Date.now() + 30_000));
    await page.getByRole("button", { name: "אימות", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard/);

    await page.goto("/account");
    await expect(page.getByRole("button", { name: "ביטול אימות דו-שלבי" })).toBeVisible();
  });
});
