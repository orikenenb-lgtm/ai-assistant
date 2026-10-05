/**
 * דיאלוג אישור מודאלי: מה יתבצע, על מה, ההשפעה, אזהרה (ענבר), סיבה וספירה לאחור עד פקיעה.
 * Esc = דחייה. Enter לא מאשר כברירת מחדל: המיקוד ההתחלתי על הדיאלוג עצמו, לא על "אשר".
 * כל שאר האפליקציה inert בזמן שהדיאלוג פתוח (ראה App.tsx), כך ש-Tab לא יוצא ממנו.
 * אפשר גם לענות בקול: כפתור מיקרופון בתוך הדיאלוג, ואז "כן" / "לא".
 */
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import type { ApprovalRequest } from '../../shared/types';
import { useNowMs } from '../hooks/environment';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';
import { formatCountdown } from '../state/format';
import { IconShield } from './Icons';
import { MicButton } from './VoiceButtons';

function ApprovalBody({ request, index, total }: { request: ApprovalRequest; index: number; total: number }) {
  const controller = useController();
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const descId = useId();
  const now = useNowMs();
  const displays = request.displays ?? [];
  const [displayId, setDisplayId] = useState<string>(
    (request.defaultDisplayId && displays.some((d) => d.id === request.defaultDisplayId) ? request.defaultDisplayId : undefined) ??
      displays.find((d) => d.primary)?.id ??
      displays[0]?.id ??
      '',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useFocusTrap(ref);

  const expiresAt = Date.parse(request.expiresAt);
  const msLeft = Number.isFinite(expiresAt) ? expiresAt - now : 0;
  const expired = msLeft <= 0;

  const decide = async (approved: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await controller.decideApproval(
      request.approvalId,
      approved,
      approved && displays.length > 0 && displayId ? displayId : undefined,
    );
    // בהצלחה הבקשה יורדת מהרשימה והרכיב מתפרק; בכישלון מציגים את הסיבה
    if (!res.ok) {
      setError(res.message_he);
      setBusy(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      void decide(false);
      return;
    }
    // Enter על הדיאלוג או על רדיו לא מאשר. רק לחיצה (או Enter על כפתור ממוקד במפורש) מבצעת.
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
    }
  };

  return (
    <div
      className="modal approval frame"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descId}
      ref={ref}
      tabIndex={-1}
      onKeyDown={onKeyDown}
    >
      <header className="approval-head">
        <IconShield size={22} />
        <h2 id={titleId}>{he.approval.title}</h2>
        {total > 1 && <span className="approval-queue">{he.approval.queue(index + 1, total)}</span>}
      </header>

      <dl className="approval-grid" id={descId}>
        <dt>{he.approval.action}</dt>
        <dd>{request.action_he}</dd>
        <dt>{he.approval.target}</dt>
        <dd>{request.target_he}</dd>
        <dt>{he.approval.impact}</dt>
        <dd>{request.impact_he}</dd>
        <dt>{he.approval.reason}</dt>
        <dd>{he.approval.reasons[request.reason]}</dd>
      </dl>

      {request.warning_he && (
        <p className="approval-warning" role="note">
          {request.warning_he}
        </p>
      )}

      {displays.length > 0 && (
        <fieldset className="approval-displays">
          <legend>{he.approval.displays}</legend>
          <div className="radio-list">
            {displays.map((d) => (
              <label key={d.id} className="radio-row">
                <input
                  type="radio"
                  name={`approval-display-${request.approvalId}`}
                  value={d.id}
                  checked={displayId === d.id}
                  onChange={() => setDisplayId(d.id)}
                />
                <span className="radio-main">{d.label}</span>
                <span className="radio-sub" dir="ltr">
                  {d.width}×{d.height} · {Math.round(d.scaleFactor * 100)}%
                </span>
                {d.primary && <span className="tag">{he.bottom.displayPrimary}</span>}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <p className="approval-countdown" data-expired={expired ? 'on' : undefined} aria-live="off">
        {expired ? he.approval.expired : he.approval.expiresIn(formatCountdown(msLeft))}
      </p>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <p className="approval-hint">{he.approval.keyboardHint}</p>
      {/* אפשר לענות בקול: "כן"/"לא" נשלחים כתשובה לאישור (המנוע מזהה אותם). הדיאלוג נשאר עד שהאישור נסגר. */}
      <div className="approval-voice">
        <MicButton size="small" />
        <p className="approval-hint">{he.approval.voiceHint}</p>
      </div>

      <div className="approval-actions">
        <button type="button" className="btn" disabled={busy} onClick={() => void decide(false)}>
          {he.approval.reject}
        </button>
        <button
          type="button"
          className="btn btn-amber"
          disabled={busy || expired || (displays.length > 0 && !displayId)}
          onClick={() => void decide(true)}
        >
          {busy ? he.approval.sending : he.approval.approve}
        </button>
      </div>
    </div>
  );
}

export function ApprovalDialog() {
  const pending = useUiState((s) => s.pendingApprovals);
  const first = pending[0];
  if (!first) return null;
  return (
    <div className="modal-backdrop">
      {/* key: בקשה חדשה = רכיב חדש (מצב בחירה ושגיאה נקיים) */}
      <ApprovalBody key={first.approvalId} request={first} index={0} total={pending.length} />
    </div>
  );
}
