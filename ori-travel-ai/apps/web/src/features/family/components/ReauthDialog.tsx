import { useState, type FormEvent } from 'react';
import { Button, Callout, Dialog, Field, Input } from '@/components/ui';
import { errorMessage } from '@/lib/api';

export interface ReauthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves when the password was accepted (the caller then retries the sensitive action). */
  onConfirm: (password: string) => Promise<void>;
  description?: string;
  confirmLabel?: string;
}

/** Step-up authentication: the server requires a recent password confirmation (10 minutes) for sensitive reads. */
export function ReauthDialog({ open, onOpenChange, onConfirm, description = 'לצפייה במספר הדרכון נדרש אימות מחדש. האימות תקף ל-10 דקות.', confirmLabel = 'אימות והצגה' }: ReauthDialogProps) {
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    if (!password) {
      setError('יש להזין סיסמה');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await onConfirm(password);
      setPassword('');
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setPassword('');
          setError(null);
        }
        onOpenChange(o);
      }}
      size="sm"
      title="אימות סיסמה"
      description={description}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="הסיסמה שלך" required>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} dir="ltr" className="text-start" autoFocus />
        </Field>
        {error && (
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        )}
        <div className="flex flex-wrap-reverse justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            ביטול
          </Button>
          <Button type="submit" loading={pending}>
            {confirmLabel}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
