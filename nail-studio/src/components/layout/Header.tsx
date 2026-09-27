"use client";

import { useCallback, useState } from "react";
import { Menu } from "lucide-react";
import { mainNav } from "@/data/navigation";
import { getBookingLink, getSocialLinks } from "@/lib/links";
import { cn } from "@/lib/utils";
import { useActiveSection } from "@/hooks/useActiveSection";
import { useScrolled } from "@/hooks/useScrolled";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { Logo } from "@/components/ui/Logo";
import { MobileMenu } from "@/components/layout/MobileMenu";

const SECTION_ANCHORS = mainNav.map((item) => item.href.replace("/#", ""));
const booking = getBookingLink();
const socials = getSocialLinks();
const MENU_ID = "mobile-menu";

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);
  const scrolled = useScrolled();
  const activeId = useActiveSection(SECTION_ANCHORS);
  const closeMenu = useCallback(() => setMenuOpen(false), []);

  return (
    <>
    <header
      className={cn(
        "sticky top-0 z-40 transition-[background-color,box-shadow,border-color] duration-500",
        scrolled
          ? "border-b border-line/60 bg-ivory/80 shadow-[0_8px_30px_-20px_rgb(43_36_39/0.25)] backdrop-blur-md"
          : "border-b border-transparent bg-ivory/0",
      )}
    >
      <Container className="flex h-18 items-center justify-between gap-4 lg:h-20">
        <Logo />

        <nav aria-label="ניווט ראשי" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {mainNav.map((item) => {
              const current = activeId !== null && item.href === `/#${activeId}`;
              return (
                <li key={item.href}>
                  <a
                    href={item.href}
                    aria-current={current ? "location" : undefined}
                    className={cn(
                      "relative inline-flex min-h-11 items-center rounded-full px-4 text-[15px] transition-colors",
                      "after:absolute after:inset-x-4 after:bottom-2 after:h-px after:origin-center after:scale-x-0 after:bg-rose-400 after:transition-transform after:duration-300",
                      current ? "text-ink after:scale-x-100" : "text-ink-soft hover:text-ink hover:after:scale-x-100",
                    )}
                  >
                    {item.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:block">
            <Button href={booking.href} external={booking.external}>
              קביעת תור
            </Button>
          </div>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label="פתיחת התפריט"
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            aria-haspopup="dialog"
            className="grid h-11 w-11 place-items-center rounded-full border border-ink/10 text-ink transition-colors hover:bg-cream lg:hidden"
          >
            <Menu aria-hidden className="h-5 w-5" strokeWidth={1.6} />
          </button>
        </div>
      </Container>
    </header>

    {/* Rendered outside <header>: its backdrop-filter would otherwise trap the fixed drawer. */}
    <MobileMenu
        id={MENU_ID}
        open={menuOpen}
        onClose={closeMenu}
        items={mainNav}
        activeId={activeId}
        booking={booking}
        socials={socials}
      />
    </>
  );
}
