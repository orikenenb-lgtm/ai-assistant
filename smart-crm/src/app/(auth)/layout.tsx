import { getLocale, getTranslations } from "next-intl/server";
import { Bot, MessageCircle, Workflow, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/layout/logo";
import { LocaleToggle, ThemeMenu } from "@/components/layout/preferences-switcher";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("app");
  const features = [
    { icon: MessageCircle, he: "תיבת WhatsApp משותפת לכל הצוות", en: "Shared WhatsApp inbox for the whole team" },
    { icon: Bot, he: "Copilot שמסכם, מנסח ומציע את הצעד הבא", en: "A copilot that summarizes, drafts and suggests next steps" },
    { icon: Workflow, he: "אוטומציות שעובדות בשבילכם 24/7", en: "Automations that work for you 24/7" },
    { icon: ShieldCheck, he: "הפרדת נתונים מלאה בין ארגונים", en: "Full data isolation between organizations" },
  ];
  const lang = await getLocale();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,560px)_1fr]">
      <main className="flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-6">
          <Logo className="lg:invisible" />
          <div className="flex items-center gap-1">
            <LocaleToggle />
            <ThemeMenu />
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16 sm:px-10">
          <div className="w-full max-w-sm animate-scale-in">{children}</div>
        </div>
      </main>
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-primary via-primary to-ai p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_20%_20%,white_1px,transparent_1px)] [background-size:24px_24px]" aria-hidden />
        <Logo onBrand className="relative text-white [&>span:first-child]:bg-white/15" />
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">{t("tagline")}</h2>
          <ul className="mt-8 space-y-4">
            {features.map((f) => (
              <li key={f.en} className="flex items-center gap-3 text-white/90">
                <span className="flex size-9 items-center justify-center rounded-xl bg-white/15">
                  <f.icon className="size-4" />
                </span>
                {lang === "he" ? f.he : f.en}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-sm text-white/70">© {new Date().getFullYear()} SMART CRM AI</p>
      </aside>
    </div>
  );
}
