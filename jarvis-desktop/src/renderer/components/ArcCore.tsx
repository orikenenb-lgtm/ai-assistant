/**
 * ליבת "כור הקשת": טבעות SVG ושנתות שמסתובבות במהירות שונה לכל מצב.
 * האנימציה רצה ב-requestAnimationFrame ומעדכנת את ה-DOM ישירות (בלי רינדור React בכל פריים).
 * בהאזנה — הליבה פועמת לפי עוצמת המיקרופון האמיתית; בדיבור — לפי עוצמת ההשמעה.
 * בהפחתת תנועה: סטטית לגמרי, ועדיין בצבע המצב.
 */
import { useEffect, useId, useRef } from 'react';
import type { AssistantState } from '../../shared/types';
import { useController } from '../state/controller';

interface Motion {
  /** מעלות לשנייה לכל טבעת: שנתות חיצוניות, קשתות, נקודות, סלילים. */
  rot: readonly [number, number, number, number];
  /** פעימה כשאין אות אמיתי: תדר (Hz) ועוצמה. */
  pulseHz: number;
  pulseAmp: number;
}

const MOTION: Record<AssistantState, Motion> = {
  IDLE: { rot: [3, -6, 9, 4], pulseHz: 0.22, pulseAmp: 0.025 },
  LISTENING: { rot: [8, -16, 24, 10], pulseHz: 0, pulseAmp: 0 },
  THINKING: { rot: [24, -48, 72, 30], pulseHz: 1.1, pulseAmp: 0.05 },
  EXECUTING: { rot: [40, -80, 120, 50], pulseHz: 1.6, pulseAmp: 0.06 },
  SPEAKING: { rot: [10, -20, 30, 12], pulseHz: 0.7, pulseAmp: 0.04 },
  AWAITING_APPROVAL: { rot: [5, -10, 14, 6], pulseHz: 0.8, pulseAmp: 0.05 },
  ERROR: { rot: [1.5, -3, 4, 2], pulseHz: 0.35, pulseAmp: 0.02 },
};

const TICKS = Array.from({ length: 72 }, (_, i) => i);
const COIL_CIRC = 2 * Math.PI * 50;
const ARC_CIRC = 2 * Math.PI * 78;

export function ArcCore({ state, reducedMotion, size }: { state: AssistantState; reducedMotion: boolean; size: 'full' | 'compact' }) {
  const controller = useController();
  const gradId = `core-grad-${useId().replace(/:/g, '')}`;
  const ticksRef = useRef<SVGGElement | null>(null);
  const arcsRef = useRef<SVGGElement | null>(null);
  const dotsRef = useRef<SVGGElement | null>(null);
  const coilsRef = useRef<SVGGElement | null>(null);
  const coreRef = useRef<SVGGElement | null>(null);
  const haloRef = useRef<SVGCircleElement | null>(null);
  const anglesRef = useRef<[number, number, number, number]>([0, 0, 0, 0]);

  useEffect(() => {
    const rings = [ticksRef.current, arcsRef.current, dotsRef.current, coilsRef.current];
    const core = coreRef.current;
    const halo = haloRef.current;
    if (reducedMotion) {
      // סטטי: בלי סיבוב ובלי פעימה
      for (const g of rings) g?.setAttribute('transform', 'rotate(0)');
      core?.setAttribute('transform', 'scale(1)');
      halo?.setAttribute('opacity', '0.5');
      return;
    }
    const motion = MOTION[state];
    const angles = anglesRef.current;
    let raf = 0;
    let last = performance.now();
    let t = 0;
    let level = 0;

    const frame = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      t += dt;
      for (let i = 0; i < 4; i++) {
        angles[i] = ((angles[i] ?? 0) + motion.rot[i]! * dt) % 360;
        rings[i]?.setAttribute('transform', `rotate(${(angles[i] ?? 0).toFixed(2)})`);
      }
      const src = controller.getLevelSource();
      let raw = 0;
      if (src.source) {
        const v = src.source.getLevel();
        raw = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
      }
      // החלקה: עולה מהר, יורד לאט — תחושה של מד אנלוגי
      level += (raw - level) * (raw > level ? 0.35 : 0.12);
      let scale: number;
      if (src.kind === 'mic' || src.kind === 'playback') {
        scale = 1 + level * 0.3;
      } else {
        scale = 1 + Math.sin(t * Math.PI * 2 * motion.pulseHz) * motion.pulseAmp;
      }
      core?.setAttribute('transform', `scale(${scale.toFixed(4)})`);
      const haloOpacity = src.kind === 'mic' || src.kind === 'playback' ? 0.35 + level * 0.6 : 0.45 + (scale - 1) * 4;
      halo?.setAttribute('opacity', Math.min(1, Math.max(0.2, haloOpacity)).toFixed(3));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [state, reducedMotion, controller]);

  return (
    <div className="core" data-state={state} data-size={size} aria-hidden="true">
      <svg viewBox="-100 -100 200 200" className="core-svg">
        <defs>
          <radialGradient id={gradId}>
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="32%" style={{ stopColor: 'var(--core-color)' }} stopOpacity="0.9" />
            <stop offset="70%" style={{ stopColor: 'var(--core-color)' }} stopOpacity="0.22" />
            <stop offset="100%" style={{ stopColor: 'var(--core-color)' }} stopOpacity="0" />
          </radialGradient>
        </defs>

        <circle r="97" className="core-hair" />
        <g ref={ticksRef}>
          {TICKS.map((i) => {
            const major = i % 6 === 0;
            const a = (i * 5 * Math.PI) / 180;
            const r1 = major ? 83 : 87;
            const r2 = 93;
            return (
              <line
                key={i}
                x1={(Math.cos(a) * r1).toFixed(2)}
                y1={(Math.sin(a) * r1).toFixed(2)}
                x2={(Math.cos(a) * r2).toFixed(2)}
                y2={(Math.sin(a) * r2).toFixed(2)}
                className={major ? 'core-tick core-tick-major' : 'core-tick'}
              />
            );
          })}
        </g>
        <g ref={arcsRef}>
          <circle r="78" className="core-arc" strokeDasharray={`${(ARC_CIRC / 3 - 22).toFixed(2)} 22`} />
        </g>
        <g ref={dotsRef}>
          <circle r="66" className="core-dots" strokeDasharray="1.4 5.2" />
        </g>
        <circle r="58" className="core-hair" />
        <g ref={coilsRef}>
          <circle r="50" className="core-coils" strokeDasharray={`${(COIL_CIRC / 10 - 4.5).toFixed(2)} 4.5`} />
        </g>
        <circle r="40" className="core-inner-ring" />
        <circle ref={haloRef} r="44" className="core-halo" fill={`url(#${gradId})`} opacity="0.5" />
        <g ref={coreRef}>
          <circle r="30" fill={`url(#${gradId})`} />
          <circle r="13" className="core-heart" />
          <path d="M0 -20 L17.3 10 L-17.3 10 Z" className="core-tri" />
        </g>
      </svg>
    </div>
  );
}
