import { Ban, CircleCheck, CircleHelp, Clock, TriangleAlert, XCircle } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Button, Callout, Card, CardHeader, DateText, MoneyText } from '@/components/ui';
import { CATEGORY_SEARCH_PATH } from '@/lib/labels';
import type { Booking } from '@/lib/schemas/bookings';
import { MODE_LABELS, RESERVATION_STATUS_LABELS, UNVERIFIED_REFERENCE_LABEL, isReferenceUnverified } from '../labels';
import { useBookingActions } from '../hooks';
import { PlainTextLine } from './PlainTextLine';
import type { Feedback } from './useFeedback';

export function ConfirmedPanel({ booking }: { booking: Booking }) {
  const ref = booking.reservation?.supplier_reference ?? booking.supplier_reference;
  const sim = booking.is_simulation || booking.reservation?.mode === 'SIMULATION';
  const hosted = !sim && (booking.execution_mode === 'HOSTED_CHECKOUT' || booking.reservation?.mode === 'HOSTED_CHECKOUT');
  const demoHosted = hosted && booking.is_demo;
  // RA-02: hand-typed reference for a real supplier — recorded, not supplier-confirmed. Amber, never green.
  const unverified = !sim && !demoHosted && (hosted || isReferenceUnverified(booking));
  const title = sim
    ? 'ההזמנה אושרה — בסימולציה'
    : demoHosted
      ? 'נרשמה אסמכתה של ספק לדוגמה (DEMO)'
      : unverified
        ? UNVERIFIED_REFERENCE_LABEL
        : 'ההזמנה אושרה על ידי הספק';
  const tint = unverified ? 'text-amber-700' : 'text-moss-700';
  return (
    <Card
      as="section"
      padding="md"
      className={unverified ? 'border-2 border-amber-500 bg-amber-50' : 'border-2 border-moss-600 bg-moss-50'}
      data-testid="confirmed-panel"
      data-verified={unverified ? 'false' : 'true'}
    >
      <CardHeader
        title={title}
        icon={unverified ? <TriangleAlert /> : <CircleCheck />}
        actions={
          sim ? (
            <Badge tone="demo">אסמכתה מדומה</Badge>
          ) : demoHosted ? (
            <Badge tone="demo">אסמכתת הדגמה — אין חיוב</Badge>
          ) : unverified ? (
            <Badge tone="warn" data-testid="unverified-badge">
              <TriangleAlert aria-hidden="true" /> לא אומת מול הספק
            </Badge>
          ) : undefined
        }
      />
      <p className={`text-xs ${tint}`}>{unverified ? 'אסמכתה כפי שהוזנה (לא אומתה)' : 'אסמכתת ספק'}</p>
      <p className={`mb-3 break-all text-3xl font-extrabold tracking-wide ${tint}`} dir="ltr" data-testid="supplier-reference">
        {ref ?? '—'}
      </p>
      {sim && (
        <p className="mb-3 text-sm font-medium text-moss-700">
          זו סימולציה: האסמכתה שייכת לספק מדומה, לא בוצעה הזמנה אמיתית ולא בוצע חיוב.
        </p>
      )}
      {demoHosted && (
        <p className="mb-3 text-sm font-medium text-moss-700" data-testid="demo-reference-note">
          זו הדגמה: האסמכתה הונפקה בדף ספק לדוגמה ואומתה מולו. לא בוצעה הזמנה אמיתית ולא בוצע חיוב.
        </p>
      )}
      {unverified && (
        <p className="mb-3 text-sm font-medium text-amber-700" data-testid="manual-reference-note">
          האסמכתה הוזנה ידנית אחרי השלמת ההזמנה באתר הספק. המערכת לא אימתה אותה מול הספק ואינה יודעת אם הספק אישר את ההזמנה — יש לוודא זאת
          ישירות מול הספק.
        </p>
      )}
      {booking.reservation && (
        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-xs text-fg-subtle">סכום</dt>
            <dd className="font-semibold">
              <MoneyText value={booking.reservation.amount} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">אושר ב</dt>
            <dd>
              <DateText value={booking.reservation.confirmed_at} preset="datetime" />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">סוג</dt>
            <dd>{MODE_LABELS[booking.execution_mode] ?? booking.reservation.mode}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">סטטוס</dt>
            <dd data-testid="reservation-status">{RESERVATION_STATUS_LABELS[booking.reservation.status] ?? booking.state_label}</dd>
          </div>
          {booking.reservation.notes && (
            <div className="sm:col-span-2 lg:col-span-4">
              <dt className="text-xs text-fg-subtle">הערות</dt>
              <dd>
                <PlainTextLine text={booking.reservation.notes} />
              </dd>
            </div>
          )}
        </dl>
      )}
    </Card>
  );
}

/** UNKNOWN: we do not know whether the supplier received the request. The only allowed action is reconcile. */
export function UnknownPanel({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const { reconcile } = useBookingActions(booking.id);
  return (
    <Card as="section" padding="md" className="border-2 border-coral-600 bg-coral-50" data-testid="unknown-panel">
      <CardHeader title="לא ידוע אם ההזמנה נקלטה אצל הספק" icon={<CircleHelp />} />
      <p className="mb-2 text-sm leading-relaxed text-coral-700">
        הבקשה נשלחה, אך לא התקבלה תשובה ברורה. ייתכן שההזמנה נקלטה וייתכן שלא. <strong>אין לשלוח שוב</strong> ואין לנסות להזמין מחדש — זה עלול ליצור
        הזמנה כפולה.
      </p>
      <p className="mb-4 text-sm leading-relaxed text-coral-700">הפעולה היחידה האפשרית היא בירור מול הספק, והמערכת תעדכן את המצב לפי מה שנמצא שם.</p>
      {booking.can.reconcile && (
        <Button variant="danger" loading={reconcile.isPending} onClick={() => void feedback.run(reconcile.mutateAsync())}>
          בירור מול הספק
        </Button>
      )}
    </Card>
  );
}

export function FailedPanel({ booking }: { booking: Booking }) {
  return (
    <Callout tone="danger" icon={<XCircle />} title="ההזמנה נכשלה" data-testid="failed-panel">
      <PlainTextLine text={booking.failure_reason ?? 'הספק לא אישר את ההזמנה.'} />
      <p className="mt-1">לא בוצעה הזמנה. אפשר לחפש מחדש ולהכין הזמנה חדשה.</p>
    </Callout>
  );
}

export function ExpiredPanel({ booking }: { booking: Booking }) {
  return (
    <Callout
      tone="neutral"
      icon={<Clock />}
      title="תוקף ההצעה פג"
      data-testid="expired-panel"
      action={
        <Link to={CATEGORY_SEARCH_PATH[booking.category]} className="text-sm font-medium text-accent underline-offset-4 hover:underline">
          חיפוש חדש
        </Link>
      }
    >
      ההצעה כבר אינה תקפה אצל הספק. כדי להמשיך יש לבצע חיפוש חדש ולהכין הזמנה חדשה.
    </Callout>
  );
}

export function CancelledPanel() {
  return (
    <Callout tone="neutral" icon={<Ban />} title="הכנת ההזמנה בוטלה" data-testid="cancelled-panel">
      לא נשלח דבר לספק.
    </Callout>
  );
}
