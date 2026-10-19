"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/controls";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { savePreferenceAction } from "./actions";
import type { PreferenceView } from "./preferences";

/** Per-event toggles; each change is saved immediately (optimistic, rolled back on error). */
export function PreferencesForm({ initial, readOnly }: { initial: PreferenceView[]; readOnly: boolean }) {
  const t = useTranslations("notificationSettings");
  const [prefs, setPrefs] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);

  const change = async (eventType: PreferenceView["eventType"], field: "inApp" | "email", value: boolean) => {
    const before = prefs;
    const next = prefs.map((p) => (p.eventType === eventType ? { ...p, [field]: value } : p));
    setPrefs(next);
    setSaving(`${eventType}.${field}`);
    const row = next.find((p) => p.eventType === eventType)!;
    const res = await savePreferenceAction({ eventType, inApp: row.inApp, email: row.email });
    setSaving(null);
    if (!res.ok) {
      setPrefs(before);
      toast.error(res.error.message);
      return;
    }
    toast.success(t("saved"));
  };

  return (
    <Table>
      <THead>
        <TR className="hover:bg-transparent">
          <TH>{t("event")}</TH>
          <TH className="w-20 text-center sm:w-28">{t("inApp")}</TH>
          <TH className="w-20 text-center sm:w-28">{t("email")}</TH>
        </TR>
      </THead>
      <TBody>
        {prefs.map((p) => {
          const label = t(`events.${p.eventType}`);
          return (
            <TR key={p.eventType} data-testid={`pref-${p.eventType}`}>
              <TD className="font-medium">{label}</TD>
              <TD className="text-center">
                <Switch
                  checked={p.inApp}
                  disabled={readOnly || saving === `${p.eventType}.inApp`}
                  onCheckedChange={(v) => change(p.eventType, "inApp", v)}
                  aria-label={`${label} — ${t("inApp")}`}
                />
              </TD>
              <TD className="text-center">
                <Switch
                  checked={p.email}
                  disabled={readOnly || saving === `${p.eventType}.email`}
                  onCheckedChange={(v) => change(p.eventType, "email", v)}
                  aria-label={`${label} — ${t("email")}`}
                />
              </TD>
            </TR>
          );
        })}
      </TBody>
    </Table>
  );
}
