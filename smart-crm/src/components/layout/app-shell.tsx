"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Dialog as D } from "radix-ui";
import {
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  Check,
  CheckSquare,
  ChevronsUpDown,
  FileText,
  Handshake,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Settings,
  Shield,
  Sparkles,
  UserRound,
  Users,
  Workflow,
  Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Avatar, Badge, Kbd } from "@/components/ui/primitives";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/menu";
import { Logo } from "./logo";
import { LocaleToggle, ThemeMenu } from "./preferences-switcher";
import { NAV, type NavKey } from "./nav";
import { CommandPalette } from "./command-palette";
import { NotificationsBell } from "./notifications-bell";
import { signOutAction } from "@/modules/auth/actions";
import { switchTenantAction } from "@/modules/org/actions";

const ICONS: Record<NavKey, React.ComponentType<{ className?: string }>> = {
  dashboard: LayoutDashboard,
  inbox: MessageCircle,
  contacts: Users,
  companies: Building2,
  leads: Sparkles,
  deals: Handshake,
  tasks: CheckSquare,
  calendar: CalendarDays,
  documents: FileText,
  automations: Workflow,
  analytics: BarChart3,
  copilot: Bot,
  settings: Settings,
};

export type ShellProps = {
  user: { id: string; fullName: string; email: string; isSuperAdmin: boolean };
  tenant: { id: string; name: string; brandColor: string | null };
  tenants: { id: string; name: string; role: string }[];
  role: string | null;
  allowedNav: NavKey[];
  supportMode: boolean;
  trialDaysLeft: number | null;
  unreadNotifications: number;
  children: React.ReactNode;
};

function SidebarNav({ allowed, onNavigate }: { allowed: Set<NavKey>; onNavigate?: () => void }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  return (
    <nav aria-label={t("menu")} className="flex flex-col gap-5">
      {NAV.map((group) => {
        const items = group.items.filter((i) => allowed.has(i.key));
        if (!items.length) return null;
        return (
          <div key={group.key}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">{t(group.key)}</p>
            <ul className="flex flex-col gap-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.key];
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <li key={item.key}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        active
                          ? "bg-sidebar-active text-sidebar-active-foreground"
                          : "text-sidebar-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      {t(item.key === "documents" ? "documents" : item.key)}
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

function OrgSwitcher({ tenant, tenants }: Pick<ShellProps, "tenant" | "tenants">) {
  const t = useTranslations("nav");
  const tm = useTranslations("members");
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex w-full items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-start shadow-xs transition-colors hover:bg-accent disabled:opacity-60"
          disabled={pending}
          data-testid="org-switcher"
        >
          <Avatar name={tenant.name} size="sm" />
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{tenant.name}</span>
          <ChevronsUpDown className="size-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("switchOrg")}</DropdownMenuLabel>
        {tenants.map((o) => (
          <DropdownMenuItem
            key={o.id}
            onSelect={() =>
              start(async () => {
                if (o.id === tenant.id) return;
                await switchTenantAction({ tenantId: o.id });
                router.push("/dashboard");
                router.refresh();
              })
            }
          >
            <Avatar name={o.name} size="xs" />
            <span className="flex-1 truncate">{o.name}</span>
            <span className="text-xs text-muted-foreground">{tm(`roles.${o.role}` as "roles.agent")}</span>
            {o.id === tenant.id && <Check className="!text-primary" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/onboarding?new=1">
            <Plus /> {t("createOrg")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: ShellProps["user"] }) {
  const t = useTranslations("nav");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("account")} data-testid="user-menu">
          <Avatar name={user.fullName || user.email} size="sm" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <div className="px-2.5 py-2">
          <p className="truncate text-sm font-medium">{user.fullName}</p>
          <p className="truncate text-xs text-muted-foreground" dir="ltr">
            {user.email}
          </p>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/account">
            <UserRound /> {t("account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings /> {t("settings")}
          </Link>
        </DropdownMenuItem>
        {user.isSuperAdmin && (
          <DropdownMenuItem asChild>
            <Link href="/admin">
              <Shield /> {t("admin")}
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="danger" onSelect={() => void signOutAction()}>
          <LogOut /> {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppShell(props: ShellProps) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const tb = useTranslations("billing");
  const tsup = useTranslations("support");
  const allowed = new Set(props.allowedNav);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sidebar = (onNavigate?: () => void) => (
    <div className="flex h-full flex-col gap-5 p-4">
      <div className="flex items-center justify-between px-1">
        <Logo />
      </div>
      <OrgSwitcher tenant={props.tenant} tenants={props.tenants} />
      <div className="-mx-1 flex-1 overflow-y-auto px-1">
        <SidebarNav allowed={allowed} onNavigate={onNavigate} />
      </div>
      <Link
        href="/settings"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-sidebar-foreground transition-colors hover:bg-accent",
          pathname.startsWith("/settings") && "bg-sidebar-active text-sidebar-active-foreground",
        )}
      >
        <Settings className="size-4" /> {t("settings")}
      </Link>
    </div>
  );

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[260px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        {tc("skipToContent")}
      </a>
      <aside className="sticky top-0 hidden h-dvh border-e border-border bg-sidebar lg:block">{sidebar()}</aside>

      <D.Root open={mobileOpen} onOpenChange={setMobileOpen}>
        <D.Portal>
          <D.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-fade-in lg:hidden" />
          <D.Content className="fixed inset-y-0 start-0 z-50 w-72 max-w-[85vw] border-e border-border bg-sidebar shadow-lg outline-none data-[state=open]:animate-fade-in lg:hidden">
            <D.Title className="sr-only">{t("menu")}</D.Title>
            {sidebar(() => setMobileOpen(false))}
          </D.Content>
        </D.Portal>
      </D.Root>

      <div className="flex min-w-0 flex-col">
        {props.supportMode && (
          <div className="flex items-center justify-center gap-2 bg-warning px-4 py-1.5 text-sm font-medium text-black" role="status">
            <Eye className="size-4" /> {tsup("banner", { org: props.tenant.name })}
          </div>
        )}
        {props.trialDaysLeft !== null && !props.supportMode && (
          <div className="flex items-center justify-center gap-2 bg-primary-soft px-4 py-1.5 text-xs font-medium text-primary-soft-foreground">
            <Sparkles className="size-3.5" />
            {tb("trialBanner", { days: props.trialDaysLeft })}
            <Link href="/settings/billing" className="underline underline-offset-2">
              {tb("choosePlan")}
            </Link>
          </div>
        )}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/80 px-3 backdrop-blur-md sm:px-5">
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label={t("menu")}>
            <Menu />
          </Button>
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex h-9 w-full max-w-md items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-accent"
            data-testid="open-command-palette"
          >
            <Search className="size-4" />
            <span className="flex-1 text-start">{tc("searchPlaceholder")}</span>
            <Kbd className="hidden sm:inline-flex" dir="ltr">
              Ctrl K
            </Kbd>
          </button>
          <div className="ms-auto flex items-center gap-1">
            {props.supportMode && <Badge tone="warning">{tsup("readOnly")}</Badge>}
            <LocaleToggle className="hidden sm:inline-flex" />
            <ThemeMenu />
            <NotificationsBell initialUnread={props.unreadNotifications} />
            <UserMenu user={props.user} />
          </div>
        </header>
        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {props.children}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} allowedNav={props.allowedNav} />
    </div>
  );
}
