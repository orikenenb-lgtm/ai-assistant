import { Pencil, Users } from 'lucide-react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Callout, Card, CardHeader, Checkbox, Dialog, Skeleton } from '@/components/ui';
import { familyKeys, fetchMembers } from '@/features/family/api';
import type { Booking } from '@/lib/schemas/bookings';
import { useBookingActions } from '../hooks';
import type { Feedback } from './useFeedback';

const AGE_LABELS: Record<string, string> = { adult: 'מבוגר/ת', child: 'ילד/ה', infant: 'תינוק/ת' };
const MAX_TRAVELERS = 9;

function EditTravelersDialog({ booking, feedback, onClose }: { booking: Booking; feedback: Feedback; onClose: () => void }) {
  const members = useQuery({ queryKey: familyKeys.members, queryFn: fetchMembers });
  const { travelers } = useBookingActions(booking.id);
  const [selected, setSelected] = useState<string[]>(() => booking.travelers.map((t) => t.family_member_id));
  const unchanged = selected.length === booking.travelers.length && selected.every((id) => booking.travelers.some((t) => t.family_member_id === id));
  const invalid = selected.length === 0 || selected.length > MAX_TRAVELERS;
  const hasApproval = booking.state === 'APPROVED';

  async function save() {
    const b = await feedback.run(travelers.mutateAsync(selected));
    if (b) onClose();
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && !travelers.isPending && onClose()}
      title="עריכת נוסעים"
      description="בחרו מי נוסע בהזמנה זו."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={travelers.isPending}>
            ביטול
          </Button>
          <Button onClick={() => void save()} loading={travelers.isPending} disabled={unchanged || invalid || members.isPending}>
            שמירת נוסעים
          </Button>
        </>
      }
    >
      <Callout tone="warn" title="שינוי נוסעים מבטל את האישור" className="mb-4">
        {hasApproval ? 'ההזמנה כבר אושרה — השינוי יבטל את האישור. ' : ''}
        אחרי השינוי יש לבדוק מחיר מחדש ולאשר שוב את התנאים המעודכנים.
      </Callout>
      {members.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : members.isError ? (
        <Callout tone="danger" role="alert">
          לא ניתן לטעון את בני המשפחה.
        </Callout>
      ) : (
        <fieldset className="flex max-h-72 flex-col gap-2 overflow-y-auto">
          <legend className="sr-only">נוסעים</legend>
          {members.data.map((m) => (
            <Checkbox
              key={m.id}
              label={m.display_name}
              description={AGE_LABELS[m.age_group] ?? m.age_group}
              checked={selected.includes(m.id)}
              onChange={(e) => setSelected((cur) => (e.target.checked ? [...cur, m.id] : cur.filter((x) => x !== m.id)))}
            />
          ))}
        </fieldset>
      )}
      {invalid && <p className="mt-2 text-sm text-coral-700">בחרו בין נוסע אחד ל-{MAX_TRAVELERS} נוסעים.</p>}
    </Dialog>
  );
}

export function TravelersSection({ booking, feedback }: { booking: Booking; feedback: Feedback }) {
  const [editing, setEditing] = useState(false);
  return (
    <Card as="section" padding="md">
      <CardHeader
        title="נוסעים"
        icon={<Users />}
        actions={
          booking.can.edit_travelers ? (
            <Button size="sm" variant="secondary" leadingIcon={<Pencil aria-hidden="true" />} onClick={() => setEditing(true)}>
              עריכת נוסעים
            </Button>
          ) : undefined
        }
      />
      <ul className="flex flex-wrap gap-2" data-testid="travelers-list">
        {booking.travelers.map((t) => (
          <li key={t.family_member_id}>
            <Badge tone="neutral">
              {t.display_name} · {AGE_LABELS[t.age_group] ?? t.age_group}
            </Badge>
          </li>
        ))}
      </ul>
      {editing && <EditTravelersDialog booking={booking} feedback={feedback} onClose={() => setEditing(false)} />}
    </Card>
  );
}
