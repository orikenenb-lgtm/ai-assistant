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
          ? "border-b border-line bg-night/80 backdrop-blur-md"
          : "border-b border-transparent bg-night/0",
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
                      "relative inline-flex min-h-11 items-center rounded-full px-4 text-sm tracking-wide transition-colors",
                      "after:absolute after:inset-x-4 after:bottom-2 after:h-px after:origin-center after:scale-x-0 after:bg-linear-to-l after:from-violet after:via-orchid after:to-ice after:transition-transform after:duration-300",
                      current ? "text-cream after:scale-x-100" : "text-mist hover:text-cream hover:after:scale-x-100",
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
            className="grid h-11 w-11 place-items-center rounded-full border border-cream/15 text-cream transition-colors hover:border-cream/60 lg:hidden"
          >
            <Menu aria-hidden className="h-5 w-5" strokeWidth={1.2} />
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
