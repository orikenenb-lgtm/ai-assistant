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

export function Toasts() {
  const controller = useController();
  const toasts = useUiState((s) => s.toasts);
  return (
    <div className="toasts" role="region" aria-label={he.toasts.region}>
      {toasts.map((t) => (
        <div key={t.id} className="toast" data-kind={t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="toast-text">{t.text}</span>
          <button type="button" className="toast-close" aria-label={he.toasts.close} onClick={() => controller.dismissToast(t.id)}>
            <IconClose size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
