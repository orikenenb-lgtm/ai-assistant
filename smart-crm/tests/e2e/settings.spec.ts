import { expect, test } from "@playwright/test";
import { signUpWithOrg } from "./helpers";

test.describe("developer settings", () => {
  test("create an API key (shown once) → call /api/v1/contacts → revoke → 401", async ({ page }) => {
    await signUpWithOrg(page, "מפתחים בע״מ");

    await page.goto("/settings/api-keys");
    await expect(page.getByText("אין מפתחות API")).toBeVisible();
    await page.getByRole("button", { name: "מפתח חדש" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#api-key-name").fill("Zapier");
    await dialog.getByRole("button", { name: "יצירה" }).click();
    const key = (await dialog.getByTestId("new-api-key").innerText()).trim();
    expect(key).toMatch(/^sck_[a-z0-9]{8}_[A-Za-z0-9_-]{30,64}$/);
    await dialog.getByRole("button", { name: "סיום" }).click();

    // Listed by prefix only — the secret is never rendered again.
    const row = page.getByTestId("api-key-row").filter({ hasText: "Zapier" });
    await expect(row).toContainText(key.slice(0, 12));
    await expect(page.getByText(key)).toHaveCount(0);

    const auth = { Authorization: `Bearer ${key}` };
    const ok = await page.request.get("/api/v1/contacts", { headers: auth });
    expect(ok.status()).toBe(200);
    expect(ok.headers()["x-ratelimit-limit"]).toBe("600");
    const body = (await ok.json()) as { data: unknown[]; pagination: { total: number } };
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination.total).toBe(0);

    // Default scope is read-only.
    const write = await page.request.post("/api/v1/contacts", { headers: auth, data: { firstName: "דנה" } });
    expect(write.status()).toBe(403);

    await row.getByRole("button", { name: "ביטול המפתח" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "ביטול המפתח" }).click();
    await expect(row).toContainText("בוטל");

    const revoked = await page.request.get("/api/v1/contacts", { headers: auth });
    expect(revoked.status()).toBe(401);
    expect(((await revoked.json()) as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  test("org profile → webhooks (SSRF guard, secret once) → privacy, integrations and audit pages", async ({ page }) => {
    await signUpWithOrg(page, "הגדרות בע״מ");

    await page.goto("/settings/general");
    await page.locator("#name").fill("הגדרות ושות׳");
    await page.locator("#vatRatePercent").fill("17");
    await page.getByRole("button", { name: "שמירה" }).first().click();
    await expect(page.getByText("נשמר").first()).toBeVisible();
    await page.reload();
    await expect(page.locator("#name")).toHaveValue("הגדרות ושות׳");
    await expect(page.locator("#vatRatePercent")).toHaveValue("17");

    await page.goto("/settings/webhooks");
    await expect(page.getByText("אין Webhooks")).toBeVisible();
    await page.getByRole("button", { name: "Webhook חדש" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByText("איש קשר נוצר").click();
    await dialog.locator("#webhook-url").fill("https://169.254.169.254/latest/meta-data");
    await dialog.getByRole("button", { name: "שמירה" }).click();
    await expect(dialog.getByText("לא ניתן לשלוח לכתובת פנימית או פרטית")).toBeVisible();
    await dialog.locator("#webhook-url").fill("https://hooks.example.com/crm");
    await dialog.getByRole("button", { name: "שמירה" }).click();
    await expect(page.getByRole("dialog").getByText("סוד החתימה")).toBeVisible();
    await expect(page.getByTestId("webhook-secret")).toHaveText(/^whsec_/);
    await page.getByRole("dialog").getByRole("button", { name: "סגירה" }).first().click();
    await expect(page.getByTestId("webhook-row")).toContainText("hooks.example.com");
    await expect(page.getByTestId("webhook-secret")).toHaveCount(0);

    await page.goto("/settings/integrations");
    await expect(page.getByTestId("integration-whatsapp")).toContainText("מצב הדגמה");

    await page.goto("/settings/privacy");
    await expect(page.getByRole("heading", { name: "פרטיות ונתונים" })).toBeVisible();
    await expect(page.getByRole("button", { name: "מחיקת הארגון" })).toBeVisible();

    // Every change above is in the audit log.
    await page.goto("/settings/audit");
    await expect(page.getByTestId("audit-row").filter({ hasText: "webhook.created" })).toBeVisible();
    await expect(page.getByTestId("audit-row").filter({ hasText: "org.updated" })).toBeVisible();
    await page.getByRole("textbox", { name: "פעולה" }).fill("webhook.");
    await page.getByRole("button", { name: "סינון" }).click();
    await expect(page).toHaveURL(/action=webhook\./);
    await expect(page.getByTestId("audit-row")).toHaveCount(1);
  });
});
