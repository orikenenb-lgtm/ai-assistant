import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { signUpWithOrg } from "./helpers";

const sql = postgres(process.env.E2E_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/smart_crm_e2e", { max: 1, onnotice: () => {} });

test.afterAll(async () => {
  await sql.end();
});

/**
 * Seeds sales data straight into the e2e database for the signed-up owner:
 * one deal won just now (₪12,345), one won 40 days ago (₪1,000 — inside 90 days,
 * never inside "this month" or the last 30 days), two open deals (₪20,000 + ₪5,000)
 * three leads created just now and a call logged on the fresh win.
 */
async function seedSales(email: string) {
  const [m] = await sql<{ tenantId: string; userId: string }[]>`
    select m.tenant_id as "tenantId", m.user_id as "userId"
    from memberships m join profiles p on p.id = m.user_id
    where p.email = ${email} and m.status = 'active'`;
  const stages = await sql<{ id: string; pipelineId: string; kind: string }[]>`
    select s.id, s.pipeline_id as "pipelineId", s.kind
    from pipeline_stages s join pipelines p on p.id = s.pipeline_id
    where p.tenant_id = ${m.tenantId}
    order by p.created_at, s.position`;
  const open = stages.filter((s) => s.kind === "open");
  const won = stages.find((s) => s.kind === "won")!;
  const deal = (stage: { id: string; pipelineId: string }, title: string, cents: number, extra: { status?: string; wonAgoDays?: number } = {}) => sql`
    insert into deals (tenant_id, pipeline_id, stage_id, title, value_cents, owner_id, status, won_at)
    values (${m.tenantId}, ${stage.pipelineId}, ${stage.id}, ${title}, ${cents}, ${m.userId}, ${extra.status ?? "open"},
            ${extra.wonAgoDays === undefined ? null : sql`now() - make_interval(days => ${extra.wonAgoDays})`})
    returning id`;
  const [winter] = await deal(won, "הזמנת חורף", 1_234_500, { status: "won", wonAgoDays: 0 });
  await deal(won, "הזמנה ישנה", 100_000, { status: "won", wonAgoDays: 40 });
  await deal(open[0], "פתוחה א", 2_000_000);
  await deal(open[1], "פתוחה ב", 500_000);
  for (const name of ["ליד 1", "ליד 2", "ליד 3"]) {
    await sql`insert into leads (tenant_id, full_name, source, owner_id) values (${m.tenantId}, ${name}, 'website', ${m.userId})`;
  }
  await sql`insert into activities (tenant_id, type, subject, deal_id, actor_id) values (${m.tenantId}, 'call', 'סגירת הזמנה', ${winter.id}, ${m.userId})`;
}

test.describe("analytics", () => {
  test("dashboard KPIs → revenue report → date preset → CSV export", async ({ page }) => {
    const email = await signUpWithOrg(page, "אנליטיקס בע״מ");
    // A brand-new organization gets the getting-started card, not a wall of zeros.
    await expect(page.getByTestId("dashboard-empty")).toBeVisible();

    await seedSales(email);
    await page.goto("/dashboard");
    const kpis = page.getByTestId("dashboard-kpis");
    await expect(kpis).toBeVisible();
    await expect(page.getByTestId("kpi-open-pipeline")).toContainText("25,000");
    await expect(kpis.getByText("2 עסקאות פתוחות")).toBeVisible();
    await expect(page.getByTestId("kpi-won-month")).toContainText("12,345");
    await expect(page.getByTestId("kpi-new-leads")).toContainText("3");
    await expect(page.getByTestId("activity-feed")).toContainText("סגירת הזמנה");
    await expect(page.getByTestId("activity-feed")).toContainText("הזמנת חורף");

    // Revenue tab is the default report; last 30 days excludes the 40-day-old win.
    await page.getByRole("link", { name: "דוחות" }).click();
    await expect(page).toHaveURL(/\/analytics/);
    await expect(page.getByRole("heading", { name: "דוחות וניתוח" })).toBeVisible();
    await expect(page.getByTestId("kpi-revenue-won")).toContainText("12,345");
    const trend = page.getByRole("figure").filter({ hasText: "הכנסות לאורך זמן" });
    await expect(trend).toBeVisible();

    // Widening the range to 90 days pulls the older win in.
    await page.getByTestId("range-preset").selectOption("90d");
    await expect(page).toHaveURL(/preset=90d/);
    await expect(page.getByTestId("kpi-revenue-won")).toContainText("13,345");

    // Every chart has a table view (screen readers always get it; sighted users toggle it).
    const toggle = trend.getByRole("button", { name: "טבלה" });
    await toggle.click();
    await expect(trend.getByRole("button", { name: "גרף" })).toHaveAttribute("aria-pressed", "true");
    const box = await trend.getByRole("table").boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(40);

    // CSV export for the same filters: UTF-8 BOM, header row, both wins.
    const href = await page.getByTestId("export-csv").getAttribute("href");
    expect(href).toContain("report=revenue");
    expect(href).toContain("preset=90d");
    const res = await page.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="revenue-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.csv"/);
    const body = await res.text();
    expect(body.charCodeAt(0)).toBe(0xfeff);
    expect(body.split("\r\n").length).toBeGreaterThan(2);
  });
});
