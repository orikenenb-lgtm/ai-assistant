/**
 * Decorative per-page backdrop for the authenticated app: a masked travel scene on the reading-END side (away from
 * the page title) with an isolated 3D object floating over it. Both move with the scroll (scene slower, object
 * faster + slight tilt), giving depth as the content cards slide over them. Purely decorative: aria-hidden,
 * pointer-events none, behind <main>; static when the user prefers reduced motion.
 */
import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { OBJECTS, SCENES } from '@/assets/travel';
import { float, gsap, isSmallScreen, prefersReducedMotion } from '@/features/motion/gsap';
import { artFor } from './routes';
import './scenery.css';

export default function PageScenery() {
  const { pathname } = useLocation();
  const art = artFor(pathname);
  const scene = SCENES[art.scene];
  const object = OBJECTS[art.object];
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!root.current || prefersReducedMotion()) return;
    const small = isSmallScreen();
    const ctx = gsap.context(() => {
      // Entrance (route change): the object settles in from below with a small turn.
      gsap.from('.scenery__object', { y: 50, rotate: 6, opacity: 0, duration: 1.1, ease: 'power3.out' });
      gsap.from('.scenery__scene', { opacity: 0, scale: 1.06, duration: 1.4, ease: 'power2.out' });
      // Scroll: scene drifts down slower than the page, object rises faster and tilts.
      const range = { start: 0, end: small ? 500 : 900, scrub: 0.6 };
      gsap.to('.scenery__scene', { yPercent: small ? 10 : 22, ease: 'none', scrollTrigger: { ...range, scrub: true } });
      gsap.to('.scenery__object', {
        y: small ? -60 : -180,
        rotate: -7,
        scale: 0.92,
        ease: 'none',
        scrollTrigger: range,
      });
      float('.scenery__object-img', small ? 6 : 10, 3.4);
    }, root);
    return () => ctx.revert();
  }, [pathname]);

  return (
    <div ref={root} className="scenery" aria-hidden="true" data-testid="page-scenery" data-scene={art.scene} data-object={art.object}>
      <img
        className="scenery__scene"
        src={scene.src}
        srcSet={scene.srcSet}
        sizes="(min-width: 1024px) 60vw, 100vw"
        width={scene.width}
        height={scene.height}
        alt=""
        decoding="async"
        fetchPriority="low"
      />
      <div className="scenery__object">
        <img
          className="scenery__object-img"
          src={object.src}
          width={object.width}
          height={object.height}
          alt=""
          decoding="async"
        />
      </div>
    </div>
  );
}
