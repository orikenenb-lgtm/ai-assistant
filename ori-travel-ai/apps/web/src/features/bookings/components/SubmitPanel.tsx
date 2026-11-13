import { Send } from 'lucide-react';
import { useRef } from 'react';
import { Button, Card, CardHeader, DateText, MoneyText } from '@/components/ui';
import type { Booking } from '@/lib/schemas/bookings';
import { useBookingActions } from '../hooks';
import { getSubmitKey } from '../idempotency';
import { Countdown } from './Countdown';
import type { Feedback } from './useFeedback';

/**
 * Submit (SIMULATION only). The idempotency key is generated ONCE per approval and re-sent on every
 * retry / double click, so the server can never process the same approval twice.
 */
export function SubmitPanel({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { submit } = useBookingActions(booking.id);
  const inFlight = useRef(false);
  const approval = booking.approval;

  async function onSubmit() {
    if (inFlight.current || submit.isPending || !approval) return;
    inFlight.current = true;
    try {
      const key = getSubmitKey(booking.id, approval.id);
      await feedback.run(submit.mutateAsync(key));
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Card as="section" padding="md" className="border-2 border-ink-900" data-testid="submit-panel">
      <CardHeader title="שליחה לספק המדומה" icon={<Send />} description="התנאים אושרו. השליחה האחרונה היא סימולציה: לא תתבצע הזמנה אמיתית ולא יבוצע חיוב." />
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-fg-subtle">סכום מאושר</dt>
          <dd className="text-lg font-bold">
            <MoneyText value={approval?.amount ?? booking.current_price} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">אושר על ידי</dt>
          <dd>{approval?.approved_by ?? '—'}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">תוקף האישור</dt>
          <dd>
            <Countdown until={approval?.expires_at} />
            {approval && (
              <span className="block text-xs text-fg-subtle">
                עד <DateText value={approval.expires_at} preset="datetime" />
              </span>
            )}
          </dd>
        </div>
      </dl>
      <p className="mb-4 text-sm text-fg-muted">
        לפני השליחה המערכת בודקת שוב את המחיר מול הספק. אם משהו השתנה — ההזמנה לא תישלח והאישור יבוטל. לחיצה חוזרת או ניסיון חוזר אחרי תקלה
        משתמשים באותו מפתח שליחה, ולכן אי אפשר לשלוח פעמיים.
      </p>
      <Button size="lg" onClick={() => void onSubmit()} loading={submit.isPending} disabled={!approval} leadingIcon={<Send aria-hidden="true" />}>
        שליחה (סימולציה)
      </Button>
    </Card>
  );
}
