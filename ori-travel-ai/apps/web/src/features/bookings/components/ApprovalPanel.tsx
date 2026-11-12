import { ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardHeader, Checkbox, Field, Input, MoneyText } from '@/components/ui';
import type { Booking } from '@/lib/schemas/bookings';
import { useBookingActions } from '../hooks';
import type { Feedback } from './useFeedback';

/**
 * Explicit human approval. Everything shown here comes from the booking object the user is looking at,
 * and the `terms_hash` sent is that same booking's hash — never a value from a later fetch.
 * The parent keys this component by `terms_hash`, so changed terms reset the checkbox and password.
 */
export function ApprovalPanel({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { approve } = useBookingActions(booking.id);
  const [confirmed, setConfirmed] = useState(false);
  const [password, setPassword] = useState('');
  const displayedHash = booking.terms_hash;
  const ready = confirmed && password.length > 0;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || approve.isPending) return;
    const pw = password;
    setPassword('');
    await feedback.run(approve.mutateAsync({ terms_hash: displayedHash, password: pw }));
  }

  return (
    <Card as="section" padding="md" className="border-2 border-sea-500" data-testid="approval-panel">
      <CardHeader
        title="אישור התנאים"
        description="קראו את כל השורות לפני האישור. האישור קושר את התנאים המדויקים האלה בלבד — כל שינוי יבטל אותו."
        icon={<ShieldCheck />}
      />
      <ul className="flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken p-4 text-sm leading-relaxed text-fg" data-testid="terms-summary">
        {booking.terms_summary.map((line, i) => (
          <li key={i} className="border-b border-line pb-2 last:border-b-0 last:pb-0">
            {line}
          </li>
        ))}
      </ul>
      <div className="my-5 flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-ink-900 px-5 py-4 text-white">
        <span className="text-sm text-ink-200">סכום כולל לאישור</span>
        <span className="text-3xl font-extrabold" data-testid="approval-total">
          <MoneyText value={booking.current_price} />
        </span>
      </div>
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4">
        <Checkbox
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          label="קראתי ואני מאשר/ת את התנאים המדויקים"
          disabled={approve.isPending}
        />
        <Field label="סיסמה (אימות נוסף)" hint="הזינו שוב את הסיסמה שלכם כדי לאשר. הסיסמה אינה נשמרת.">
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={approve.isPending}
            dir="ltr"
            className="text-start"
          />
        </Field>
        <div>
          <Button type="submit" size="lg" loading={approve.isPending} disabled={!ready}>
            אישור התנאים
          </Button>
        </div>
      </form>
    </Card>
  );
}
