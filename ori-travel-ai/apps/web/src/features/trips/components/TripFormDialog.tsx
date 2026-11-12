import { useState, type FormEvent } from 'react';
import { Button, Callout, Checkbox, Dialog, Field, Input, NativeSelect, Textarea } from '@/components/ui';
import { useMembers } from '@/features/family/hooks';
import type { TripDetail } from '@/lib/schemas/trips';
import { TRIP_STATUSES } from '@/lib/schemas/trips';
import { normalizeAmount } from '../datetime';
import { serverFieldErrors, submitErrorMessage } from '../formUtils';
import { CURRENCIES, TIMEZONES, TRIP_STATUS_LABELS } from '../labels';
import { useCreateTrip, useUpdateTrip } from '../hooks';

interface FormState {
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  timezone: string;
  budgetAmount: string;
  budgetCurrency: string;
  notes: string;
  status: string;
  traveler_ids: string[];
}

function initial(trip?: TripDetail): FormState {
  return {
    title: trip?.title ?? '',
    destination: trip?.destination ?? '',
    start_date: trip?.start_date ?? '',
    end_date: trip?.end_date ?? '',
    timezone: trip?.timezone ?? '',
    budgetAmount: trip?.budget ? trip.budget.amount : '',
    budgetCurrency: trip?.budget?.currency ?? 'ILS',
    notes: trip?.notes ?? '',
    status: trip?.status ?? 'planning',
    traveler_ids: trip?.travelers.map((t) => t.id) ?? [],
  };
}

export function validateTripForm(f: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.title.trim()) e.title = 'יש להזין שם לטיול';
  if (f.start_date && f.end_date && f.end_date < f.start_date) e.end_date = 'תאריך הסיום חייב להיות אחרי תאריך ההתחלה';
  if (f.budgetAmount.trim() && normalizeAmount(f.budgetAmount) === null) e.budget = 'סכום לא תקין (מספר חיובי עד שתי ספרות אחרי הנקודה)';
  return e;
}

export interface TripFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this trip; otherwise it creates one. */
  trip?: TripDetail;
  onSaved?: (trip: TripDetail) => void;
}

export function TripFormDialog({ open, onOpenChange, trip, onSaved }: TripFormDialogProps) {
  // Remount the form body on each open so state always starts from the current trip.
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={trip ? 'עריכת טיול' : 'טיול חדש'}
      description={trip ? undefined : 'שם ויעד מספיקים להתחלה — את השאר אפשר להשלים בהמשך.'}
      size="lg"
    >
      {open && <TripForm trip={trip} onDone={(t) => { onOpenChange(false); onSaved?.(t); }} onCancel={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function TripForm({ trip, onDone, onCancel }: { trip?: TripDetail; onDone: (t: TripDetail) => void; onCancel: () => void }) {
  const [form, setForm] = useState<FormState>(() => initial(trip));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const members = useMembers();
  const create = useCreateTrip();
  const update = useUpdateTrip(trip?.id ?? '');
  const mutation = trip ? update : create;
  const serverErrors = serverFieldErrors(mutation.error);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));

  const zoneKnown = !form.timezone || TIMEZONES.some((z) => z.id === form.timezone);

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const found = validateTripForm(form);
    setErrors(found);
    if (Object.keys(found).length) return;
    const amount = normalizeAmount(form.budgetAmount);
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      destination: form.destination.trim() || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      timezone: form.timezone || null,
      budget: amount ? { amount, currency: form.budgetCurrency } : null,
      notes: form.notes.trim() || null,
      traveler_ids: form.traveler_ids,
    };
    if (trip) body.status = form.status;
    if (!trip) {
      // Omit nulls on create — the server defaults them.
      for (const k of ['destination', 'start_date', 'end_date', 'timezone', 'budget', 'notes']) if (body[k] === null) delete body[k];
    }
    mutation.mutate(body, { onSuccess: (saved) => onDone(saved) });
  }

  const err = (k: string) => errors[k] ?? serverErrors[k];
  const general = submitErrorMessage(mutation.error);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field label="שם הטיול" required error={err('title')}>
        <Input value={form.title} onChange={(e) => set('title', e.target.value)} maxLength={200} autoComplete="off" />
      </Field>
      <Field label="יעד" optional error={err('destination')}>
        <Input value={form.destination} onChange={(e) => set('destination', e.target.value)} maxLength={200} placeholder="למשל: רומא, איטליה" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="תאריך התחלה" optional error={err('start_date')}>
          <Input type="date" value={form.start_date} onChange={(e) => set('start_date', e.target.value)} dir="ltr" className="text-start" />
        </Field>
        <Field label="תאריך סיום" optional error={err('end_date')}>
          <Input type="date" value={form.end_date} min={form.start_date || undefined} onChange={(e) => set('end_date', e.target.value)} dir="ltr" className="text-start" />
        </Field>
      </div>
      <Field label="אזור זמן של היעד" optional hint="קובע באיזו שעה מקומית יוצגו פריטים בלי אזור זמן משלהם." error={err('timezone')}>
        <NativeSelect value={form.timezone} onChange={(e) => set('timezone', e.target.value)}>
          <option value="">לא נבחר</option>
          {!zoneKnown && <option value={form.timezone}>{form.timezone}</option>}
          {TIMEZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label} — {z.id}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
        <Field label="תקציב" optional error={err('budget')} hint="סכום כולל לטיול. אפשר להשאיר ריק.">
          <Input inputMode="decimal" value={form.budgetAmount} onChange={(e) => set('budgetAmount', e.target.value)} dir="ltr" className="text-start" placeholder="0.00" />
        </Field>
        <Field label="מטבע">
          <NativeSelect value={form.budgetCurrency} onChange={(e) => set('budgetCurrency', e.target.value)} aria-label="מטבע התקציב">
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {trip && (
        <Field label="סטטוס">
          <NativeSelect value={form.status} onChange={(e) => set('status', e.target.value)}>
            {TRIP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TRIP_STATUS_LABELS[s]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium text-fg">נוסעים</legend>
        {members.isPending ? (
          <p className="text-sm text-fg-muted">טוען בני משפחה…</p>
        ) : members.isError || !members.data?.length ? (
          <p className="text-sm text-fg-muted">אין בני משפחה להצגה. אפשר להוסיף בעמוד "משפחה" ולשייך אותם לטיול בהמשך.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {members.data.map((m) => (
              <Checkbox
                key={m.id}
                label={m.display_name}
                description={m.relation ?? undefined}
                checked={form.traveler_ids.includes(m.id)}
                onChange={(e) =>
                  set('traveler_ids', e.target.checked ? [...form.traveler_ids, m.id] : form.traveler_ids.filter((x) => x !== m.id))
                }
              />
            ))}
          </div>
        )}
      </fieldset>
      <Field label="הערות" optional error={err('notes')}>
        <Textarea rows={3} value={form.notes} onChange={(e) => set('notes', e.target.value)} maxLength={5000} />
      </Field>
      {general && (
        <Callout tone="danger" role="alert">
          {general}
        </Callout>
      )}
      <div className="flex flex-wrap-reverse justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onCancel}>
          ביטול
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {trip ? 'שמירה' : 'יצירת טיול'}
        </Button>
      </div>
    </form>
  );
}
