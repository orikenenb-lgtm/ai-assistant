/**
 * צורת גל — רק מאודיו אמיתי: מהמיקרופון בזמן האזנה, ומההשמעה בזמן דיבור (getWaveform).
 * כשאין מקור — קו שטוח. בקול מערכת אין גישה לאות, לכן מוצגת פעימה עדינה והכיתוב "קול מערכת",
 * ולעולם לא צורת גל מזויפת.
 */
import { useEffect, useRef } from 'react';
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';

const SAMPLES = 1024;

export function Waveform({ reducedMotion }: { reducedMotion: boolean }) {
  const controller = useController();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const audioPhase = useUiState((s) => s.audioPhase);
  const speechOutput = useUiState((s) => s.speechOutput);
  const micTest = useUiState((s) => s.micTest);

  const systemVoice = audioPhase === 'SPEAKING' && speechOutput === 'system';
  const live = audioPhase === 'LISTENING' || (audioPhase === 'SPEAKING' && speechOutput === 'audio') || micTest === 'meter' || micTest === 'recording';

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const buf = new Float32Array(SAMPLES);
    let raf = 0;
    let dpr = window.devicePixelRatio || 1;

    const color = () => getComputedStyle(canvas).getPropertyValue('--core-color').trim() || '#00e5ff';

    const drawFlat = (alpha: number) => {
      const w = canvas.width;
      const h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color();
      ctx.lineWidth = 1.2 * dpr;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();
      ctx.restore();
    };

    const resize = () => {
      dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width * dpr));
      const h = Math.max(1, Math.round(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      if (!live && !systemVoice) drawFlat(0.35);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    if (!live && !systemVoice) {
      // אין אודיו פעיל: קו שטוח אחד, בלי לולאת אנימציה
      drawFlat(0.35);
      return () => ro.disconnect();
    }

    const stroke = color();
    const start = performance.now();
    const frame = (now: number) => {
      const w = canvas.width;
      const h = canvas.height;
      if (systemVoice) {
        // אין אות אמיתי — פעימה עדינה של קו שטוח בלבד
        const alpha = reducedMotion ? 0.6 : 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(((now - start) / 1000) * Math.PI * 1.2));
        drawFlat(alpha);
        if (!reducedMotion) raf = requestAnimationFrame(frame);
        return;
      }
      if (reducedMotion) {
        ctx.clearRect(0, 0, w, h);
      } else {
        // "זנב" עדין: מעמעמים את הפריים הקודם במקום למחוק
        ctx.save();
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = 'rgba(0,0,0,0.38)';
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
      }
      const src = controller.getLevelSource();
      const has = src.source ? src.source.getWaveform(buf) : false;
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 1.5 * dpr;
      if (!reducedMotion) {
        ctx.shadowColor = stroke;
        ctx.shadowBlur = 6 * dpr;
      }
      ctx.beginPath();
      if (has) {
        const points = Math.min(SAMPLES, Math.max(64, Math.round(w / (2 * dpr))));
        const step = SAMPLES / points;
        for (let i = 0; i < points; i++) {
          const v = buf[Math.floor(i * step)] ?? 0;
          const x = (i / (points - 1)) * w;
          const y = h / 2 + Math.max(-1, Math.min(1, v)) * h * 0.44;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        ctx.globalAlpha = 0.35;
        ctx.moveTo(0, h / 2);
        ctx.lineTo(w, h / 2);
      }
      ctx.stroke();
      ctx.restore();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [live, systemVoice, reducedMotion, controller]);

  return (
    <div className="wave" data-live={live ? 'on' : undefined}>
      <canvas ref={canvasRef} className="wave-canvas" role="img" aria-label={live ? he.core.waveformLabel : he.core.waveformIdle} />
      {systemVoice && <span className="wave-label">{he.core.systemVoice}</span>}
    </div>
  );
}
