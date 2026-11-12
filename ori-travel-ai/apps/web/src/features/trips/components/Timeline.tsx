import { CalendarClock, Inbox } from 'lucide-react';
import { useMemo, useState } from 'react';
import { ConfirmDialog, DateText, EmptyState, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import type { TripDetail, TripItem } from '@/lib/schemas/trips';
import { useDeleteItem, useReorderItems } from '../hooks';
import { ItemFormDialog } from './ItemFormDialog';
import { ItemRow } from './ItemRow';

const SAME_TIME_HINT = 'הסדר ביום נקבע לפי שעת ההתחלה — אפשר להחליף רק פריטים בעלי אותה שעה. שנו את השעה כדי להזיז.';

export function Timeline({ trip, editable }: { trip: TripDetail; editable: boolean }) {
  const { toast } = useToast();
  const byId = useMemo(() => new Map(trip.items.map((i) => [i.id, i])), [trip.items]);
  const reorder = useReorderItems(trip.id);
  const del = useDeleteItem(trip.id);
  const [editing, setEditing] = useState<TripItem | null>(null);
  const [deleting, setDeleting] = useState<TripItem | null>(null);

  // Global order as the server holds it (sort_order); a move swaps two entries in it.
  const order = trip.items.map((i) => i.id);

  function move(group: string[], index: number, dir: -1 | 1) {
    const a = group[index];
    const b = group[index + dir];
    if (!a || !b) return;
    const next = [...order];
    const ia = next.indexOf(a);
    const ib = next.indexOf(b);
    [next[ia], next[ib]] = [next[ib]!, next[ia]!];
    reorder.mutate(next, {
      onError: (e) => toast({ title: 'לא ניתן לשנות את הסדר', description: errorMessage(e), tone: 'danger' }),
    });
  }

  function renderGroup(ids: string[], scheduled: boolean) {
    const items = ids.map((id) => byId.get(id)).filter((i): i is TripItem => !!i);
    return (
      <ul className="flex flex-col gap-2.5">
        {items.map((item, idx) => {
          const prev = items[idx - 1];
          const next = items[idx + 1];
          const sameTime = (other?: TripItem) => !scheduled || (!!other && other.start_at === item.start_at);
          return (
            <ItemRow
              key={item.id}
              item={item}
              trip={trip}
              editable={editable}
              canMoveUp={!!prev && sameTime(prev)}
              canMoveDown={!!next && sameTime(next)}
              moveHint={scheduled ? SAME_TIME_HINT : undefined}
              busy={reorder.isPending}
              onMove={(dir) => move(ids, idx, dir)}
              onEdit={() => setEditing(item)}
              onDelete={() => setDeleting(item)}
            />
          );
        })}
      </ul>
    );
  }

  const empty = trip.days.length === 0 && trip.unscheduled_item_ids.length === 0;

  return (
    <div className="flex flex-col gap-6">
      {empty && (
        <EmptyState
          icon={<CalendarClock />}
          title="עוד אין פריטים בטיול"
          description={
            editable
              ? 'הוסיפו הצעה משמורות או מתוצאות חיפוש, או הוסיפו פריט ידני כמו מסעדה, הסעה או הערה.'
              : 'כשבני המשפחה יוסיפו פריטים הם יופיעו כאן.'
          }
        />
      )}
      {trip.days.map((day, i) => (
        <section key={day.date} aria-labelledby={`day-${day.date}`} data-testid="trip-day">
          <h3 id={`day-${day.date}`} className="mb-2.5 flex items-baseline gap-2 text-base font-semibold text-fg">
            <span className="text-xs font-medium text-fg-subtle">יום {i + 1}</span>
            <DateText value={day.date} preset="weekday-date" />
          </h3>
          {renderGroup(day.item_ids, true)}
        </section>
      ))}
      {trip.unscheduled_item_ids.length > 0 && (
        <section aria-labelledby="unscheduled-heading" data-testid="trip-unscheduled">
          <h3 id="unscheduled-heading" className="mb-1 flex items-center gap-2 text-base font-semibold text-fg">
            <Inbox className="size-4 text-fg-subtle" aria-hidden="true" />
            ללא תאריך
          </h3>
          <p className="mb-2.5 text-sm text-fg-muted">פריטים בלי שעת התחלה. הסדר כאן נקבע ידנית.</p>
          {renderGroup(trip.unscheduled_item_ids, false)}
        </section>
      )}

      {editing && <ItemFormDialog open onOpenChange={(o) => !o && setEditing(null)} trip={trip} item={editing} />}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="מחיקת פריט"
        description={deleting ? `למחוק את "${deleting.title}" מהטיול? ההצעה המקורית לא תימחק.` : undefined}
        confirmLabel="מחיקה"
        tone="danger"
        onConfirm={async () => {
          if (deleting) await del.mutateAsync(deleting.id);
        }}
      />
    </div>
  );
}
