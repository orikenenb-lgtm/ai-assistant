"use client";

import { Accessibility, Link2, Minus, Pause, Plus, RotateCcw, SunMoon, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { clsx } from "clsx";

type Prefs = { scale?: number; contrast?: boolean; motion?: boolean; links?: boolean };

const SCALES = [1, 1.125, 1.25, 1.375];

function read(): Prefs {
  try {
    return JSON.parse(localStorage.getItem("a11y") || "{}") as Prefs;
  } catch {
    return {};
  }
}

function apply(p: Prefs) {
  const d = document.documentElement;
  d.style.setProperty("--font-scale", String(p.scale ?? 1));
  if (p.contrast) d.setAttribute("data-a11y-contrast", "high");
  else d.removeAttribute("data-a11y-contrast");
  if (p.motion) d.setAttribute("data-a11y-motion", "off");
  else d.removeAttribute("data-a11y-motion");
  if (p.links) d.setAttribute("data-a11y-links", "on");
  else d.removeAttribute("data-a11y-links");
  try {
    localStorage.setItem("a11y", JSON.stringify(p));
  } catch {}
}

/** Small accessibility panel (text size, contrast, motion, link underlines). */
export function AccessibilityMenu() {
  const [open, setOpen] = useState(false);
  // Only rendered inside the panel, so reading storage up front can't mismatch hydration.
  const [prefs, setPrefs] = useState<Prefs>(() => (typeof window === "undefined" ? {} : read()));
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const update = (next: Prefs) => {
    setPrefs(next);
    apply(next);
  };

  const scaleIndex = Math.max(0, SCALES.indexOf(prefs.scale ?? 1));

  const toggles: { key: keyof Prefs; label: string; icon: typeof Pause }[] = [
    { key: "contrast", label: "ניגודיות גבוהה", icon: SunMoon },
    { key: "motion", label: "עצירת אנימציות", icon: Pause },
    { key: "links", label: "הדגשת קישורים", icon: Link2 },
  ];

  return (
    <div className="fixed bottom-20 end-4 z-40 sm:bottom-4 print:hidden">
      {open ? (
        <div
          ref={panel}
          id="a11y-panel"
          role="dialog"
          aria-label="הגדרות נגישות"
          className="animate-in absolute bottom-14 end-0 w-72 rounded-3xl border border-line bg-surface p-4 text-ink shadow-float"
        >
          <div className="flex items-center justify-between">
            <p className="font-bold">נגישות</p>
            <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-full hover:bg-surface-2" aria-label="סגירה">
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-3 flex items-center justify-between rounded-2xl bg-surface-2 p-2">
            <button
              type="button"
              onClick={() => update({ ...prefs, scale: SCALES[Math.max(0, scaleIndex - 1)] })}
              disabled={scaleIndex === 0}
              className="grid size-9 place-items-center rounded-xl bg-surface disabled:opacity-40"
              aria-label="הקטנת טקסט"
            >
              <Minus className="size-4" />
            </button>
            <span className="text-sm font-semibold" aria-live="polite">
              גודל טקסט {Math.round(SCALES[scaleIndex] * 100)}%
            </span>
            <button
              type="button"
              onClick={() => update({ ...prefs, scale: SCALES[Math.min(SCALES.length - 1, scaleIndex + 1)] })}
              disabled={scaleIndex === SCALES.length - 1}
              className="grid size-9 place-items-center rounded-xl bg-surface disabled:opacity-40"
              aria-label="הגדלת טקסט"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <ul className="mt-2 space-y-1">
            {toggles.map(({ key, label, icon: Icon }) => (
              <li key={key}>
                <button
                  type="button"
                  aria-pressed={Boolean(prefs[key])}
                  onClick={() => update({ ...prefs, [key]: !prefs[key] })}
                  className={clsx(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                    prefs[key] ? "bg-brand-soft font-semibold text-brand" : "hover:bg-surface-2",
                  )}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {label}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-sm">
            <button type="button" onClick={() => update({})} className="inline-flex items-center gap-1.5 text-ink-2 hover:text-ink">
              <RotateCcw className="size-3.5" aria-hidden="true" /> איפוס
            </button>
            <Link href="/accessibility" className="font-semibold text-brand underline-offset-2 hover:underline">
              הצהרת נגישות
            </Link>
          </div>
        </div>
      ) : null}
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="a11y-panel"
        aria-label="תפריט נגישות"
        className="grid size-12 place-items-center rounded-full bg-[#1d4ed8] text-white shadow-float transition hover:scale-105"
      >
        <Accessibility className="size-6" />
      </button>
    </div>
  );
}
