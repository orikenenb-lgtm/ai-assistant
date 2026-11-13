import { RefreshCw, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Card, CardHeader, ConfirmDialog, Field, Textarea } from '@/components/ui';
import type { Booking } from '@/lib/schemas/bookings';
import { useBookingActions } from '../hooks';
import type { Feedback } from './useFeedback';

function CancelButton({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { cancel } = useBookingActions(booking.id);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <>
      <Button variant="secondary" leadingIcon={<XCircle aria-hidden="true" />} onClick={() => setOpen(true)}>
        ביטול ההזמנה
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        tone="danger"
        title="לבטל את הכנת ההזמנה?"
        description="לא נשלח דבר לספק, ולכן אין חיוב. הפעולה אינה הפיכה — כדי להזמין שוב תצטרכו להכין הזמנה חדשה."
        confirmLabel="ביטול ההזמנה"
        cancelLabel="חזרה"
        loading={cancel.isPending}
        onConfirm={async () => {
          feedback.clear();
          try {
            const b = await cancel.mutateAsync(reason.trim() || undefined);
            feedback.report(b);
          } catch (e) {
            feedback.fail(e);
            throw e;
          }
        }}
      >
        <Field label="סיבה" optional>
          <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </>
  );
}

/**
 * Every control is rendered strictly from the server's `can` flags.
 * The hosted-checkout controls (open supplier page, record reference) live in `HostedCheckoutPanel`.
 */
export function ActionsSection({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { revalidate } = useBookingActions(booking.id);
  const { can } = booking;
  if (!can.revalidate && !can.cancel) return null;
  return (
    <Card as="section" padding="md">
      <CardHeader title="פעולות" />
      <div className="flex flex-wrap gap-2">
        {can.revalidate && (
          <Button
            variant="secondary"
            loading={revalidate.isPending}
            leadingIcon={<RefreshCw aria-hidden="true" />}
            onClick={() => void feedback.run(revalidate.mutateAsync())}
          >
            בדיקת מחיר מול הספק
          </Button>
        )}
        {can.cancel && <CancelButton booking={booking} feedback={feedback} />}
      </div>
    </Card>
  );
}
