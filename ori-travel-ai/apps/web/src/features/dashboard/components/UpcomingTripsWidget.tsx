import { CalendarDays, Luggage, MapPin } from 'lucide-react';
import { Link } from 'react-router';
import { QueryState } from '@/components/QueryState';
import { ButtonLink, Card, CardHeader, DateRange, EmptyState, Skeleton } from '@/components/ui';
import { canEdit, useAuth } from '@/features/auth';
import { upcomingTrips, useTrips } from '@/features/trips/hooks';

export function UpcomingTripsWidget() {
  const query = useTrips();
  const { user } = useAuth();
  return (
    <Card className="flex flex-col">
      <CardHeader
        title="טיולים קרובים"
        description="מה מתוכנן בהמשך"
        icon={<Luggage />}
        actions={
          <Link to="/trips" className="text-sm font-medium text-accent hover:underline">
            לכל הטיולים
          </Link>
        }
      />
      <QueryState
        query={query}
        loading={
          <div className="flex flex-col gap-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        }
        isEmpty={(d) => upcomingTrips(d).length === 0}
        empty={
          <EmptyState
            compact
            icon={<CalendarDays />}
            title="אין טיולים מתוכננים"
            description={canEdit(user) ? 'צרו טיול חדש כדי לרכז טיסות, לינה ופעילויות במקום אחד.' : 'כשבני המשפחה ייצרו טיול, הוא יופיע כאן.'}
            action={
              canEdit(user) ? (
                <ButtonLink to="/trips" variant="secondary" size="sm">
                  לתכנון טיול
                </ButtonLink>
              ) : undefined
            }
          />
        }
      >
        {(data) => (
          <ul className="flex flex-col gap-2.5">
            {upcomingTrips(data)
              .slice(0, 3)
              .map((trip) => (
                <li key={trip.id}>
                  <Link
                    to={`/trips/${encodeURIComponent(trip.id)}`}
                    className="flex items-center gap-3 rounded-lg border border-line p-3 transition-colors hover:border-sea-200 hover:bg-sea-50/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold text-fg">{trip.title}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-muted">
                        {trip.destination && (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="size-3.5" aria-hidden="true" />
                            {trip.destination}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          <CalendarDays className="size-3.5" aria-hidden="true" />
                          <DateRange start={trip.start_date} end={trip.end_date} fallback="ללא תאריכים" />
                        </span>
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}
