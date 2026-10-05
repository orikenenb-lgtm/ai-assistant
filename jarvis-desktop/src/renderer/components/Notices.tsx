/**
 * הודעות על-מסך: באנר תזכורות שהוחמצו, מחוון צילום מסך, והודעות קופצות (toasts).
 */
import { useState } from 'react';
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';
import { IconBell, IconCamera, IconClose } from './Icons';

export function MissedRemindersBanner() {
  const controller = useController();
  const missed = useUiState((s) => s.missedReminders);
  const [busy, setBusy] = useState(false);
  if (missed.length === 0) return null;

  const acknowledge = async () => {
    setBusy(true);
    try {
      await controller.acknowledgeMissedReminders();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="banner" data-tone="amber" role="alert">
      <span className="banner-icon" aria-hidden="true">
        <IconBell size={18} />
      </span>
      <div className="banner-body">
        <strong>{he.missed.title(missed.length)}</strong>
        <span className="banner-sub">{he.missed.explain}</span>
        <ul className="banner-list">
          {missed.slice(0, 4).map((r) => (
            <li key={r.id}>
              {r.text} — <span className="banner-time">{r.dueLocal_he}</span>
            </li>
          ))}
          {missed.length > 4 && <li>…</li>}
        </ul>
      </div>
      <button type="button" className="btn btn-amber" disabled={busy} onClick={() => void acknowledge()}>
        {he.missed.acknowledge}
      </button>
    </div>
  );
}

export function ScreenCaptureIndicator() {
  const capture = useUiState((s) => s.screenCapture);
  if (!capture) return null;
  const active = capture.stage === 'capturing' || capture.stage === 'sending';
  return (
    <div className="capture-indicator" data-stage={capture.stage} role="status" aria-live="assertive">
      <IconCamera size={16} />
      <span>{he.screenCapture[capture.stage]}</span>
      {capture.displayLabel && <span className="capture-display">· {capture.displayLabel}</span>}
      {active && <span className="capture-pulse" aria-hidden="true" />}
    </div>
  );
}

/** בפס (בהגדרות ובתצוגה הקומפקטית) מוצגות רק ההודעות האחרונות, בשורה אחת. */
const STRIP_MAX = 2;

/**
 * הודעות קופצות.
 * - stack: ערימה צפה בפינה (תצוגה מלאה בלי הגדרות). רק ההודעה עצמה קולטת לחיצות.
 * - strip: פס דק בתחתית מסך ההגדרות — חלק מהפריסה, לכן לעולם לא מכסה שדות או כפתורים.
 *   כל הודעה בשורה אחת עם "…", והטקסט המלא ב-title.
 */
export function Toasts({ variant = 'stack', inert = false }: { variant?: 'stack' | 'strip'; inert?: boolean }) {
  const controller = useController();
  const all = useUiState((s) => s.toasts);
  if (variant === 'strip' && all.length === 0) return null;
  const toasts = variant === 'strip' ? all.slice(-STRIP_MAX) : all;
  return (
    <div className="toasts" data-variant={variant} role="region" aria-label={he.toasts.region} inert={inert || undefined}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className="toast"
          data-kind={t.kind}
          role={t.kind === 'error' ? 'alert' : 'status'}
          title={variant === 'strip' ? t.text : undefined}
        >
          <span className="toast-text">{t.text}</span>
          <button type="button" className="toast-close" aria-label={he.toasts.close} onClick={() => controller.dismissToast(t.id)}>
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}

/**
 * ההודעה האחרונה בתצוגה הקומפקטית: פס דק בשורה אחת בתוך עמודת המידע (במקום שורת השיחה),
 * כך שהיא לא מכסה את המיקרופון / העצירה. הטקסט המלא ב-title.
 */
export function CompactToast() {
  const controller = useController();
  const toast = useUiState((s) => s.toasts[s.toasts.length - 1] ?? null);
  if (!toast) return null;
  return (
    <div className="compact-toast" data-kind={toast.kind} role={toast.kind === 'error' ? 'alert' : 'status'} title={toast.text}>
      <span className="compact-toast-text" dir="auto">
        {toast.text}
      </span>
      <button type="button" className="toast-close" aria-label={he.toasts.close} onClick={() => controller.dismissToast(toast.id)}>
        <IconClose size={12} />
      </button>
    </div>
  );
}
