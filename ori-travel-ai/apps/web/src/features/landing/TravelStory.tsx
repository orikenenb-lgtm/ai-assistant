/**
 * Public scroll story on the login page, BELOW the login form (logging in is never delayed by it).
 * Six scenes built from the owner's travel renders; every claim describes something the app really does
 * (search + compare with labeled data sources, family traveler profiles, budgets, booking preparation that the
 * family approves — no automatic purchase). Static marketing only: no API calls, no private data.
 * Motion: GSAP ScrollTrigger (transforms / opacity / clip-path), native scrolling, nothing when reduced motion.
 */
import { useLayoutEffect, useRef } from 'react';
import { OBJECTS, SCENES, type TravelScene } from '@/assets/travel';
import {
  fadeSlide,
  float,
  gsap,
  imageReveal,
  isSmallScreen,
  parallax,
  prefersReducedMotion,
  ScrollTrigger,
  scrub,
  staggerIn,
  textReveal,
} from '@/features/motion/gsap';
import './TravelStory.css';

function SceneImg({ s, className, sizes = '(min-width: 1024px) 50vw, 100vw' }: { s: TravelScene; className?: string; sizes?: string }) {
  return (
    <img
      className={className}
      src={s.src}
      srcSet={s.srcSet}
      sizes={sizes}
      width={s.width}
      height={s.height}
      alt={s.alt}
      loading="lazy"
      decoding="async"
    />
  );
}

const INPUTS = ['יעד ותאריכים', 'מספר נוסעים וגילאי הילדים', 'מזוודות לבטן', 'תקציב לטיול', 'העדפות המשפחה'];

const DESTINATIONS = [
  { s: SCENES.greekHarbor, label: 'איים ומפרצים' },
  { s: SCENES.mountainLake, label: 'הרים ואגמים' },
  { s: SCENES.tropical, label: 'חופים טרופיים' },
  { s: SCENES.alpine, label: 'חופשת שלג' },
];

const STORIES = [
  {
    img: OBJECTS.family,
    title: 'משפחה',
    text: 'פרופיל לכל נוסע, גילאי הילדים נשמרים, ותקציב הטיול מחושב גם לכל נוסע.',
  },
  {
    img: OBJECTS.checkIn,
    title: 'לבד',
    text: 'מספרים לעוזר לאן ומתי — והוא מחפש טיסות, מלונות ואטרקציות ומשווה ביניהם.',
  },
  {
    img: OBJECTS.passport,
    title: 'זוג',
    text: 'סריקת השנה מוצאת את היום הזול לטוס, ומשם מכינים הזמנה שאתם מאשרים.',
  },
];

export function TravelStory({ loginId }: { loginId: string }) {
  const root = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || prefersReducedMotion()) return;
    const small = isSmallScreen();
    const q = (s: string) => el.querySelector(s) as Element;
    const ctx = gsap.context(() => {
      // 1 — the plane crosses the sky in the reading direction while the page scrolls.
      scrub('.story-plane', q('.story--journey'), { xPercent: small ? -30 : -70, y: small ? -40 : -120, rotate: -6 }, { start: 'top bottom', end: 'bottom top', scrub: 0.8 });
      float('.story-plane img', 8, 3);
      textReveal('.story--journey .story__line', q('.story--journey'));

      // 2 — suitcase and passport wallet converge; the boarding pass rises between them.
      fadeSlide('.story-suitcase', q('.story--plan'), { x: small ? 40 : 160 });
      fadeSlide('.story-wallet', q('.story--plan'), { x: small ? -40 : -160 });
      fadeSlide('.story-pass', q('.story--plan'), { y: 80 });
      scrub('.story-suitcase', q('.story--plan'), { y: -40, rotate: 3 });
      scrub('.story-wallet', q('.story--plan'), { y: -70, rotate: -5 });
      textReveal('.story--plan .story__line', q('.story--plan'));
      staggerIn('.story__inputs li', q('.story__inputs'), 0.07);

      // 3 — destinations are uncovered by masks, each drifting at its own depth.
      gsap.utils.toArray<HTMLElement>('.story-dest').forEach((card, i) => {
        imageReveal(card.querySelector('.story-dest__frame')!, card, i % 2 ? 'start' : 'end');
        parallax(card, q('.story--world'), small ? 30 : [60, 120, 90, 150][i]);
      });
      textReveal('.story--world .story__line', q('.story--world'));

      // 4 — one large immersive image with two smaller ones floating at different speeds.
      parallax('.story-luxe__main img', q('.story--luxe'), small ? 40 : 120);
      parallax('.story-luxe__a', q('.story--luxe'), small ? 30 : -160);
      parallax('.story-luxe__b', q('.story--luxe'), small ? 30 : -80);
      imageReveal(q('.story-luxe__main'), q('.story--luxe'), 'bottom');
      textReveal('.story--luxe .story__line', q('.story--luxe'));

      // 5 — alternating stories.
      gsap.utils.toArray<HTMLElement>('.story-row').forEach((row, i) => {
        fadeSlide(row.querySelector('.story-row__img')!, row, { x: (i % 2 ? -1 : 1) * (small ? 30 : 90) });
        textReveal(row.querySelectorAll('.story-row__text > *'), row, { stagger: 0.1 });
      });
      textReveal('.story--people .story__head .story__line', q('.story--people'));

      // 6 — the closing plane lands on its cloud.
      fadeSlide('.story-final__obj', q('.story--final'), { y: 90 });
      float('.story-final__obj img', 10, 3.4);
      textReveal('.story--final .story__line', q('.story--final'));
    }, el);
    // Lazy images change section heights once they load; keep trigger positions exact.
    const refresh = () => ScrollTrigger.refresh();
    const imgs = Array.from(el.querySelectorAll('img'));
    imgs.forEach((img) => img.complete || img.addEventListener('load', refresh, { once: true }));
    return () => {
      imgs.forEach((img) => img.removeEventListener('load', refresh));
      ctx.revert();
    };
  }, []);

  const toLogin = (e: React.MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(loginId);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'start' });
    window.setTimeout(() => target.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }), 700);
  };

  return (
    <div ref={root} className="story" dir="rtl" data-testid="travel-story">
      {/* 1 */}
      <section className="story__scene story--journey" aria-labelledby="story-journey">
        <div className="story__sky" aria-hidden="true" />
        <div className="story-plane" aria-hidden="true">
          <img src={OBJECTS.airplane.src} width={900} height={600} alt="" loading="lazy" decoding="async" />
        </div>
        <div className="story__copy">
          <h2 id="story-journey" className="story__title">
            <span className="story__line">החופשה הבאה שלך</span>
            <span className="story__line">מתחילה כאן</span>
          </h2>
          <p className="story__line story__text">
            עוזר AI וחיפוש טיסות, מלונות, רכבים ואטרקציות במקום אחד — עם מקור גלוי לכל מחיר.
          </p>
        </div>
      </section>

      {/* 2 */}
      <section className="story__scene story--plan" aria-labelledby="story-plan">
        <div className="story__copy">
          <h2 id="story-plan" className="story__title">
            <span className="story__line">אתה בוחר.</span>
            <span className="story__line">אנחנו מתכננים.</span>
          </h2>
          <ul className="story__inputs" aria-label="מה אפשר להגדיר בחיפוש ובטיול">
            {INPUTS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
        <div className="story-plan__stage" aria-hidden="true">
          <img className="story-suitcase" src={OBJECTS.suitcase.src} width={600} height={900} alt="" loading="lazy" decoding="async" />
          <img className="story-pass" src={OBJECTS.passport.src} width={900} height={600} alt="" loading="lazy" decoding="async" />
          <img className="story-wallet" src={OBJECTS.passportWallet.src} width={900} height={600} alt="" loading="lazy" decoding="async" />
        </div>
      </section>

      {/* 3 */}
      <section className="story__scene story--world" aria-labelledby="story-world">
        <div className="story__copy story__copy--center">
          <h2 id="story-world" className="story__title">
            <span className="story__line">מגלים עולם</span>
            <span className="story__line">של אפשרויות</span>
          </h2>
        </div>
        <ul className="story-dests">
          {DESTINATIONS.map((d) => (
            <li key={d.label} className="story-dest">
              <div className="story-dest__frame">
                <SceneImg s={d.s} sizes="(min-width: 1024px) 25vw, 50vw" />
              </div>
              <span className="story-dest__label">{d.label}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 4 */}
      <section className="story__scene story--luxe" aria-labelledby="story-luxe">
        <div className="story-luxe__media">
          <div className="story-luxe__main">
            <SceneImg s={SCENES.poolVilla} sizes="(min-width: 1024px) 60vw, 100vw" />
          </div>
          <SceneImg s={SCENES.spa} className="story-luxe__a" sizes="(min-width: 1024px) 22vw, 40vw" />
          <SceneImg s={SCENES.poolsideRelax} className="story-luxe__b" sizes="(min-width: 1024px) 22vw, 40vw" />
        </div>
        <div className="story__copy">
          <h2 id="story-luxe" className="story__title">
            <span className="story__line">כל רגע בחופשה,</span>
            <span className="story__line">בדיוק כמו שדמיינת</span>
          </h2>
          <p className="story__line story__text">
            משווים מלונות לפי מחיר, דירוג, מיקום וגמישות הביטול — וכל ציון מוסבר.
          </p>
        </div>
      </section>

      {/* 5 */}
      <section className="story__scene story--people" aria-labelledby="story-people">
        <div className="story__head story__copy story__copy--center">
          <h2 id="story-people" className="story__title">
            <span className="story__line">כל חופשה מתחילה</span>
            <span className="story__line">בסיפור אחר</span>
          </h2>
        </div>
        <ul className="story-rows">
          {STORIES.map((s) => (
            <li key={s.title} className="story-row">
              <img className="story-row__img" src={s.img.src} width={s.img.width} height={s.img.height} alt={s.img.alt} loading="lazy" decoding="async" />
              <div className="story-row__text">
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* 6 */}
      <section className="story__scene story--final" aria-labelledby="story-final">
        <div className="story-final__obj" aria-hidden="true">
          <img src={OBJECTS.airplaneCloud.src} width={900} height={507} alt="" loading="lazy" decoding="async" />
        </div>
        <div className="story__copy story__copy--center">
          <h2 id="story-final" className="story__title story__title--xl">
            <span className="story__line">החופשה המושלמת</span>
            <span className="story__line">מחכה לך</span>
          </h2>
          <p className="story__line story__text">אין רכישה בלי אישור שלכם, וכל מחיר מסומן לפי המקור שלו.</p>
          <a className="story__line story__cta" href={`#${loginId}`} onClick={toLogin}>
            בואו נתחיל
          </a>
        </div>
      </section>
    </div>
  );
}
