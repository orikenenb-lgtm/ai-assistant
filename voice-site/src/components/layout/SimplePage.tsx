import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { brand } from "@/config/site";
import { Logo } from "@/components/ui/Logo";
import { Footer } from "@/components/layout/Footer";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { AccessibilityMenu } from "@/components/layout/AccessibilityMenu";

/** Shell for secondary pages (legal, thank-you, errors). */
export function SimplePage({ title, updated, children }: { title: string; updated?: string; children: ReactNode }) {
  return (
    <>
      <a
        href="#main"
        className="sr-only z-[60] rounded-full bg-brand px-4 py-2 font-semibold text-brand-ink focus:not-sr-only focus:fixed focus:start-4 focus:top-4"
      >
        דילוג לתוכן
      </a>
      <header className="container-page flex h-20 items-center justify-between">
        <Link href="/" aria-label={`${brand.name}, לעמוד הבית`} className="rounded-full">
          <Logo />
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/" className="inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold text-ink-2 hover:bg-surface-2 hover:text-ink">
            <ArrowRight className="size-4" aria-hidden="true" /> לעמוד הבית
          </Link>
        </div>
      </header>
      <main id="main" className="container-page pb-16 pt-6 sm:pt-10">
        <article className="mx-auto max-w-3xl">
          <h1 className="text-balance text-3xl font-extrabold tracking-tight sm:text-5xl">{title}</h1>
          {updated ? <p className="mt-3 text-sm text-ink-3">עודכן לאחרונה: {updated}</p> : null}
          <div className="legal mt-8 space-y-4 text-[1.05rem] leading-[1.85] text-ink-2">{children}</div>
        </article>
      </main>
      <Footer />
      <AccessibilityMenu />
    </>
  );
}
