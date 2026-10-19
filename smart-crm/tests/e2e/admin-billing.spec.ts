import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { login, registerAndVerify, signUpWithOrg } from "./helpers";

const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/smart_crm_e2e", { max: 1, onnotice: () => {} });

test.afterAll(async () => {
  await sql.end({ timeout: 5 });
});

test.describe("billing and platform admin", () => {
  test("owner changes plan (mock) → super admin overrides the tenant and uses read-only support mode", async ({ page }) => {
    const orgName = `חיובים ${randomUUID().slice(0, 6)}`;

    // ---- Owner: trial → Starter through the mock provider.
    await signUpWithOrg(page, orgName);
    await page.goto("/settings/billing");
    await expect(page.getByText("מצב הדגמה — אין חיוב אמיתי")).toBeVisible();
    await expect(page.getByTestId("current-plan-name")).toHaveText("פרו");
    await expect(page.getByTestId("subscription-status")).toHaveText("תקופת ניסיון");
    const contactsMeter = page.getByRole("progressbar", { name: "אנשי קשר" });
    await expect(contactsMeter).toHaveAttribute("aria-valuetext", "0 / 50,000");

    await page.getByTestId("plan-starter").getByRole("button", { name: "בחירה" }).click();
    const confirm = page.getByRole("dialog");
    await expect(confirm.getByText("לעבור לתוכנית סטארטר?")).toBeVisible();
    await confirm.getByRole("button", { name: "אישור" }).click();
    await expect(page.getByText("עברתם לתוכנית סטארטר")).toBeVisible();
    await expect(page.getByTestId("current-plan-name")).toHaveText("סטארטר");
    await expect(page.getByTestId("subscription-status")).toHaveText("פעיל");
    await expect(contactsMeter).toHaveAttribute("aria-valuetext", "0 / 5,000");
    await expect(page.getByTestId("plan-starter").getByText("התוכנית שלך")).toBeVisible();
    await expect(page.getByTestId("billing-history")).toContainText("שינוי תוכנית");

    // ---- A second user becomes platform admin (promotion is a manual DB operation by design).
    await page.context().clearCookies();
    const adminEmail = await registerAndVerify(page, { name: "מנהלת פלטפורמה" });
    await login(page, adminEmail);
    await expect(page).toHaveURL(/\/onboarding/);
    const denied = await page.goto("/admin");
    expect(denied?.status()).toBe(404);
    await sql`update public.profiles set is_super_admin = true where lower(email) = lower(${adminEmail})`;

    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "סקירת הפלטפורמה" })).toBeVisible();

    // Find the tenant.
    await page.getByRole("link", { name: "ארגונים" }).click();
    await page.getByPlaceholder("חיפוש לפי שם או מזהה…").fill(orgName);
    const tenantLink = page.getByTestId("admin-tenant-row").filter({ hasText: orgName });
    await expect(tenantLink).toHaveCount(1);
    await expect(page.getByRole("row").filter({ has: tenantLink })).toContainText("סטארטר");
    await tenantLink.click();
    await expect(page).toHaveURL(/\/admin\/tenants\/[0-9a-f-]{36}$/);
    const tenantId = page.url().split("/").at(-1)!;
    await expect(page.getByRole("heading", { name: orgName })).toBeVisible();
    await expect(page.getByTestId("tenant-status")).toHaveText("פעיל");

    // Feature + limit override.
    const editor = page.getByTestId("override-editor");
    await editor.getByTestId("feature-api").selectOption("add");
    await editor.locator("#limit-max_contacts").fill("7777");
    await editor.locator("#override-note").fill("פיילוט API");
    await editor.getByRole("button", { name: "שמירת התאמות" }).click();
    await expect(page.getByText("ההתאמות נשמרו")).toBeVisible();
    const [override] = await sql<{ features_add: string[]; limits: Record<string, number> }[]>`
      select features_add, limits from public.tenant_plan_overrides where tenant_id = ${tenantId}`;
    expect(override.features_add).toEqual(["api"]);
    expect(override.limits).toEqual({ max_contacts: 7777 });
    await page.reload();
    await expect(page.getByTestId("override-editor").getByTestId("feature-api")).toHaveValue("add");

    // Read-only support mode.
    await page.getByRole("button", { name: "מצב תמיכה" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "כניסה למצב תמיכה" })).toBeDisabled();
    await dialog.locator("#support-reason").fill("פנייה 1234: בדיקת מגבלות החבילה");
    await dialog.getByRole("button", { name: "כניסה למצב תמיכה" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const banner = page.getByRole("status").filter({ hasText: "מצב תמיכה (קריאה בלבד)" });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(orgName);

    // The admin sees the tenant's billing with the override applied, but can't change anything.
    await page.goto("/settings/billing");
    await expect(page.getByRole("progressbar", { name: "אנשי קשר" })).toHaveAttribute("aria-valuetext", "0 / 7,777");
    await expect(page.getByTestId("plan-pro").getByRole("button")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "ביטול מנוי" })).toHaveCount(0);

    // End the session from the admin console.
    await page.goto("/admin/support");
    const session = page.getByTestId("support-session-row").filter({ hasText: orgName });
    await expect(session.getByText("פעיל")).toBeVisible();
    await session.getByRole("button", { name: "סיום סשן" }).click();
    await expect(page.getByText("סשן התמיכה הסתיים")).toBeVisible();
    await expect(session.getByText("הסתיים")).toBeVisible();

    // Without a membership or an active session the tenant is gone again.
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/onboarding/);

    const actions = (await sql<{ action: string; ip: string | null }[]>`
      select action, ip from public.audit_logs where tenant_id = ${tenantId} and actor_type = 'admin'`).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["billing.admin_override_updated", "admin.support_started", "admin.support_view", "admin.support_ended"]));
  });
});
