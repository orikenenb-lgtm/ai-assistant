"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Flag, LayoutDashboard, ListChecks, LifeBuoy, ScrollText, Tags } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/admin", key: "overview", icon: LayoutDashboard },
  { href: "/admin/tenants", key: "tenants", icon: Building2 },
  { href: "/admin/plans", key: "plans", icon: Tags },
  { href: "/admin/flags", key: "flags", icon: Flag },
  { href: "/admin/jobs", key: "jobs", icon: ListChecks },
  { href: "/admin/support", key: "support", icon: LifeBuoy },
  { href: "/admin/audit", key: "audit", icon: ScrollText },
] as const;

export function AdminNav() {
  const t = useTranslations("admin.nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("label")} className="flex gap-1 overflow-x-auto">
      {ITEMS.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              active ? "bg-sidebar-active text-sidebar-active-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <item.icon className="size-4" />
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
