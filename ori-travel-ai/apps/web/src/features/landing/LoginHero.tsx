/*
 * Login hero — editorial product-page hero shown above the existing login card (the app's only public page).
 *
 * Step-0 decisions (from the project):
 * - DIRECTION: RTL (Hebrew UI). "start" = right, "end" = left; logical properties only.
 * - PRODUCT OBJECT: assets/hero-object.webp — the cream hard-shell suitcase (owner supplied, transparent background).
 * - MACRO DETAIL: assets/hero-macro.webp — close-up of the same suitcase's handle and wheel (different framing).
 * - GHOST WORD: "Ori" (exact logo spelling). Its "i" is drawn dotless; the accent dot replaces the tittle.
 * - ACCENT COLOR: the brand sea teal #156f66 (--color-sea-600, the app's primary accent; ≈5:1 on the hero surface).
 * - HEADLINE: "מתכננים / יחד, / בשקט." — the existing login-panel promise, split into three lines.
 * - SUBTEXT: the existing dashboard line (search, compare, plan with full price-source transparency) + the existing
 *   proof line "המערכת מכינה הזמנות — אף פעם לא קונה בשמכם."
 * - CTA: the page's main existing action, "כניסה", linking to the login form (#main, the next section).
 * - NAV: the public page has no navigation links, so the nav shows the logo only (no links are invented).
 * - COLORS: the warm neutral set (the project's tokens are cool greys that flip in dark mode; this hero is always
 *   light and matches the cream product).
 * - FONT: the site's existing display font, Heebo (self-hosted, Hebrew + Latin subsets, weights 400/500/800).
 */
import { useEffect, useRef } from 'react';
import { LogoMark } from '@/components/layout/Logo';
import heroMacro from './assets/hero-macro.webp';
import heroObject from './assets/hero-object.webp';
import './LoginHero.css';

const HEADLINE = ['מתכננים', 'יחד,', 'בשקט.'];

function reducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/** Scroll parallax (ghost 0.6x, macro 1.15x) and desktop pointer drift — transform-only, rAF-throttled. */
function useHeroMotion(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el || reducedMotion()) return;
    let frame = 0;
    let scrollY = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      frame = 0;
      el.style.setProperty('--hero-scroll', `${scrollY}px`);
      el.style.setProperty('--hero-px', px.toFixed(3));
      el.style.setProperty('--hero-py', py.toFixed(3));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };
    const onScroll = () => {
      scrollY = Math.min(window.scrollY, el.offsetHeight);
      schedule();
    };
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)');
    const onMove = (e: PointerEvent) => {
      if (!finePointer.matches) return;
      const r = el.getBoundingClientRect();
      px = ((e.clientX - r.left) / r.width - 0.5) * 2;
      py = ((e.clientY - r.top) / r.height - 0.5) * 2;
      schedule();
    };
    const onLeave = () => {
      px = 0;
      py = 0;
      schedule();
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('scroll', onScroll);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerleave', onLeave);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [root]);
}

/** Thin arrow pointing in the reading direction (leftwards in RTL). */
function ArrowReading() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
      <path
        d="M19 12H5M11 6l-6 6 6 6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LoginHero({ nextId }: { nextId: string }) {
  const ref = useRef<HTMLElement>(null);
  useHeroMotion(ref);
  const scrollToNext = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(nextId);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(
      () => target.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }),
      reducedMotion() ? 0 : 600,
    );
  };

  return (
    <section ref={ref} className="ori-hero" dir="rtl" aria-labelledby="ori-hero-title" data-testid="login-hero">
      <header className="ori-hero__nav">
        <span className="ori-hero__logo">
          <LogoMark className="ori-hero__logo-mark" />
          <span className="ori-hero__logo-text" dir="ltr">
            Ori <span>Travel AI</span>
          </span>
        </span>
      </header>

      <div className="ori-hero__ghost-wrap" aria-hidden="true">
        <span className="ori-hero__ghost" dir="ltr">
          Or
          <span className="ori-hero__ghost-i">
            ı<span className="ori-hero__ghost-dot" />
          </span>
        </span>
      </div>

      <div className="ori-hero__object-wrap">
        <span className="ori-hero__keylight" aria-hidden="true" />
        <span className="ori-hero__shadow" aria-hidden="true" />
        <img
          className="ori-hero__object"
          src={heroObject}
          alt="מזוודה קשיחה בצבע שמנת עם ידית טלסקופית"
          width={1086}
          height={1448}
          fetchPriority="high"
          decoding="async"
        />
      </div>

      <div className="ori-hero__text">
        <h1 id="ori-hero-title" className="ori-hero__title">
          {HEADLINE.map((line, i) => (
            <span key={line} className="ori-hero__line" style={{ animationDelay: `${300 + i * 80}ms` }}>
              {line}
            </span>
          ))}
        </h1>
        <p className="ori-hero__sub">
          חפשו, השוו ותכננו טיול משפחתי — עם שקיפות מלאה לגבי מקור כל מחיר.
          <br />
          המערכת מכינה הזמנות — אף פעם לא קונה בשמכם.
        </p>
        <div className="ori-hero__actions">
          <a className="ori-hero__cta" href={`#${nextId}`} onClick={scrollToNext}>
            כניסה
          </a>
          <a className="ori-hero__arrow" href={`#${nextId}`} onClick={scrollToNext} aria-label="מעבר לטופס הכניסה">
            <ArrowReading />
          </a>
        </div>
      </div>

      <div className="ori-hero__macro-wrap" aria-hidden="true">
        <img
          className="ori-hero__macro"
          src={heroMacro}
          alt=""
          width={1536}
          height={1024}
          loading="lazy"
          decoding="async"
        />
      </div>
    </section>
  );
}
