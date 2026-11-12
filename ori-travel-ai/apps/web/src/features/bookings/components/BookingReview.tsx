import { Eye, FileSearch } from 'lucide-react';
import { useContext, useEffect, useRef, useState } from 'react';
import { Callout, Card, CardHeader, DateText, MoneyText } from '@/components/ui';
import { canBook } from '@/features/auth';
import { AuthContext } from '@/features/auth/context';
import { OfferCard, OfferDetailDialog } from '@/features/offers';
import { CanonicalOfferSchema, type CanonicalOffer } from '@/lib/schemas/offers';
import type { Booking } from '@/lib/schemas/bookings';
import { isAwaitingSupplier } from '../labels';
import { ActionsSection } from './ActionsSection';
import { ApprovalPanel } from './ApprovalPanel';
import { BookingStepper } from './BookingStepper';
import { ExecutionBanner } from './ExecutionBanner';
import { HistoryTimeline } from './HistoryTimeline';
import { HostedCheckoutPanel } from './HostedCheckoutPanel';
import { CancelledPanel, ConfirmedPanel, ExpiredPanel, FailedPanel, UnknownPanel } from './OutcomePanels';
import { PriceSection } from './PriceSection';
import { SubmitPanel } from './SubmitPanel';
import { TravelersSection } from './TravelersSection';
import { PlainTextLine } from './PlainTextLine';
import { useFeedback } from './useFeedback';

export function parseSnapshot(offer: Booking['offer']): CanonicalOffer | null {
  const parsed = CanonicalOfferSchema.safeParse(offer);
  return parsed.success ? parsed.data : null;
}

function readOnlyReason(user: Parameters<typeof canBook>[0]): string | null {
  if (canBook(user)) return null;
  if (user && user.role === 'viewer') {
    return 'הרשאת צופה: אפשר לעקוב אחרי ההזמנה, אך רק בעלים או מבוגר/ת שהוצהר/ה כבגיר/ה יכולים להכין, לאשר ולשלוח הזמנות.';
  }
  return 'כדי להכין ולאשר הזמנות נדרשת הצהרת בגירות מבעלי החשבון. עד אז ההזמנה מוצגת לקריאה בלבד.';
}

/** The booking review screen body. Every control is driven by the server-computed `booking.can`. */
export function BookingReview({ booking }: { booking: Booking }) {
  const user = useContext(AuthContext)?.user ?? null;
  const feedback = useFeedback();
  const [details, setDetails] = useState<CanonicalOffer | null>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const snapshot = parseSnapshot(booking.offer);
  const readOnly = readOnlyReason(user);
  const { can, state } = booking;
  // Hosted checkout, approved, no supplier reference yet: shown as "waiting", never as confirmed.
  const awaitingSupplier = isAwaitingSupplier(booking);

  useEffect(() => {
    if (feedback.problem) alertRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [feedback.problem]);

  return (
    <div className="flex flex-col gap-6" data-testid="booking-review">
      <ExecutionBanner mode={booking.execution_mode} demo={booking.is_demo} />
      <BookingStepper state={state} history={booking.history} mode={booking.execution_mode} />

      <div ref={alertRef} className="flex flex-col gap-3" aria-live="polite">
        {feedback.problem && (
          <Callout tone={feedback.problem.tone} title={feedback.problem.title} role="alert" data-testid="booking-problem">
            <p>{feedback.problem.message}</p>
            {feedback.problem.priceDiff && (
              <p className="mt-1 font-semibold">
                <MoneyText value={feedback.problem.priceDiff.oldPrice} /> ← <MoneyText value={feedback.problem.priceDiff.newPrice} />
              </p>
            )}
          </Callout>
        )}
        {feedback.notice && (
          <Callout tone="info" title="תוצאת הפעולה האחרונה" data-testid="booking-notice">
            <PlainTextLine text={feedback.notice} />
          </Callout>
        )}
      </div>

      {readOnly && (
        <Callout tone="info" icon={<Eye />} title="תצוגה לקריאה בלבד" data-testid="read-only-note">
          {readOnly}
        </Callout>
      )}

      {booking.warnings.length > 0 && (
        <Callout tone="warn" title="שימו לב" data-testid="booking-warnings">
          <ul className="list-disc ps-5">
            {booking.warnings.map((w, i) => (
              <li key={i}>
                <PlainTextLine text={w} />
              </li>
            ))}
          </ul>
        </Callout>
      )}

      {state === 'CONFIRMED' && <ConfirmedPanel booking={booking} />}
      {state === 'UNKNOWN' && <UnknownPanel booking={booking} feedback={feedback} />}
      {state === 'FAILED' && <FailedPanel booking={booking} />}
      {state === 'EXPIRED' && <ExpiredPanel booking={booking} />}
      {state === 'CANCELLED' && <CancelledPanel />}

      {can.approve && <ApprovalPanel key={booking.terms_hash} booking={booking} feedback={feedback} />}
      {can.submit && <SubmitPanel booking={booking} feedback={feedback} />}
      {(awaitingSupplier || can.open_checkout || can.record_confirmation) && <HostedCheckoutPanel booking={booking} feedback={feedback} />}
      {state === 'APPROVED' && !can.submit && !awaitingSupplier && booking.approval && (
        <Callout tone="success" title="התנאים אושרו" data-testid="approved-note">
          אושר על ידי {booking.approval.approved_by ?? '—'} בסך <MoneyText value={booking.approval.amount} />
          {booking.approval.valid ? (
            <>
              {' '}
              · תקף עד <DateText value={booking.approval.expires_at} preset="datetime" />
            </>
          ) : (
            ' · האישור אינו תקף יותר'
          )}
        </Callout>
      )}

      <ActionsSection booking={booking} feedback={feedback} />

      <div className="grid gap-6 lg:grid-cols-2">
        <PriceSection booking={booking} />
        <TravelersSection booking={booking} feedback={feedback} />
      </div>

      <Card as="section" padding="md">
        <CardHeader title="ההצעה שנבחרה" icon={<FileSearch />} description="צילום של ההצעה כפי שנבדקה מול הספק בפעם האחרונה." />
        {snapshot ? (
          <OfferCard
            offer={snapshot}
            rank={null}
            showCompare={false}
            showSave={false}
            showAddToTrip={false}
            onOpenDetails={setDetails}
          />
        ) : (
          <p className="text-sm text-fg-muted">{booking.title} — תצוגת ההצעה המלאה אינה זמינה. התנאים המחייבים מופיעים בסיכום האישור.</p>
        )}
        {!can.approve && booking.terms_summary.length > 0 && (
          <details className="mt-4 rounded-lg border border-line bg-surface-sunken p-4 text-sm">
            <summary className="cursor-pointer font-semibold text-fg">סיכום התנאים</summary>
            <ul className="mt-2 flex flex-col gap-1.5 leading-relaxed">
              {booking.terms_summary.map((l, i) => (
                <li key={i}>{l}</li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      <OfferDetailDialog offer={details} onOpenChange={(o) => !o && setDetails(null)} />

      <HistoryTimeline history={booking.history} />
    </div>
  );
}
