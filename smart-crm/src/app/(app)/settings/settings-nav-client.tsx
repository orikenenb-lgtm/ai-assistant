"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const GROUPS = ["org", "crm", "channels", "developer", "account"] as const;

export function SettingsNav({ sections }: { sections: { key: string; group: (typeof GROUPS)[number] }[] }) {
  const t = useTranslations("settings");
  const pathname = usePathname();
  return (
    <nav aria-label={t("title")} className="flex gap-4 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
      {GROUPS.map((g) => {
        const items = sections.filter((s) => s.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="shrink-0">
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t(`groups.${g}`)}</p>
            <ul className="flex gap-1 lg:flex-col lg:gap-0.5">
              {items.map((s) => {
                const href = `/settings/${s.key}`;
                const active = pathname === href || pathname.startsWith(`${href}/`);
                return (
                  <li key={s.key}>
                    <Link
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "block whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors",
                        active ? "bg-sidebar-active font-medium text-sidebar-active-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {t(`sections.${s.key}` as "sections.general")}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
