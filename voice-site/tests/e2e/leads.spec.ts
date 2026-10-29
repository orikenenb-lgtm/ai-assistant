import { expect, test } from "@playwright/test";
import { receivedLeads } from "./helpers";

test("contact form validates, submits and delivers a signed lead", async ({ page }) => {
  await page.goto("/#contact");
  const form = page.locator("#contact form");

  await form.getByRole("button", { name: "שלחו ונחזור אליכם" }).click();
  await expect(form.getByText("נא למלא שם")).toBeVisible();
  await expect(form.getByText("נא למלא מספר טלפון")).toBeVisible();
  await expect(form.getByLabel("שם *")).toBeFocused();

  const name = `בדיקה ${Date.now()}`;
  await form.getByLabel("שם *").fill(name);
  await form.getByLabel("טלפון *").fill("052-555-1234");
  await form.getByLabel("תחום העסק (רשות)").fill("מוסך");
  await form.getByText("בערב").click();
  await form.getByRole("button", { name: "שלחו ונחזור אליכם" }).click();
  await expect(page.locator("#contact").getByRole("status")).toContainText("קיבלנו!");

  await expect.poll(async () => (await receivedLeads()).find((l) => l.body.lead.name === name)).toBeTruthy();
  const lead = (await receivedLeads()).find((l) => l.body.lead.name === name)!;
  expect(lead.body.lead).toMatchObject({ phone: "+972525551234", business: "מוסך", source: "form", callback: "evening" });
  expect(lead.signature).toMatch(/^t=\d+,v1=[a-f0-9]{64}$/);
});

test("pricing buttons prefill the plan in the form", async ({ page }) => {
  await page.goto("/#pricing");
  await page.getByRole("link", { name: "מתחילים עם Growth" }).click();
  await expect(page.locator("#contact textarea")).toHaveValue("מתעניינים בחבילת Growth.");
});

test("form works without JavaScript (native POST + redirect)", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/");
  const form = page.locator("#contact form");
  const name = `בלי JS ${Date.now()}`;
  await form.locator('input[name="name"]').fill(name);
  await form.locator('input[name="phone"]').fill("0541234567");
  await form.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/\/thanks$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("תודה");
  await expect.poll(async () => (await receivedLeads()).some((l) => l.body.lead.name === name)).toBe(true);
  await context.close();
});

test("lead API rejects bad input, cross-site posts and spam", async ({ request, baseURL }) => {
  const bad = await request.post("/api/lead", { data: { name: "a", phone: "1" } });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).errors.phone).toBeTruthy();

  const cross = await request.post("/api/lead", {
    data: { name: "דני", phone: "0501234567" },
    headers: { Origin: "https://evil.example" },
  });
  expect(cross.status()).toBe(403);

  const before = (await receivedLeads()).length;
  const spam = await request.post("/api/lead", {
    data: { name: "בוט", phone: "0501234567", website: "http://spam" },
    headers: { Origin: baseURL! },
  });
  expect(spam.status()).toBe(200);
  expect((await receivedLeads()).length).toBe(before);
});

test("agent API validates its payload", async ({ request }) => {
  expect((await request.post("/api/agent", { data: { messages: [] } })).status()).toBe(400);
  expect((await request.post("/api/agent", { data: "not json" })).status()).toBe(400);
  const ok = await request.post("/api/agent", { data: { messages: [{ role: "user", content: "כמה זה עולה?" }] } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.source).toBe("rules");
  expect(body.reply).toContain("שקל");
});
