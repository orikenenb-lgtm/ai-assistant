import { CalendarDays, Package, Users } from 'lucide-react';
import { Link } from 'react-router';
import { Badge, Card, DateRange, MoneyText } from '@/components/ui';
import type { TripSummary } from '@/lib/schemas/trips';
import { isZeroAmount } from '../datetime';
import { tripStatusLabel } from '../labels';

export function TripCard({ trip }: { trip: TripSummary }) {
  const totals = trip.totals.filter((t) => !isZeroAmount(t.known) || !isZeroAmount(t.estimated));
  return (
    <Card as="article" interactive padding="none" data-testid="trip-card" className="relative">
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-fg">
              <Link
                to={`/trips/${encodeURIComponent(trip.id)}`}
                className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-offset-2"
              >
                {trip.title}
              </Link>
            </h2>
            <p className="truncate text-sm text-fg-muted">{trip.destination ?? 'ללא יעד'}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {trip.has_demo_data && <Badge tone="demo">נתוני הדגמה</Badge>}
            {trip.status && trip.status !== 'planning' && <Badge tone="info">{tripStatusLabel(trip.status)}</Badge>}
          </div>
        </div>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1.5 text-sm text-fg-muted sm:grid-cols-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <dt className="sr-only">תאריכים</dt>
            <dd>{trip.start_date ? <DateRange start={trip.start_date} end={trip.end_date} /> : 'תאריכים לא נקבעו'}</dd>
          </div>
          <div className="flex items-center gap-2">
            <Users className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <dt className="sr-only">נוסעים</dt>
            <dd>{trip.traveler_count ?? 0} נוסעים</dd>
          </div>
          <div className="flex items-center gap-2">
            <Package className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
            <dt className="sr-only">פריטים</dt>
            <dd>{trip.item_count ?? 0} פריטים</dd>
          </div>
        </dl>
        <div className="border-t border-line pt-3 text-sm">
          {totals.length === 0 ? (
            <span className="text-fg-subtle">אין עדיין עלויות בטיול</span>
          ) : (
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {totals.map((t) => (
                <li key={t.currency} className="flex items-baseline gap-1.5">
                  <MoneyText amount={t.known} currency={t.currency} className="font-semibold text-fg" />
                  {!isZeroAmount(t.estimated) && (
                    <span className="text-xs text-fg-muted">
                      + <MoneyText amount={t.estimated} currency={t.currency} estimated /> משוער
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
