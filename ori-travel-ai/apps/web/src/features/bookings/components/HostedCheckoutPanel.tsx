import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, FlaskConical, Hourglass, Store } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Callout, Card, CardHeader, DateText, Dialog, Field, Input, MoneyText, Textarea } from '@/components/ui';
import type { Booking, CheckoutLink } from '@/lib/schemas/bookings';
import { bookingKeys, fetchCheckoutLink } from '../api';
import { checkoutTarget } from '../checkoutUrl';
import { useBookingActions } from '../hooks';
import { AWAITING_SUPPLIER_LABEL, SUPPLIER_REFERENCE_PATTERN } from '../labels';
import { PlainTextLine } from './PlainTextLine';
import type { Feedback } from './useFeedback';

export function RecordConfirmationForm({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { record } = useBookingActions(booking.id);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [touched, setTouched] = useState(false);
  const valid = SUPPLIER_REFERENCE_PATTERN.test(reference);
  const demo = booking.is_demo;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid || record.isPending) return;
    await feedback.run(record.mutateAsync({ supplier_reference: reference, ...(notes.trim() ? { notes: notes.trim() } : {}) }));
  }

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" data-testid="record-confirmation-form">
      <p className="text-sm text-fg-muted">
        {demo
          ? 'השלמתם את התהליך בדף הספק לדוגמה? העתיקו משם את האסמכתה והזינו אותה כאן. האסמכתה נבדקת מול ספק ההדגמה — אסמכתה שגויה לא תתקבל.'
          : 'הזמנתם באתר הספק? הזינו כאן את מספר האישור (אסמכתה) שקיבלתם. המערכת אינה יכולה לאמת את האסמכתה מול הספק — היא נרשמת כפי שהוזנה.'}
      </p>
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

export function CheckoutButton({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const qc = useQueryClient();
  const [link, setLink] = useState<CheckoutLink | null>(null);
  const mutation = useMutation({
    mutationFn: () => fetchCheckoutLink(booking.id),
    onError: () => {
      void qc.invalidateQueries({ queryKey: bookingKeys.detail(booking.id) });
    },
  });
  const target = link ? checkoutTarget(link) : null;
  const demo = booking.is_demo;

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
        {demo ? 'מעבר לדף הספק לדוגמה (DEMO)' : 'מעבר לאתר הספק'}
      </Button>
      {link && (
        <Dialog
          open
          onOpenChange={(o) => !o && setLink(null)}
          title={link.is_demo ? `מעבר לדף ספק לדוגמה — ${link.provider_name}` : `מעבר לאתר ${link.provider_name}`}
          description={
            link.is_demo
              ? 'דף ספק לדוגמה (DEMO) בתוך המערכת. אין תשלום, אין חיוב ואין הזמנה אמיתית.'
              : 'המערכת אינה מבצעת תשלום. ההזמנה והתשלום מתבצעים באתר הספק בלבד.'
          }
          footer={
            <>
              <Button variant="secondary" onClick={() => setLink(null)}>
                סגירה
              </Button>
              {target ? (
                <a
                  href={target.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="checkout-open-link"
                  data-internal={target.internal ? 'true' : 'false'}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-sea-600 px-4 text-sm font-medium text-white hover:bg-sea-700"
                >
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {target.internal ? 'פתיחת דף הספק לדוגמה בלשונית חדשה' : 'פתיחת אתר הספק בלשונית חדשה'}
                </a>
              ) : null}
            </>
          }
        >
          {!target && (
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

/**
 * HOSTED_CHECKOUT + APPROVED: the terms are approved, but NOTHING is booked as far as we know.
 * The panel says "waiting for completion on the supplier's site" and never "confirmed" —
 * the booking becomes CONFIRMED only when the server accepts the supplier reference.
 */
export function HostedCheckoutPanel({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { can, approval } = booking;
  const demo = booking.is_demo;
  return (
    <Card as="section" padding="md" className="border-2 border-amber-500 bg-amber-50" data-testid="awaiting-supplier-panel" data-demo={demo ? 'true' : 'false'}>
      <CardHeader
        title={AWAITING_SUPPLIER_LABEL}
        icon={<Hourglass />}
        description="התנאים אושרו, אבל ההזמנה עדיין לא בוצעה ואינה מאושרת. היא תסומן כמאושרת רק אחרי שתירשם כאן אסמכתת הספק."
        actions={
          demo ? (
            <Badge tone="demo">
              <FlaskConical aria-hidden="true" /> ספק לדוגמה — DEMO, אין חיוב
            </Badge>
          ) : undefined
        }
      />
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-fg-subtle">ספק</dt>
          <dd className="font-semibold" data-testid="awaiting-supplier-name">
            {booking.provider_name}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">סכום שאושר</dt>
          <dd className="font-semibold">
            <MoneyText value={approval?.amount ?? booking.current_price} />
          </dd>
        </div>
        {approval && (
          <div>
            <dt className="text-xs text-fg-subtle">אישור התנאים</dt>
            <dd>
              {approval.approved_by ?? '—'}
              {approval.valid ? (
                <span className="block text-xs text-fg-subtle">
                  תקף עד <DateText value={approval.expires_at} preset="datetime" />
                </span>
              ) : (
                <span className="block text-xs font-medium text-coral-700">האישור אינו תקף יותר — יש לבדוק מחיר ולאשר מחדש</span>
              )}
            </dd>
          </div>
        )}
      </dl>
      <ol className="mb-4 list-decimal space-y-1 ps-5 text-sm leading-relaxed">
        <li>{demo ? 'פותחים את דף הספק לדוגמה (בתוך המערכת, בלשונית חדשה).' : 'עוברים לאתר הספק בלשונית חדשה.'}</li>
        <li>{demo ? 'מדמים שם את השלמת ההזמנה ומעתיקים את האסמכתה לדוגמה שמוצגת.' : 'משלימים שם את ההזמנה והתשלום, ושומרים את מספר האישור.'}</li>
        <li>חוזרים לכאן ורושמים את האסמכתה. רק אז ההזמנה תסומן כמאושרת.</li>
      </ol>
      <div className="flex flex-col gap-5">
        {can.open_checkout && (
          <div>
            <CheckoutButton booking={booking} feedback={feedback} />
          </div>
        )}
        {can.record_confirmation && <RecordConfirmationForm booking={booking} feedback={feedback} />}
      </div>
    </Card>
  );
}
