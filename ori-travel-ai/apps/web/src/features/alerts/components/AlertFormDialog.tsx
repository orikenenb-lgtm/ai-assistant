import { useState, type FormEvent } from 'react';
import { Button, Callout, Dialog, Field, Input, NativeSelect } from '@/components/ui';
import { CABIN_LABELS } from '@/features/offers/labels';
import { normalizeAmount, todayIso } from '@/features/trips/datetime';
import { serverFieldErrors } from '@/features/trips/formUtils';
import { errorMessage } from '@/lib/api';
import { CURRENCIES } from '@/features/trips/labels';
import { CATEGORY_LABELS } from '@/lib/labels';
import { CATEGORIES, type Category } from '@/lib/schemas/common';
import type { Alert } from '@/lib/schemas/alerts';
import { useCreateAlert, useUpdateAlert } from '../hooks';
import {
  buildSearchParams,
  defaultAlertName,
  EMPTY_PARAMS,
  INTERVAL_PRESETS,
  MIN_INTERVAL_MINUTES,
  stateFromParams,
  validateParams,
  type ParamsState,
} from '../paramsForm';

export interface AlertSeed {
  category: Category;
  params: Record<string, unknown>;
}

export interface AlertFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit name / target / interval of an existing alert (the search itself is not editable). */
  alert?: Alert;
  /** Pre-fill from a stored search (`?from_search=`). */
  seed?: AlertSeed;
}

export function AlertFormDialog({ open, onOpenChange, alert, seed }: AlertFormDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={alert ? 'עריכת התראה' : 'התראת מחיר חדשה'}
      description={
        alert
          ? 'אפשר לשנות שם, מחיר יעד ותדירות. כדי לשנות את החיפוש עצמו, צרו התראה חדשה.'
          : 'נבדוק את החיפוש מדי פעם ונודיע כשהמחיר הטוב ביותר מגיע ליעד. הבדיקות משתמשות בספקים הפעילים — ובמצב הדגמה המחירים אינם אמיתיים.'
      }
    >
      {open && <AlertForm alert={alert} seed={seed} onClose={() => onOpenChange(false)} />}
    </Dialog>
  );
}

function AlertForm({ alert, seed, onClose }: { alert?: Alert; seed?: AlertSeed; onClose: () => void }) {
  const initialCategory: Category = alert?.category ?? seed?.category ?? 'flight';
  const [category, setCategory] = useState<Category>(initialCategory);
  const [params, setParams] = useState<ParamsState>(() =>
    alert ? stateFromParams(alert.category, alert.search_params) : seed ? stateFromParams(seed.category, seed.params) : EMPTY_PARAMS,
  );
  const extra = alert?.search_params ?? seed?.params ?? {};
  const [name, setName] = useState(alert?.name ?? '');
  const [target, setTarget] = useState(alert?.target_price?.amount ?? '');
  const initialInterval = alert?.check_interval_minutes ?? 720;
  const isPreset = INTERVAL_PRESETS.some((p) => p.minutes === initialInterval);
  const [intervalChoice, setIntervalChoice] = useState<string>(isPreset ? String(initialInterval) : 'custom');
  const [customMinutes, setCustomMinutes] = useState(String(initialInterval));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const create = useCreateAlert();
  const update = useUpdateAlert();
  const mutation = alert ? update : create;
  const serverErrors = serverFieldErrors(mutation.error);
  const err = (k: string) => errors[k] ?? serverErrors[k];
  const setP = <K extends keyof ParamsState>(k: K, v: ParamsState[K]) => setParams((p) => ({ ...p, [k]: v }));
  const currency = alert?.currency ?? params.currency;
  const today = todayIso();

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const found: Record<string, string> = alert ? {} : validateParams(category, params);
    const minutes = intervalChoice === 'custom' ? Number.parseInt(customMinutes, 10) : Number.parseInt(intervalChoice, 10);
    if (!Number.isFinite(minutes) || minutes < MIN_INTERVAL_MINUTES) found.interval = `התדירות המינימלית היא פעם ב-${MIN_INTERVAL_MINUTES} דקות (6 שעות)`;
    else if (minutes > 60 * 24 * 30) found.interval = 'התדירות המקסימלית היא פעם ב-30 יום';
    const amount = normalizeAmount(target);
    if (target.trim() && (amount === null || Number(amount) <= 0)) found.target = 'מחיר יעד חייב להיות מספר חיובי';
    const finalName = name.trim() || (alert ? alert.name : defaultAlertName(category, params));
    if (!finalName) found.name = 'יש להזין שם להתראה';
    setErrors(found);
    if (Object.keys(found).length) return;
    const targetPrice = amount ? { amount, currency } : null;
    if (alert) {
      update.mutate({ id: alert.id, body: { name: finalName, target_price: targetPrice, check_interval_minutes: minutes } }, { onSuccess: onClose });
    } else {
      create.mutate(
        {
          name: finalName,
          category,
          search_params: buildSearchParams(category, params, seed && seed.category === category ? extra : {}),
          ...(targetPrice ? { target_price: targetPrice } : {}),
          check_interval_minutes: minutes,
        },
        { onSuccess: onClose },
      );
    }
  }

  const general = mutation.error ? errorMessage(mutation.error) : null;
  const dateInput = (key: 'start' | 'end', label: string, errKey: string, min?: string) => (
    <Field label={label} required error={err(errKey)}>
      <Input type="date" value={params[key]} min={min ?? today} onChange={(e) => setP(key, e.target.value)} dir="ltr" className="text-start" />
    </Field>
  );

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {!alert && (
        <Field label="סוג החיפוש">
          <NativeSelect value={category} disabled={!!seed} onChange={(e) => { setCategory(e.target.value as Category); setErrors({}); }}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      {seed && !alert && (
        <Callout tone="info">ההתראה מבוססת על החיפוש האחרון שלך. אפשר לתקן את הפרטים לפני השמירה.</Callout>
      )}

      {!alert && (
        <fieldset className="flex flex-col gap-4 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-medium text-fg">מה לחפש</legend>
          {category === 'flight' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="מוצא (קוד שדה)" required error={err('origin')}>
                  <Input value={params.origin} onChange={(e) => setP('origin', e.target.value.toUpperCase())} maxLength={3} dir="ltr" className="text-start uppercase" placeholder="TLV" />
                </Field>
                <Field label="יעד (קוד שדה)" required error={err('destination')}>
                  <Input value={params.destination} onChange={(e) => setP('destination', e.target.value.toUpperCase())} maxLength={3} dir="ltr" className="text-start uppercase" placeholder="ATH" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                {dateInput('start', 'תאריך יציאה', 'start')}
                <Field label="תאריך חזרה" optional error={err('end')}>
                  <Input type="date" value={params.end} min={params.start || today} onChange={(e) => setP('end', e.target.value)} dir="ltr" className="text-start" />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="מבוגרים" error={err('adults')}>
                  <Input type="number" min={1} max={9} value={params.adults} onChange={(e) => setP('adults', e.target.value)} dir="ltr" className="text-start" />
                </Field>
                <Field label="מחלקה">
                  <NativeSelect value={params.cabin} onChange={(e) => setP('cabin', e.target.value)}>
                    {Object.entries(CABIN_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
            </>
          )}
          {(category === 'hotel' || category === 'activity') && (
            <>
              <Field label="יעד" required error={err('destination')}>
                <Input value={params.destination} onChange={(e) => setP('destination', e.target.value)} maxLength={100} placeholder="למשל: רומא" />
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                {dateInput('start', category === 'hotel' ? 'כניסה' : 'מתאריך', 'start')}
                {dateInput('end', category === 'hotel' ? 'יציאה' : 'עד תאריך', 'end', params.start || today)}
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="מבוגרים" error={err('adults')}>
                  <Input type="number" min={1} max={category === 'hotel' ? 6 : 9} value={params.adults} onChange={(e) => setP('adults', e.target.value)} dir="ltr" className="text-start" />
                </Field>
                {category === 'hotel' && (
                  <Field label="דירוג כוכבים מינימלי" optional>
                    <NativeSelect value={params.minStars} onChange={(e) => setP('minStars', e.target.value)}>
                      <option value="">לא משנה</option>
                      {[3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          {n}+ כוכבים
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                )}
              </div>
            </>
          )}
          {category === 'car' && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="מקום איסוף" required error={err('pickup')}>
                  <Input value={params.pickup} onChange={(e) => setP('pickup', e.target.value)} maxLength={100} placeholder="TLV או שם עיר" />
                </Field>
                <Field label="מקום החזרה" optional hint="ריק = כמו האיסוף">
                  <Input value={params.dropoff} onChange={(e) => setP('dropoff', e.target.value)} maxLength={100} />
                </Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="מועד איסוף" required error={err('pickupAt')}>
                  <Input type="datetime-local" value={params.pickupAt} min={`${today}T00:00`} onChange={(e) => setP('pickupAt', e.target.value)} dir="ltr" className="text-start" />
                </Field>
                <Field label="מועד החזרה" required error={err('dropoffAt')}>
                  <Input type="datetime-local" value={params.dropoffAt} min={params.pickupAt || `${today}T00:00`} onChange={(e) => setP('dropoffAt', e.target.value)} dir="ltr" className="text-start" />
                </Field>
              </div>
              <Field label="גיל הנהג" error={err('driverAge')} className="sm:max-w-40">
                <Input type="number" min={18} max={99} value={params.driverAge} onChange={(e) => setP('driverAge', e.target.value)} dir="ltr" className="text-start" />
              </Field>
            </>
          )}
          <Field label="מטבע" className="sm:max-w-40">
            <NativeSelect value={params.currency} onChange={(e) => setP('currency', e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </fieldset>
      )}

      <Field label="שם ההתראה" optional={!alert} hint={alert ? undefined : 'אם תשאירו ריק ניצור שם מהחיפוש.'} error={err('name')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} placeholder={alert ? undefined : defaultAlertName(category, params) || 'למשל: טיסה לאתונה'} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`מחיר יעד (${currency})`} optional hint="נודיע כשהמחיר הטוב ביותר שווה או נמוך מהיעד." error={err('target') ?? err('target_price')}>
          <Input inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} dir="ltr" className="text-start" placeholder="0.00" />
        </Field>
        <Field label="תדירות בדיקה" hint="מינימום 6 שעות." error={err('interval') ?? err('check_interval_minutes')}>
          <NativeSelect value={intervalChoice} onChange={(e) => setIntervalChoice(e.target.value)}>
            {INTERVAL_PRESETS.map((p) => (
              <option key={p.minutes} value={p.minutes}>
                {p.label}
              </option>
            ))}
            <option value="custom">מותאם אישית…</option>
          </NativeSelect>
        </Field>
      </div>
      {intervalChoice === 'custom' && (
        <Field label="דקות בין בדיקות" className="sm:max-w-48">
          <Input type="number" min={MIN_INTERVAL_MINUTES} value={customMinutes} onChange={(e) => setCustomMinutes(e.target.value)} dir="ltr" className="text-start" />
        </Field>
      )}

      {general && (
        <Callout tone="danger" role="alert">
          {general}
        </Callout>
      )}
      <div className="flex flex-wrap-reverse justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onClose}>
          ביטול
        </Button>
        <Button type="submit" loading={mutation.isPending}>
          {alert ? 'שמירה' : 'יצירת התראה'}
        </Button>
      </div>
    </form>
  );
}
