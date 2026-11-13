import { CalendarPlus, Luggage } from 'lucide-react';
import { useContext, useState } from 'react';
import { Link } from 'react-router';
import { Button, Callout, ConfirmDialog, DateRange, Dialog, EmptyState, Skeleton, type ButtonProps } from '@/components/ui';
import { canEdit } from '@/features/auth';
import { AuthContext } from '@/features/auth/context';
import { fetchTrips, tripKeys } from '@/features/trips/api';
import { overlapConflict, overlapPrompt } from '@/features/trips/formUtils';
import { useQuery } from '@tanstack/react-query';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAddOfferToTrip } from '../hooks';

export interface AddToTripButtonProps extends Pick<ButtonProps, 'size' | 'variant' | 'className'> {
  offerId: string;
}

/**
 * Trip picker (GET /api/trips) → POST /api/trips/{id}/items/from-offer. Hidden for viewers (server enforces).
 * A 409 ITEM_OVERLAP opens a confirmation; confirming resends with `allow_overlap: true`, cancelling sends nothing.
 */
export function AddToTripButton({ offerId, size = 'sm', variant = 'secondary', className }: AddToTripButtonProps) {
  const user = useContext(AuthContext)?.user ?? null;
  const [open, setOpen] = useState(false);
  const [tripId, setTripId] = useState<string | null>(null);
  const [overlap, setOverlap] = useState<{ tripId: string; tripTitle?: string; prompt: string; message: string } | null>(null);
  const trips = useQuery({ queryKey: tripKeys.list, queryFn: fetchTrips, enabled: open && canEdit(user) });
  const add = useAddOfferToTrip();

  if (!canEdit(user)) return null;

  const unavailable = trips.isError && isApiError(trips.error) && trips.error.status === 404;
  const list = trips.data ?? [];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTripId(null);
        }}
        trigger={
          <Button variant={variant} size={size} className={className} leadingIcon={<CalendarPlus aria-hidden="true" />}>
            הוספה לטיול
          </Button>
        }
        title="הוספה לטיול"
        description="בחרו טיול. ההצעה תתווסף עם צילום של המחיר והפרטים כפי שהם עכשיו."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              ביטול
            </Button>
            <Button
              disabled={!tripId}
              loading={add.isPending}
              onClick={() => {
                if (!tripId) return;
                const trip = list.find((t) => t.id === tripId);
                add.mutate(
                  { tripId, offerId, tripTitle: trip?.title },
                  {
                    onSuccess: () => setOpen(false),
                    onError: (e) => {
                      const conflict = overlapConflict(e);
                      if (conflict) setOverlap({ tripId, tripTitle: trip?.title, prompt: overlapPrompt(conflict.title), message: conflict.message });
                    },
                  },
                );
              }}
            >
              הוספה
            </Button>
          </>
        }
      >
        {trips.isPending ? (
          <div className="flex flex-col gap-2" aria-busy="true">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : unavailable ? (
          <Callout tone="info" title="הטיולים עדיין לא זמינים בשרת">
            אפשר לשמור את ההצעה ברשימה השמורה ולהוסיף אותה לטיול כשהשירות יהיה זמין.
          </Callout>
        ) : trips.isError ? (
          <Callout tone="danger" title="לא ניתן לטעון את הטיולים" role="alert">
            {isApiError(trips.error) ? trips.error.message : 'נסו שוב.'}
          </Callout>
        ) : list.length === 0 ? (
          <EmptyState
            compact
            icon={<Luggage />}
            title="אין עדיין טיולים"
            description="צרו טיול ואז הוסיפו אליו הצעות."
            action={
              <Link to="/trips" className="text-sm font-medium text-accent underline-offset-4 hover:underline" onClick={() => setOpen(false)}>
                מעבר לטיולים
              </Link>
            }
          />
        ) : (
          <fieldset>
            <legend className="sr-only">בחירת טיול</legend>
            <ul className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {list.map((t) => (
                <li key={t.id}>
                  <label
                    className={cn(
                      'flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors',
                      tripId === t.id ? 'border-sea-500 bg-sea-50' : 'border-line hover:bg-sand-50',
                    )}
                  >
                    <input
                      type="radio"
                      name="trip"
                      value={t.id}
                      checked={tripId === t.id}
                      onChange={() => setTripId(t.id)}
                      className="size-4 accent-sea-600"
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-fg">{t.title}</span>
                      <span className="block truncate text-xs text-fg-muted">
                        {t.destination ?? 'ללא יעד'}
                        {t.start_date && t.end_date && (
                          <>
                            {' · '}
                            <DateRange start={t.start_date} end={t.end_date} preset="date-short" />
                          </>
                        )}
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
      </Dialog>
      <ConfirmDialog
        open={overlap !== null}
        onOpenChange={(next) => {
          if (!next) setOverlap(null);
        }}
        title="חפיפה עם פריט אחר בטיול"
        description={overlap?.prompt}
        confirmLabel="הוספה בכל זאת"
        cancelLabel="ביטול"
        onConfirm={async () => {
          if (!overlap) return;
          await add.mutateAsync({ tripId: overlap.tripId, offerId, tripTitle: overlap.tripTitle, allowOverlap: true });
          setOpen(false);
        }}
      >
        {overlap?.message && overlap.message !== overlap.prompt && <p className="text-sm leading-relaxed text-fg-muted">{overlap.message}</p>}
      </ConfirmDialog>
    </>
  );
}
