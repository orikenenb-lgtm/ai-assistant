import { expect, test } from "@playwright/test";
import { PASSWORD, linkFromMailbox, login, newEmail, registerAndVerify, signUpWithOrg } from "./helpers";

test.describe("authentication and onboarding", () => {
  test("register → verify email → login → create organization → dashboard → sign out", async ({ page }) => {
    await signUpWithOrg(page, "הסטודיו של נועה");
    await expect(page.getByRole("heading", { name: /שלום נועה/ })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(page.getByTestId("org-switcher")).toContainText("הסטודיו של נועה");
    await page.getByTestId("user-menu").click();
    await page.getByRole("menuitem", { name: "התנתקות" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fdashboard/);
  });

  test("unverified users cannot sign in, wrong passwords are rejected", async ({ page }) => {
    const email = newEmail("unverified");
    await page.goto("/register");
    await page.locator("#fullName").fill("Test User");
    await page.locator("#email").fill(email);
    await page.locator("#password").fill(PASSWORD);
    await page.locator("#confirmPassword").fill(PASSWORD);
    await page.getByRole("button", { name: "הרשמה" }).click();
    await expect(page.getByText("בדקו את תיבת המייל")).toBeVisible();
    await login(page, email);
    await expect(page.getByText("יש לאמת את כתובת המייל לפני ההתחברות")).toBeVisible();
    await login(page, email, "WrongPassword1");
    await expect(page.getByText("האימייל או הסיסמה שגויים")).toBeVisible();
  });

  test("password reset flow", async ({ page }) => {
    const email = await registerAndVerify(page);
    await page.goto("/forgot-password");
    await page.locator("#email").fill(email);
    await page.getByRole("button", { name: "שליחת קישור" }).click();
    await expect(page.getByText(/נשלח אליה קישור לאיפוס/)).toBeVisible();
    const link = await linkFromMailbox(page, email, "/reset-password");
    await page.goto(link);
    await page.locator("#password").fill("Brand!NewPass77");
    await page.locator("#confirmPassword").fill("Brand!NewPass77");
    await page.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByText("הסיסמה עודכנה")).toBeVisible();
    await login(page, email, "Brand!NewPass77");
    await expect(page).toHaveURL(/\/onboarding/);
  });

  test("validation errors are shown inline in Hebrew", async ({ page }) => {
    await page.goto("/register");
    await page.locator("#fullName").fill("A");
    await page.locator("#email").fill("not-an-email");
    await page.locator("#password").fill("short");
    await page.locator("#confirmPassword").fill("different");
    await page.getByRole("button", { name: "הרשמה" }).click();
    await expect(page.getByText("כתובת אימייל לא תקינה")).toBeVisible();
    await expect(page.getByText("הסיסמאות אינן תואמות")).toBeVisible();
  });

  test("switches the interface to English (LTR)", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Switch to English" }).click();
    await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
    await page.getByRole("button", { name: "מעבר לעברית" }).click();
    await expect(page.getByRole("heading", { name: "ברוכים השבים" })).toBeVisible();
  });
});
