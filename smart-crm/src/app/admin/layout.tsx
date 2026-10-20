import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowRight, Eye, ShieldCheck } from "lucide-react";
import { requireSuperAdmin } from "@/modules/admin/request";
import { activeSupportFor } from "@/modules/admin/service";
import { AdminNav } from "@/modules/admin/components/admin-nav";
import { Logo } from "@/components/layout/logo";
import { LocaleToggle, ThemeMenu } from "@/components/layout/preferences-switcher";
import { Badge } from "@/components/ui/primitives";

export async function generateMetadata() {
  return { title: { default: (await getTranslations("admin"))("title"), template: `%s · ${(await getTranslations("admin"))("title")}` } };
}

/** Platform administration — super admins only (everyone else gets a 404). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireSuperAdmin();
  const t = await getTranslations("admin");
  const support = await activeSupportFor(actor);
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Logo />
          <Badge tone="warning">
            <ShieldCheck /> {t("badge")}
          </Badge>
          <div className="ms-auto flex items-center gap-1">
            {support && (
              <Link href="/dashboard" className="me-2 inline-flex items-center gap-1 rounded-lg bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning-foreground">
                <Eye className="size-3.5" /> {t("support.inSession", { org: support.tenantName })}
              </Link>
            )}
            <Link href="/dashboard" className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
              {t("backToApp")} <ArrowRight className="size-4 rtl:-scale-x-100" />
            </Link>
            <LocaleToggle />
            <ThemeMenu />
          </div>
        </div>
        <div className="mx-auto max-w-[1400px] px-4 pb-2 sm:px-6">
          <AdminNav />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
