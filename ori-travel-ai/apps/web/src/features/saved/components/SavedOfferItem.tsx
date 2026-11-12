import { Luggage, NotebookPen, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Callout, ConfirmDialog, Dialog, Field, NativeSelect, Textarea, useToast } from '@/components/ui';
import { StartBookingButton } from '@/features/bookings/components/StartBookingButton';
import { OfferCard } from '@/features/offers';
import type { SavedOffer } from '@/lib/schemas/saved';
import type { TripSummary } from '@/lib/schemas/trips';
import { errorMessage } from '@/lib/api';
import { useDeleteSaved, useUpdateSaved } from '../hooks';

export interface SavedOfferItemProps {
  saved: SavedOffer;
  trips: TripSummary[];
  canAssign: boolean;
  onOpenDetails: (offer: SavedOffer['offer']) => void;
}

export function SavedOfferItem({ saved, trips, canAssign, onOpenDetails }: SavedOfferItemProps) {
  const { toast } = useToast();
  const update = useUpdateSaved();
  const del = useDeleteSaved();
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState(saved.note ?? '');
  const [removing, setRemoving] = useState(false);
  const trip = trips.find((t) => t.id === saved.trip_id);

  function saveNote() {
    update.mutate(
      { id: saved.id, body: { note: note.trim() || null } },
      {
        onSuccess: () => {
          setNoteOpen(false);
          toast({ title: 'ההערה נשמרה', tone: 'success' });
        },
      },
    );
  }

  return (
    <li className="flex flex-col gap-2" data-testid="saved-offer" data-saved-id={saved.id}>
      <OfferCard
        offer={saved.offer}
        rank={null}
        showSave={false}
        onOpenDetails={onOpenDetails}
        extraActions={
          <>
            {!saved.is_expired && <StartBookingButton offerId={saved.offer.id} mode={saved.offer.source.mode} />}
            <Button size="sm" variant="secondary" leadingIcon={<NotebookPen aria-hidden="true" />} onClick={() => { setNote(saved.note ?? ''); setNoteOpen(true); }}>
              {saved.note ? 'עריכת הערה' : 'הוספת הערה'}
            </Button>
            <Button size="sm" variant="ghost" leadingIcon={<Trash2 aria-hidden="true" />} onClick={() => setRemoving(true)}>
              הסרה מהרשימה
            </Button>
          </>
        }
      />
      <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken px-4 py-3 text-sm">
        {saved.is_expired && (
          <Callout tone="warn" icon={<TriangleAlert />} title="פג תוקף ההצעה">
            המחיר והזמינות כבר לא מובטחים. חפשו מחדש כדי לקבל מחיר עדכני לפני שמוסיפים לטיול.
          </Callout>
        )}
        {saved.note && (
          <p className="whitespace-pre-line text-fg" data-testid="saved-note">
            <span className="font-medium text-fg-muted">הערה: </span>
            {saved.note}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Luggage className="size-4 text-fg-subtle" aria-hidden="true" />
          {canAssign ? (
            <Field label="משויך לטיול" className="min-w-52 flex-1 sm:max-w-xs" labelClassName="sr-only">
              <NativeSelect
                aria-label="שיוך לטיול"
                value={saved.trip_id ?? ''}
                disabled={update.isPending}
                onChange={(e) =>
                  update.mutate(
                    { id: saved.id, body: { trip_id: e.target.value || null } },
                    { onError: (err) => toast({ title: 'לא ניתן לשייך לטיול', description: errorMessage(err), tone: 'danger' }) },
                  )
                }
              >
                <option value="">לא משויך לטיול</option>
                {trips.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          ) : (
            <span className="text-fg-muted">{trip ? trip.title : 'לא משויך לטיול'}</span>
          )}
          {trip && (
            <Link to={`/trips/${encodeURIComponent(trip.id)}`} className="text-accent underline-offset-4 hover:underline">
              לפתיחת הטיול
            </Link>
          )}
          {!trip && saved.trip_id && <Badge tone="muted">הטיול לא נמצא</Badge>}
        </div>
      </div>

      <Dialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        title="הערה להצעה"
        description="ההערה פרטית ורק את/ה רואה אותה."
        footer={
          <>
            <Button variant="secondary" onClick={() => setNoteOpen(false)}>
              ביטול
            </Button>
            <Button loading={update.isPending} onClick={saveNote}>
              שמירה
            </Button>
          </>
        }
      >
        <Field label="הערה" hint={`${note.length}/500`} error={update.isError && update.variables?.body.note !== undefined ? errorMessage(update.error) : undefined}>
          <Textarea rows={4} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </Dialog>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title="הסרת הצעה שמורה"
        description="ההצעה תוסר מהרשימה האישית שלך. פריטים שכבר נוספו לטיולים לא יושפעו."
        confirmLabel="הסרה"
        tone="danger"
        onConfirm={async () => {
          await del.mutateAsync(saved.id);
        }}
      />
    </li>
  );
}
