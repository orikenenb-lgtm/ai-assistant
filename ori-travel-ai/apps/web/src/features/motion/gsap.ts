/**
 * Shared GSAP setup + reusable motion primitives (text reveal, image reveal, fade/slide, parallax, stagger, float,
 * scroll scrub). Rules: transforms/opacity/clip-path only (no layout properties), native scrolling (no scroll
 * hijacking — forms, dialogs, date pickers and keyboard navigation keep working), and nothing runs when the user
 * prefers reduced motion. Call these inside `gsap.context()` so a single `ctx.revert()` cleans everything up.
 */
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export { gsap, ScrollTrigger };

export const EASE_OUT = 'power3.out';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function isSmallScreen(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

type Targets = gsap.TweenTarget;

/** Lines / words rise into place when their block enters the viewport; reverses when scrolling back up. */
export function textReveal(targets: Targets, trigger: Element, opts: { stagger?: number; y?: number } = {}) {
  return gsap.from(targets, {
    y: opts.y ?? 28,
    opacity: 0,
    duration: 0.9,
    ease: EASE_OUT,
    stagger: opts.stagger ?? 0.08,
    scrollTrigger: { trigger, start: 'top 82%', toggleActions: 'play none none reverse' },
  });
}

/** Framed image uncovered by a clip-path mask (direction is logical: "start" = reading start). */
export function imageReveal(el: Element, trigger: Element = el, from: 'start' | 'end' | 'bottom' = 'bottom') {
  const rtl = document.documentElement.dir === 'rtl';
  const side = from === 'bottom' ? 'bottom' : (from === 'start') === rtl ? 'right' : 'left';
  const hidden = { top: 'inset(0 0 0 0)', bottom: 'inset(100% 0 0 0)', left: 'inset(0 100% 0 0)', right: 'inset(0 0 0 100%)' }[
    side
  ];
  return gsap.fromTo(
    el,
    { clipPath: hidden, scale: 1.12 },
    {
      clipPath: 'inset(0% 0% 0% 0%)',
      scale: 1,
      duration: 1.2,
      ease: 'power2.out',
      scrollTrigger: { trigger, start: 'top 85%', toggleActions: 'play none none reverse' },
    },
  );
}

/** Fade + slide in from an offset (x is physical px; pass a negative value for "from the right"). */
export function fadeSlide(targets: Targets, trigger: Element, offset: { x?: number; y?: number } = { y: 40 }) {
  return gsap.from(targets, {
    x: offset.x ?? 0,
    y: offset.y ?? 0,
    opacity: 0,
    duration: 1,
    ease: EASE_OUT,
    scrollTrigger: { trigger, start: 'top 80%', toggleActions: 'play none none reverse' },
  });
}

/** Scroll-linked vertical drift: `distance` px across the trigger's pass through the viewport (scrubbed, both ways). */
export function parallax(el: Targets, trigger: Element, distance: number) {
  return gsap.fromTo(
    el,
    { y: -distance / 2 },
    {
      y: distance / 2,
      ease: 'none',
      scrollTrigger: { trigger, start: 'top bottom', end: 'bottom top', scrub: true },
    },
  );
}

/** Children enter one after another. */
export function staggerIn(targets: Targets, trigger: Element, each = 0.12) {
  return gsap.from(targets, {
    y: 36,
    opacity: 0,
    duration: 0.9,
    ease: EASE_OUT,
    stagger: each,
    scrollTrigger: { trigger, start: 'top 80%', toggleActions: 'play none none reverse' },
  });
}

/** Slow idle float for isolated objects (restrained: a few px, long period). */
export function float(el: Targets, amplitude = 10, duration = 3.2) {
  return gsap.to(el, { y: -amplitude, duration, repeat: -1, yoyo: true, ease: 'sine.inOut' });
}

/** Scroll-scrubbed tween between the trigger's `start`/`end` positions. */
export function scrub(
  el: Targets,
  trigger: Element,
  vars: gsap.TweenVars,
  range: { start?: string; end?: string; scrub?: boolean | number } = {},
) {
  return gsap.to(el, {
    ease: 'none',
    ...vars,
    scrollTrigger: {
      trigger,
      start: range.start ?? 'top bottom',
      end: range.end ?? 'bottom top',
      scrub: range.scrub ?? 0.6,
    },
  });
}
