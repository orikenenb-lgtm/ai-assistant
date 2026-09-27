"use client";

import { useCallback, useRef } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { X } from "lucide-react";
import type { NavItem } from "@/types";
import type { BookingLink, SocialLink } from "@/lib/links";
import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useScrollLock } from "@/hooks/useScrollLock";
import { Button } from "@/components/ui/Button";
import { SocialIconLink } from "@/components/ui/SocialIconLink";

interface MobileMenuProps {
  id: string;
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  activeId: string | null;
  booking: BookingLink;
  socials: SocialLink[];
}

// The drawer slides in from the inline-end edge (left in RTL, right in LTR).
const offscreenX = siteConfig.dir === "rtl" ? "-100%" : "100%";

export function MobileMenu({ id, open, onClose, items, activeId, booking, socials }: MobileMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const handleEscape = useCallback(() => onClose(), [onClose]);

  useScrollLock(open);
  useFocusTrap(panelRef, open, { onEscape: handleEscape, initialFocus: closeRef });

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <m.div
            className="absolute inset-0 bg-ink/35 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            onClick={onClose}
            aria-hidden
          />
          <m.div
            ref={panelRef}
            id={id}
            role="dialog"
            aria-modal="true"
            aria-label="תפריט ניווט"
            tabIndex={-1}
            className="absolute inset-y-0 end-0 flex w-[min(88vw,380px)] flex-col bg-ivory shadow-lift outline-none"
            initial={{ x: offscreenX }}
            animate={{ x: 0 }}
            exit={{ x: offscreenX }}
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex h-18 items-center justify-between border-b border-line/70 px-5">
              <span className="text-xs font-medium tracking-[0.06em] text-muted">תפריט</span>
              <button
                ref={closeRef}
                type="button"
                onClick={onClose}
                aria-label="סגירת התפריט"
                className="grid h-11 w-11 place-items-center rounded-full text-ink transition-colors hover:bg-cream"
              >
                <X aria-hidden className="h-5 w-5" strokeWidth={1.6} />
              </button>
            </div>

            <nav aria-label="ניווט ראשי" className="flex-1 overflow-y-auto px-5 py-6">
              <ul className="flex flex-col">
                {items.map((item, index) => {
                  const current = activeId !== null && item.href === `/#${activeId}`;
                  return (
                    <m.li
                      key={item.href}
                      initial={{ opacity: 0, x: siteConfig.dir === "rtl" ? -12 : 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.12 + index * 0.04, duration: 0.4 }}
                    >
                      <a
                        href={item.href}
                        onClick={onClose}
                        aria-current={current ? "location" : undefined}
                        className={cn(
                          "flex min-h-14 items-center justify-between border-b border-line/50 py-3 font-display text-2xl transition-colors",
                          current ? "text-rose-600" : "text-ink hover:text-rose-600",
                        )}
                      >
                        {item.label}
                        {current && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-rose-400" />}
                      </a>
                    </m.li>
                  );
                })}
              </ul>
            </nav>

            <div className="flex flex-col gap-5 border-t border-line/70 p-5">
              <Button href={booking.href} external={booking.external} onClick={onClose} size="lg" className="w-full">
                קביעת תור
              </Button>
              {socials.length > 0 && (
                <div className="flex justify-center gap-2">
                  {socials.map((social) => (
                    <SocialIconLink key={social.id} social={social} />
                  ))}
                </div>
              )}
            </div>
          </m.div>
        </div>
      )}
    </AnimatePresence>
  );
}
