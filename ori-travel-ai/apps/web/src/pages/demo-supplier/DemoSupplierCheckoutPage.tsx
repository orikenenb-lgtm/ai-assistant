/**
 * In-app DEMO supplier page — a stand-in for "the supplier's own site" in the provider-redirect flow.
 *
 * It is deliberately rendered OUTSIDE the app shell so it reads as a different site, and it is
 * labelled DEMO everywhere. There is no payment form and no card field: the only action is
 * "simulate completing at the supplier", which makes the DEMO supplier issue a reference.
 * Completing here does NOT confirm the booking — the user has to go back and record the reference.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, Copy, FlaskConical, Store } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Button, Callout, Card, CardHeader, MoneyText, Spinner } from '@/components/ui';
import { completeDemoCheckout, demoCheckoutKeys, describeBookingError, fetchDemoCheckout } from '@/features/bookings';
import { isApiError } from '@/lib/api';
import { DEMO_CHECKOUT_REF_PATTERN, type DemoCheckout } from '@/lib/schemas/bookings';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

export const DEMO_BANNER_TEXT = 'דף ספק לדוגמה — DEMO, אין חיוב';

function DemoBanner() {
  return (
    <div
      role="note"
      data-testid="demo-supplier-banner"
      className="flex items-center justify-center gap-3 border-b-4 border-dashed border-sand-500 bg-sand-100 px-4 py-4 text-center text-sand-900"
    >
      <FlaskConical className="size-7 shrink-0" aria-hidden="true" />
      <p className="text-2xl font-extrabold">{DEMO_BANNER_TEXT}</p>
    </div>
  );
}

function BackToBooking({ bookingId }: { bookingId?: string }) {
  return (
    <Link
      to={bookingId ? `/bookings/${encodeURIComponent(bookingId)}` : '/bookings'}
      className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline"
      data-testid="back-to-booking"
    >
      <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
      {bookingId ? 'חזרה להזמנה במערכת' : 'חזרה לרשימת ההזמנות'}
    </Link>
  );
}

function ReferenceBox({ reference }: { reference: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(reference);
      setCopied(true);
    } catch {
      setCopied(false); // clipboard unavailable: the reference stays selectable on screen
    }
  }
  return (
    <div className="rounded-xl border-2 border-dashed border-sand-500 bg-sand-100 p-4" data-testid="demo-reference-box">
      <p className="text-xs font-medium text-sand-900">אסמכתת ספק לדוגמה (DEMO) — להעתקה</p>
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <p className="select-all break-all text-3xl font-extrabold tracking-wide text-sand-900" dir="ltr" data-testid="demo-supplier-reference">
          {reference}
        </p>
        <Button variant="secondary" onClick={() => void copy()} leadingIcon={copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}>
          {copied ? 'הועתק' : 'העתקת האסמכתה'}
        </Button>
      </div>
      <p className="mt-2 text-sm text-sand-900">האסמכתה אינה תקפה אצל שום ספק אמיתי. לא בוצעה הזמנה אמיתית ולא בוצע חיוב.</p>
    </div>
  );
}

function Checkout({ data }: { data: DemoCheckout }) {
  const qc = useQueryClient();
  const [problem, setProblem] = useState<ReturnType<typeof describeBookingError> | null>(null);
  const complete = useMutation({
    mutationFn: () => completeDemoCheckout(data.ref),
    onSuccess: (next) => {
      setProblem(null);
      qc.setQueryData(demoCheckoutKeys.detail(data.ref), next);
    },
    onError: (e) => {
      setProblem(describeBookingError(e));
      void qc.invalidateQueries({ queryKey: demoCheckoutKeys.detail(data.ref) });
    },
  });
  const completed = data.status === 'COMPLETED' && !!data.supplier_reference;

  return (
    <Card as="section" padding="md" data-testid="demo-supplier-checkout" data-status={data.status}>
      <CardHeader title={data.provider_name} icon={<Store />} description="ספק בדיוני לצורכי הדגמה. הדף הזה נמצא בתוך Ori Travel AI ואינו אתר חיצוני." />
      {problem && (
        <Callout tone={problem.tone} title={problem.title} role="alert" className="mb-4" data-testid="demo-supplier-problem">
          {problem.message}
        </Callout>
      )}
      <dl className="mb-4 grid gap-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-fg-subtle">ספק</dt>
          <dd className="font-semibold" data-testid="demo-supplier-name">
            {data.provider_name}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">מחיר (לא ייגבה)</dt>
          <dd className="text-lg font-bold" data-testid="demo-supplier-price">
            <MoneyText value={data.price} />
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs text-fg-subtle">מה מזמינים</dt>
          <dd className="font-semibold" data-testid="demo-supplier-title">
            {data.title}
          </dd>
        </div>
      </dl>
      {data.summary.length > 0 && (
        <ul className="mb-4 flex flex-col gap-1.5 rounded-lg border border-line bg-surface-sunken p-4 text-sm leading-relaxed" data-testid="demo-supplier-summary">
          {data.summary.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      )}

      {data.status === 'EXPIRED' && (
        <Callout tone="warn" title="פג תוקף — לא בתוקף" role="alert" data-testid="demo-supplier-expired">
          {data.message}
        </Callout>
      )}

      {data.status === 'OPEN' && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-fg-muted">{data.message}</p>
          {data.can_complete ? (
            <div>
              <Button size="lg" variant="accent" loading={complete.isPending} onClick={() => complete.mutate()} data-testid="demo-supplier-complete">
                סימולציה: השלמת ההזמנה אצל הספק (ללא תשלום)
              </Button>
            </div>
          ) : (
            <Callout tone="info" title="תצוגה לקריאה בלבד">
              רק בעלים או מבוגר/ת שהוצהר/ה כבגיר/ה יכולים להשלים את התהליך.
            </Callout>
          )}
        </div>
      )}

      {completed && data.supplier_reference && (
        <div className="flex flex-col gap-4">
          <ReferenceBox reference={data.supplier_reference} />
          {data.recorded ? (
            <Callout tone="success" title="האסמכתה כבר נרשמה בהזמנה" data-testid="demo-supplier-recorded">
              {data.message}
            </Callout>
          ) : (
            <Callout tone="warn" title="נותר שלב אחד: לרשום את האסמכתה בהזמנה" data-testid="demo-supplier-next-step">
              {data.message}
            </Callout>
          )}
        </div>
      )}
    </Card>
  );
}

export default function DemoSupplierCheckoutPage() {
  useDocumentTitle(DEMO_BANNER_TEXT);
  const [params] = useSearchParams();
  const raw = params.get('ref') ?? '';
  // Exactly one parameter in exactly the allowlisted shape; anything else is not a supplier page.
  const ref = DEMO_CHECKOUT_REF_PATTERN.test(raw) && [...params.keys()].length === 1 ? raw : null;
  const query = useQuery({
    queryKey: demoCheckoutKeys.detail(ref ?? ''),
    queryFn: () => fetchDemoCheckout(ref as string),
    enabled: !!ref,
    retry: false,
  });
  const notFound = !ref || (query.isError && isApiError(query.error) && (query.error.status === 404 || query.error.status === 422));

  return (
    <div className="min-h-dvh bg-canvas" data-testid="demo-supplier-page">
      <DemoBanner />
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
        <BackToBooking bookingId={query.data?.booking_id} />
        {notFound ? (
          <Callout tone="danger" title="דף הספק לדוגמה לא נמצא" role="alert" data-testid="demo-supplier-not-found">
            הקישור אינו תקין או שאינו קיים. יש לפתוח את דף הספק מחדש מתוך ההזמנה.
          </Callout>
        ) : query.isPending ? (
          <Spinner label="טוען את דף הספק לדוגמה…" />
        ) : query.isError ? (
          <Callout tone="danger" title="לא ניתן לטעון את דף הספק לדוגמה" role="alert">
            נסו לרענן את הדף, או חזרו להזמנה ופתחו את דף הספק מחדש.
          </Callout>
        ) : (
          <Checkout data={query.data} />
        )}
        <p className="text-center text-xs text-fg-subtle">{DEMO_BANNER_TEXT}. אין בדף הזה טופס תשלום ולא נאספים פרטי כרטיס.</p>
      </main>
    </div>
  );
}
