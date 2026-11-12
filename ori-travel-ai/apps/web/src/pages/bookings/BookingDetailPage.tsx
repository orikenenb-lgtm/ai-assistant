import { ArrowRight, ClipboardCheck } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { EmptyState, PageHeader } from '@/components/ui';
import { QueryState } from '@/components/QueryState';
import { BookingReview, BookingStateBadge, SimulationBadge, useBooking } from '@/features/bookings';

export default function BookingDetailPage() {
  const { bookingId } = useParams();
  const query = useBooking(bookingId);
  const booking = query.data;
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <Link to="/bookings" className="touch-target inline-flex w-fit items-center gap-1.5 text-sm font-medium text-accent underline-offset-4 hover:underline">
        <ArrowRight className="size-4 ltr:rotate-180" aria-hidden="true" />
        כל ההזמנות
      </Link>
      <PageHeader
        title="סקירת הזמנה"
        icon={<ClipboardCheck />}
        description={booking?.title ?? 'בדיקה, אישור ומעקב אחרי ההזמנה.'}
        actions={
          booking ? (
            <span className="flex flex-wrap items-center gap-2">
              <BookingStateBadge state={booking.state} label={booking.state_label} />
              {booking.is_simulation && <SimulationBadge />}
            </span>
          ) : undefined
        }
      />
      <QueryState
        query={query}
        compact={false}
        errorTitle="לא ניתן לטעון את ההזמנה"
        unavailable={<EmptyState icon={<ClipboardCheck />} title="ההזמנה לא נמצאה" description="ייתכן שהקישור שגוי או שההזמנה נמחקה." action={<Link to="/bookings" className="text-accent underline">לרשימת ההזמנות</Link>} />}
      >
        {(b) => <BookingReview booking={b} />}
      </QueryState>
    </div>
  );
}
