import { redirect } from "next/navigation";
import { requireTenant } from "@/server/tenancy";
import { SETTINGS_SECTIONS } from "./settings-nav";

export default async function SettingsIndex() {
  const { ctx } = await requireTenant();
  const first = SETTINGS_SECTIONS.find((s) => !s.permission || ctx.can(s.permission));
  redirect(`/settings/${first?.key ?? "notifications"}`);
}
