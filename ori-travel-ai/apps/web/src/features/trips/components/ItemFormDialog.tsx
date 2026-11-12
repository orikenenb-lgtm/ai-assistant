import { useState, type FormEvent } from 'react';
import { Button, Callout, Dialog, Field, Input, NativeSelect, Textarea } from '@/components/ui';
import { ITEM_KINDS, ITEM_COST_STATUSES, type TripDetail, type TripItem } from '@/lib/schemas/trips';
import { normalizeAmount, toLocalInput } from '../datetime';
import { serverFieldErrors, submitErrorMessage } from '../formUtils';
import { COST_STATUS_HELP, COST_STATUS_LABELS, CURRENCIES, ITEM_KIND_LABELS, TIMEZONES } from '../labels';
import { useCreateItem, useUpdateItem } from '../hooks';

interface ItemFormState {
  kind: string;
  title: string;
  start_at: string;
  end_at: string;
  timezone: string;
  location: string;
  amount: string;
  currency: string;
  cost_status: string;
  notes: string;
}

function initial(trip: TripDetail, item?: TripItem): ItemFormState {
  return {
    kind: item?.kind ?? 'activity',
    title: item?.title ?? '',
    start_at: toLocalInput(item?.start_at, item?.timezone ?? trip.timezone),
    end_at: toLocalInput(item?.end_at, item?.timezone ?? trip.timezone),
    timezone: item?.timezone ?? '',
    location: item?.location ?? '',
    amount: item?.cost?.amount ?? '',
    currency: item?.cost?.currency ?? trip.budget?.currency ?? 'ILS',
    cost_status: item?.cost_status ?? 'estimate',
    notes: item?.notes ?? '',
  };
}

export function validateItemForm(f: ItemFormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.title.trim()) e.title = 'יש להזין כותרת';
  if (f.start_at && f.end_at && f.end_at < f.start_at) e.end_at = 'הסיום חייב להיות אחרי ההתחלה';
  if (f.amount.trim() && normalizeAmount(f.amount) === null) e.amount = 'סכום לא תקין';
  return e;
}

export interface ItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trip: TripDetail;
  item?: TripItem;
}

export function ItemFormDialog({ open, onOpenChange, trip, item }: ItemFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={item ? 'עריכת פריט' : 'הוספת פריט ידני'} size="lg"
      description={item?.offer_id ? 'הפריט נוצר מהצעה. עריכה משנה את הפריט בטיול בלבד — לא את ההצעה המקורית.' : 'פריט שאתם מזינים בעצמכם. המחיר שתזינו נשמר כפי שהוא, בלי בדיקה מול ספק.'}>
      {open && <ItemForm trip={trip} item={item} onDone={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function ItemForm({ trip, item, onDone }: { trip: TripDetail; item?: TripItem; onDone: () => void }) {
  const [form, setForm] = useState<ItemFormState>(() => initial(trip, item));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateItem(trip.id);
  const update = useUpdateItem(trip.id);
  const mutation = item ? update : create;
  const serverErrors = serverFieldErrors(mutation.error);
  const set = <K extends keyof ItemFormState>(k: K, v: ItemFormState[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: string) => errors[k] ?? serverErrors[k];
  const zoneKnown = !form.timezone || TIMEZONES.some((z) => z.id === form.timezone);

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const found = validateItemForm(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    const amount = normalizeAmount(form.amount);
    const body: Record<string, unknown> = {
      kind: form.kind,
      title: form.title.trim(),
      start_at: form.start_at || null,
      end_at: form.end_at || null,
      timezone: form.timezone || null,
      location: form.location.trim() || null,
      cost: amount ? { amount, currency: form.currency } : null,
      cost_status: form.cost_status,
      notes: form.notes.trim() || null,
    };
    if (item) update.mutate({ itemId: item.id, body }, { onSuccess: onDone });
    else {
      for (const k of ['start_at', 'end_at', 'timezone', 'location', 'cost', 'notes']) if (body[k] === null) delete body[k];
      create.mutate(body, { onSuccess: onDone });
    }
  }

  const general = submitErrorMessage(mutation.error);
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field label="סוג">
          <NativeSelect value={form.kind} onChange={(e) => set('kind', e.target.value)}>
            {ITEM_KINDS.map((k) => (
              <option key={k} value={k}>
                {ITEM_KIND_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="כותרת" required error={err('title')}>
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={300} autoComplete="off" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="התחלה (שעון מקומי)" optional error={err('start_at')}>
          <Input type="datetime-local" value={form.start_at} onChange={(e) => set('start_at', e.target.value)} dir="ltr" className="text-start" />
        </Field>
        <Field label="סיום (שעון מקומי)" optional error={err('end_at')}>
          <Input type="datetime-local" value={form.end_at} min={form.start_at || undefined} onChange={(e) => set('end_at', e.target.value)} dir="ltr" className="text-start" />
        </Field>
      </div>
      <Field
        label="אזור זמן"
        optional
        hint={
          trip.timezone
            ? 'השעות שהזנתם נקראות באזור הזמן הזה. אם לא תבחרו — אזור הזמן של הטיול.'
            : 'השעות שהזנתם נקראות באזור הזמן הזה. אם לא תבחרו ולטיול אין אזור זמן — UTC.'
        }
        error={err('timezone')}
      >
        <NativeSelect value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
          <option value="">לפי הטיול{trip.timezone ? ` (${trip.timezone})` : ''}</option>
          {!zoneKnown && <option value={form.timezone}>{form.timezone}</option>}
          {TIMEZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label} — {z.id}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field label="מיקום" optional error={err('location')}>
        <Input value={form.location} onChange={(e) => set('location', e.target.value)} maxLength={300} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem_10rem]">
        <Field label="עלות" optional error={err('amount') ?? err('cost')}>
          <Input inputMode="decimal" value={form.amount} onChange={(e) => set('amount', e.target.value)} dir="ltr" className="text-start" placeholder="0.00" />
        </Field>
        <Field label="מטבע">
          <NativeSelect value={form.currency} onChange={(e) => set('currency', e.target.value)} aria-label="מטבע העלות">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label="סטטוס עלות" hint={COST_STATUS_HELP[form.cost_status as keyof typeof COST_STATUS_HELP]}>
          <NativeSelect value={form.cost_status} onChange={(e) => set('cost_status', e.target.value)}>
            {ITEM_COST_STATUSES.map((s) => (
              <option key={s} value={s}>
                {COST_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Field label="הערות" optional error={err('notes')}>
        <Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={5000} />
      </Field>
      {general && (
        <Callout tone="danger" role="alert">
          {general}
        </Callout>
      )}
      <div className="flex flex-wrap-reverse justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onDone}>
          ביטול
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {item ? 'שמירה' : 'הוספה'}
        </Button>
      </div>
    </form>
  );
}
