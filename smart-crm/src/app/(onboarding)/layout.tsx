import { Logo } from "@/components/layout/logo";
import { LocaleToggle, ThemeMenu } from "@/components/layout/preferences-switcher";

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-gradient-to-b from-primary-soft/60 to-background">
      <header className="flex items-center justify-between p-4 sm:p-6">
        <Logo />
        <div className="flex items-center gap-1">
          <LocaleToggle />
          <ThemeMenu />
        </div>
      </header>
      <main className="flex justify-center px-4 pb-16 pt-6">{children}</main>
    </div>
  );
}
