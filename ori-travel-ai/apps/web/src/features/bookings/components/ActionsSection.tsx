import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Store, XCircle } from 'lucide-react';
import { useState } from 'react';
import { Button, Callout, Card, CardHeader, ConfirmDialog, Dialog, Field, Input, Textarea } from '@/components/ui';
import type { Booking, CheckoutLink } from '@/lib/schemas/bookings';
import { bookingKeys, fetchCheckoutLink } from '../api';
import { SUPPLIER_REFERENCE_PATTERN } from '../labels';
import { useBookingActions } from '../hooks';
import { PlainTextLine } from './PlainTextLine';
import { safeExternalUrl } from '@/lib/safeUrl';
import type { Feedback } from './useFeedback';

/** Only https URLs are ever opened (the server additionally enforces the provider's domain allowlist). */
export function safeCheckoutUrl(raw: string): string | null {
  return safeExternalUrl(raw);
}

function RecordConfirmationForm({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { record } = useBookingActions(booking.id);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = SUPPLIER_REFERENCE_PATTERN.test(reference);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || record.isPending) return;
    await feedback.run(record.mutateAsync({ supplier_reference: reference, ...(notes.trim() ? { notes: notes.trim() } : {}) }));
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" data-testid="record-confirmation-form">
      <p className="text-sm text-fg-muted">הזמנתם באתר הספק? הזינו כאן את מספר האישור (אסמכתה) שקיבלתם, כדי שההזמנה תסומן כמאושרת.</p>
      <Field
        label="אסמכתת ספק"
        hint="אותיות באנגלית, ספרות ומקף בלבד (4–64 תווים)"
        error={touched && !valid ? 'האסמכתה חייבת להכיל 4–64 תווים: אותיות באנגלית, ספרות ומקף' : undefined}
      >
        <Input value={reference} onChange={(e) => setReference(e.target.value.trim())} dir="ltr" className="text-start" maxLength={64} autoComplete="off" />
      </Field>
      <Field label="הערות" optional>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} rows={2} />
      </Field>
      <div>
        <Button type="submit" loading={record.isPending} disabled={!valid}>
          רישום האסמכתה
        </Button>
      </div>
    </form>
  );
}

function CheckoutButton({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const qc = useQueryClient();
  const [link, setLink] = useState<CheckoutLink | null>(null);
  const mutation = useMutation({
    mutationFn: () => fetchCheckoutLink(booking.id),
    onError: () => {
      void qc.invalidateQueries({ queryKey: bookingKeys.detail(booking.id) });
    },
  });
  const url = link ? safeCheckoutUrl(link.url) : null;

  async function open() {
    feedback.clear();
    try {
      setLink(await mutation.mutateAsync());
    } catch (e) {
      feedback.fail(e);
    }
  }

  return (
    <>
      <Button variant="accent" loading={mutation.isPending} onClick={() => void open()} leadingIcon={<Store aria-hidden="true" />}>
        מעבר לאתר הספק
      </Button>
      {link && (
        <Dialog
          open
          onOpenChange={(o) => !o && setLink(null)}
          title={`מעבר לאתר ${link.provider_name}`}
          description="המערכת אינה מבצעת תשלום. ההזמנה והתשלום מתבצעים באתר הספק בלבד."
          footer={
            <>
              <Button variant="secondary" onClick={() => setLink(null)}>
                סגירה
              </Button>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sea-600 px-4 text-sm font-medium text-white hover:bg-sea-700"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  פתיחת אתר הספק בלשונית חדשה
                </a>
              ) : null}
            </>
          }
        >
          {!url && (
            <Callout tone="danger" role="alert" className="mb-3">
              הקישור שהתקבל אינו מאובטח ולכן לא ייפתח.
            </Callout>
          )}
          {link.instructions && (
            <p className="mb-3 text-sm leading-relaxed">
              <PlainTextLine text={link.instructions} />
            </p>
          )}
          <ul className="list-disc space-y-1 ps-5 text-sm text-amber-700">
            {link.warnings.map((w, i) => (
              <li key={i}>
                <PlainTextLine text={w} />
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}

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

/** Every control is rendered strictly from the server's `can` flags. */
export function ActionsSection({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { revalidate } = useBookingActions(booking.id);
  const { can } = booking;
  const hasButtons = can.revalidate || can.cancel || can.open_checkout;
  if (!hasButtons && !can.record_confirmation) return null;
  return (
    <Card as="section" padding="md">
      <CardHeader title="פעולות" />
      <div className="flex flex-col gap-5">
        {hasButtons && (
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
            {can.open_checkout && <CheckoutButton booking={booking} feedback={feedback} />}
            {can.cancel && <CancelButton booking={booking} feedback={feedback} />}
          </div>
        )}
        {can.record_confirmation && <RecordConfirmationForm booking={booking} feedback={feedback} />}
      </div>
    </Card>
  );
}
