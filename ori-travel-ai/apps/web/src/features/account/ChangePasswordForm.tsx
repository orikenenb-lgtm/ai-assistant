import { KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Button, Callout, Field, Input, useToast } from '@/components/ui';
import { SettingsSection } from '@/features/settings/components/SettingsSection';
import { changePassword } from '@/features/settings/api';
import { checkPassword, passwordError } from '@/features/auth/passwordStrength';
import { isApiError } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';

const STRENGTH = ['', 'חלשה', 'סבירה', 'טובה', 'חזקה'] as const;

export function ChangePasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { toast } = useToast();
  const mutation = useMutation({ mutationFn: changePassword });
  const check = checkPassword(next);

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const found: Record<string, string> = {};
    if (!current) found.current = 'יש להזין את הסיסמה הנוכחית';
    const pe = passwordError(next);
    if (pe) found.next = pe;
    else if (next === current) found.next = 'הסיסמה החדשה זהה לנוכחית';
    if (confirm !== next) found.confirm = 'האימות אינו תואם לסיסמה החדשה';
    setErrors(found);
    if (Object.keys(found).length) return;
    mutation.mutate(
      { current_password: current, new_password: next },
      {
        onSuccess: () => {
          setCurrent('');
          setNext('');
          setConfirm('');
          toast({ title: 'הסיסמה שונתה', description: 'מכשירים אחרים שהיו מחוברים נותקו.', tone: 'success' });
        },
      },
    );
  }

  const err = mutation.error;
  const currentWrong = isApiError(err) && err.code === 'INVALID_CREDENTIALS';
  return (
    <SettingsSection id="account" title="החשבון שלי — שינוי סיסמה" description="בחרו סיסמה ארוכה וייחודית." icon={<KeyRound />}>
      <form onSubmit={submit} noValidate className="flex max-w-md flex-col gap-4">
        <Field label="סיסמה נוכחית" required error={errors.current ?? (currentWrong ? err.message : undefined)}>
          <Input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} dir="ltr" className="text-start" />
        </Field>
        <Field
          label="סיסמה חדשה"
          required
          error={errors.next}
          hint={
            <>
              לפחות 10 תווים ושני סוגי תווים (אותיות, ספרות, סימנים). {next && <strong data-testid="strength">חוזק: {STRENGTH[check.score] || 'חלשה'}</strong>}
            </>
          }
        >
          <Input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} dir="ltr" className="text-start" />
        </Field>
        <Field label="אימות סיסמה חדשה" required error={errors.confirm}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} dir="ltr" className="text-start" />
        </Field>
        <Callout tone="neutral">אחרי שינוי הסיסמה, כל המכשירים האחרים שמחוברים לחשבון שלך ינותקו. המכשיר הזה יישאר מחובר.</Callout>
        {mutation.isError && !currentWrong && (
          <Callout tone="danger" role="alert">
            {isApiError(err) ? err.message : 'לא ניתן לשנות את הסיסמה. נסו שוב.'}
          </Callout>
        )}
        <div>
          <Button type="submit" loading={mutation.isPending}>
            שינוי סיסמה
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}
