import { ArrowLeft, TrendingDown, TrendingUp } from 'lucide-react';
import { Badge, Card, CardHeader, DateText, FreshnessText, MoneyText } from '@/components/ui';
import { compareDecimal } from '@/features/offers';
import type { Booking } from '@/lib/schemas/bookings';
import { Countdown } from './Countdown';

/** Quoted vs. current price, price-check freshness and offer expiry. */
export function PriceSection({ booking }: { booking: Booking }) {
  const terminal = ['CONFIRMED', 'EXPIRED', 'FAILED', 'CANCELLED'].includes(booking.state);
  const up = compareDecimal(booking.current_price.amount, booking.quoted_price.amount) > 0;
  return (
    <Card as="section" padding="md">
      <CardHeader title="מחיר ותוקף" level={2} />
      {booking.price_changed && (
        <div
          role="status"
          className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-amber-700"
          data-testid="price-changed"
        >
          {up ? <TrendingUp className="size-5" aria-hidden="true" /> : <TrendingDown className="size-5" aria-hidden="true" />}
          <strong className="text-base">המחיר השתנה</strong>
          <span className="flex items-center gap-2 text-sm">
            <span className="line-through opacity-80">
              <MoneyText value={booking.quoted_price} />
            </span>
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="font-bold">
              <MoneyText value={booking.current_price} />
            </span>
            <span>({up ? 'עלייה' : 'ירידה'})</span>
          </span>
        </div>
      )}
      <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-fg-subtle">מחיר שהוצע</dt>
          <dd className="text-fg">
            <MoneyText value={booking.quoted_price} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">מחיר נוכחי (סה״כ)</dt>
          <dd className="text-xl font-bold text-fg" data-testid="current-price">
            <MoneyText value={booking.current_price} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">בדיקת מחיר אחרונה</dt>
          <dd className="flex flex-wrap items-center gap-2 text-fg">
            {booking.revalidated_at ? (
              <>
                <span className="inline-flex flex-col">
                  <DateText value={booking.revalidated_at} preset="datetime" />
                  <FreshnessText value={booking.revalidated_at} className="text-xs text-fg-subtle" />
                </span>
                {!terminal && (
                  <Badge tone={booking.revalidation_fresh ? 'success' : 'warn'} size="sm">
                    {booking.revalidation_fresh ? 'עדכנית' : 'לא עדכנית'}
                  </Badge>
                )}
              </>
            ) : (
              <span className="text-fg-muted">טרם בוצעה</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">תוקף ההצעה</dt>
          <dd className="text-fg">
            {terminal ? (
              <span className="text-fg-muted">—</span>
            ) : (
              <>
                <Countdown until={booking.offer_expires_at} />
                {booking.offer_expires_at && (
                  <span className="block text-xs text-fg-subtle">
                    עד <DateText value={booking.offer_expires_at} preset="datetime" />
                  </span>
                )}
              </>
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}
