/**
 * שדה מפתח API — כתיבה בלבד. הערך לא נקרא לעולם מ-main; מוצג רק אם הוא מוגדר ואיפה הוא נשמר.
 */
import { useId, useState } from 'react';
import type { SecretName, SecretsStatus } from '../../shared/settings-schema';
import { he } from '../i18n/he';
import { useController } from '../state/controller';
import { ConfirmButton, Field } from './fields';
import { MIN_SECRET_LENGTH, secretStatusText } from './helpers';

export function SecretField({
  name,
  label,
  status,
  onStatus,
}: {
  name: SecretName;
  label: string;
  status: SecretsStatus | null;
  onStatus: (status: SecretsStatus) => void;
}) {
  const controller = useController();
  const id = useId();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'green' | 'red'; text: string } | null>(null);
  const entry = status?.entries.find((e) => e.name === name);
  const configured = entry?.configured ?? false;

  const save = async () => {
    const trimmed = value.trim();
    if (trimmed.length < MIN_SECRET_LENGTH) {
      setMessage({ tone: 'red', text: he.settings.secrets.tooShort });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const res = await controller.api.secrets.set(name, trimmed);
      if (res.ok) {
        // מוחקים את הערך מהזיכרון של הממשק מיד אחרי השמירה
        setValue('');
        onStatus(res.status);
        setMessage({ tone: 'green', text: he.settings.secrets.saved });
      } else {
        setMessage({ tone: 'red', text: res.message_he });
      }
    } catch {
      setMessage({ tone: 'red', text: he.settings.saveFailed });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setMessage(null);
    try {
      const next = await controller.api.secrets.clear(name);
      onStatus(next);
      const after = next.entries.find((e) => e.name === name);
      setMessage(
        after?.configured && after.source === 'env'
          ? { tone: 'red', text: he.settings.secrets.envOverride }
          : { tone: 'green', text: he.settings.secrets.cleared },
      );
    } catch {
      setMessage({ tone: 'red', text: he.settings.saveFailed });
    }
  };

  return (
    <Field label={label} htmlFor={id} hint={he.settings.secrets.writeOnly}>
      <div className="secret-row">
        <span className="secret-status" data-configured={configured ? 'on' : undefined}>
          {secretStatusText(entry)}
        </span>
        <input
          id={id}
          className="input"
          type="password"
          dir="ltr"
          autoComplete="off"
          spellCheck={false}
          placeholder={he.settings.secrets.placeholder}
          value={value}
          maxLength={512}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void save();
            }
          }}
        />
        <button type="button" className="btn btn-primary" disabled={busy || value.trim().length === 0} onClick={() => void save()}>
          {busy ? he.settings.saving : he.settings.secrets.save}
        </button>
        {configured && entry?.source !== 'env' && (
          <ConfirmButton label={he.settings.secrets.clear} confirmText={he.settings.secrets.clearConfirm} onConfirm={clear} />
        )}
      </div>
      {message && (
        <span className={message.tone === 'red' ? 'field-error' : 'save-status'} data-tone={message.tone} role={message.tone === 'red' ? 'alert' : 'status'}>
          {message.text}
        </span>
      )}
    </Field>
  );
}
