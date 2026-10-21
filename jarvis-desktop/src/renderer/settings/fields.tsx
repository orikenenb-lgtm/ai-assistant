/**
 * רכיבי שדות למסך ההגדרות. כל שינוי נשלח ל-main לאימות, והשגיאה (אם יש) מוצגת ליד השדה.
 * שדות טקסט נשמרים ביציאה מהשדה / Enter (לא בכל הקשה), Esc מחזיר את הערך השמור.
 */
import { useCallback, useId, useState, type ReactNode } from 'react';
import type { Settings, SettingsPatch } from '../../shared/settings-schema';
import { he } from '../i18n/he';
import { useController } from '../state/controller';

/* ---------------- שמירה עם סטטוס לכל שדה ---------------- */

export type SaveState = { state: 'saving' } | { state: 'saved' } | { state: 'error'; message: string };

export interface Saver {
  status: Record<string, SaveState | undefined>;
  save(field: string, patch: SettingsPatch): Promise<boolean>;
  setError(field: string, message: string | null): void;
}

export function useSaver(): Saver {
  const controller = useController();
  const [status, setStatus] = useState<Record<string, SaveState | undefined>>({});
  const save = useCallback(
    async (field: string, patch: SettingsPatch) => {
      setStatus((s) => ({ ...s, [field]: { state: 'saving' } }));
      const res = await controller.updateSettings(patch);
      setStatus((s) => ({ ...s, [field]: res.ok ? { state: 'saved' } : { state: 'error', message: res.message_he } }));
      return res.ok;
    },
    [controller],
  );
  const setError = useCallback((field: string, message: string | null) => {
    setStatus((s) => ({ ...s, [field]: message ? { state: 'error', message } : undefined }));
  }, []);
  return { status, save, setError };
}

export function SaveStatus({ status }: { status: SaveState | undefined }) {
  if (!status) return null;
  if (status.state === 'saving') return <span className="save-status">{he.settings.saving}</span>;
  if (status.state === 'saved') return <span className="save-status" data-tone="green">{he.settings.saved}</span>;
  return (
    <span className="field-error" role="alert">
      {status.message}
    </span>
  );
}

/* ---------------- מבנה ---------------- */

export function Group({ title, children, note }: { title: string; children: ReactNode; note?: ReactNode }) {
  return (
    <fieldset className="group">
      <legend>{title}</legend>
      {note && <div className="group-note">{note}</div>}
      {children}
    </fieldset>
  );
}

export function Field({
  label,
  htmlFor,
  hint,
  status,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  status?: SaveState;
  children: ReactNode;
}) {
  return (
    <div className="field">
      {htmlFor ? (
        <label className="field-label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="field-label">{label}</span>
      )}
      <div className="field-control">{children}</div>
      {hint && <div className="field-hint">{hint}</div>}
      <SaveStatus status={status} />
    </div>
  );
}

/* ---------------- בקרות ---------------- */

export function Toggle({
  label,
  checked,
  onChange,
  disabled,
  hint,
  status,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  hint?: ReactNode;
  status?: SaveState;
}) {
  const id = useId();
  return (
    <div className="field field-toggle">
      <label className="toggle" htmlFor={id}>
        <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" aria-hidden="true">
          <span className="toggle-thumb" />
        </span>
        <span className="toggle-label">{label}</span>
      </label>
      {hint && <div className="field-hint">{hint}</div>}
      <SaveStatus status={status} />
    </div>
  );
}

export function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  status,
  disabled,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
  hint?: ReactNode;
  status?: SaveState;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id} hint={hint} status={status}>
      <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function RadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  status,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string; hint?: string }>;
  onChange: (value: T) => void;
  status?: SaveState;
}) {
  const name = useId();
  return (
    <div className="field" role="radiogroup" aria-label={label}>
      <span className="field-label">{label}</span>
      <div className="radio-list">
        {options.map((o) => (
          <label key={o.value} className="radio-row">
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} />
            <span className="radio-main">{o.label}</span>
            {o.hint && <span className="radio-sub">{o.hint}</span>}
          </label>
        ))}
      </div>
      <SaveStatus status={status} />
    </div>
  );
}

/**
 * שדה טקסט עם טיוטה מקומית. נשמר ב-blur/Enter, רק אם השתנה ועבר בדיקה מקומית.
 * ההורה מרנדר עם key={value} — כשהערך השמור משתנה, הטיוטה מתאפסת.
 */
export function TextInput({
  label,
  value,
  onCommit,
  validate,
  hint,
  status,
  ltr,
  maxLength,
  placeholder,
  inputMode,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  validate?: (value: string) => string | null;
  hint?: ReactNode;
  status?: SaveState;
  ltr?: boolean;
  maxLength?: number;
  placeholder?: string;
  inputMode?: 'numeric' | 'text' | 'url';
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [localError, setLocalError] = useState<string | null>(null);

  const commit = () => {
    if (draft === value) {
      setLocalError(null);
      return;
    }
    const err = validate?.(draft) ?? null;
    setLocalError(err);
    if (!err) onCommit(draft);
  };

  return (
    <Field label={label} htmlFor={id} hint={hint} status={localError ? { state: 'error', message: localError } : status}>
      <input
        id={id}
        className="input"
        type="text"
        dir={ltr ? 'ltr' : draft ? 'auto' : 'rtl'}
        value={draft}
        maxLength={maxLength}
        placeholder={placeholder}
        inputMode={inputMode}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={localError ? true : undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape' && draft !== value) {
            e.preventDefault();
            e.stopPropagation();
            setDraft(value);
            setLocalError(null);
          }
        }}
      />
    </Field>
  );
}

/** מחוון (range) שנשמר כשמשחררים אותו — לא בכל צעד. */
export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onCommit,
  hint,
  status,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onCommit: (value: number) => void;
  hint?: ReactNode;
  status?: SaveState;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <Field label={label} htmlFor={id} hint={hint} status={status}>
      <div className="slider-row">
        <input
          id={id}
          type="range"
          className="slider"
          min={min}
          max={max}
          step={step}
          value={draft}
          aria-valuetext={format(draft)}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <output htmlFor={id} className="hud-num slider-value" dir="ltr">
          {format(draft)}
        </output>
      </div>
    </Field>
  );
}

/** כפתור שמריץ פעולה אסינכרונית ומציג "בודק…" בזמן הריצה. */
export function ActionButton({
  label,
  onRun,
  className = 'btn',
  disabled,
}: {
  label: string;
  onRun: () => Promise<void>;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={className}
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await onRun();
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? he.settings.running : label}
    </button>
  );
}

/** כפתור הרסני עם אישור בשני שלבים (בלי window.confirm החוסם). */
export function ConfirmButton({
  label,
  confirmText,
  onConfirm,
  className = 'btn btn-danger',
}: {
  label: string;
  confirmText: string;
  onConfirm: () => Promise<void>;
  className?: string;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking) {
    return (
      <button type="button" className={className} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm-inline" role="group" aria-label={confirmText}>
      <span className="confirm-text">{confirmText}</span>
      <button
        type="button"
        className="btn btn-danger"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {he.settings.confirm}
      </button>
      {/* המיקוד עובר ל"ביטול" — לחיצת Enter כפולה לא תמחק בטעות */}
      <button type="button" className="btn" disabled={busy} autoFocus onClick={() => setAsking(false)}>
        {he.settings.cancel}
      </button>
    </span>
  );
}

/** קורא את ההגדרות הנוכחיות מה-store (תמיד קיימות כשמסך ההגדרות פתוח). */
export type SectionProps = { settings: Settings; saver: Saver };
