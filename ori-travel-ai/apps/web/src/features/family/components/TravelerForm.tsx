import { useState, type FormEvent } from 'react';
import { Button, Callout, Checkbox, Field, Input, NativeSelect, Textarea } from '@/components/ui';
import { useSaveTraveler } from '@/features/travelers/hooks';
import { serverFieldErrors, submitErrorMessage } from '@/features/trips/formUtils';
import { isApiError } from '@/lib/api';
import type { TravelerDetail } from '@/lib/schemas/family';
import { GENDER_LABELS, MEAL_LABELS, SEAT_LABELS } from '../labels';

interface FormState {
  first: string;
  last: string;
  dob: string;
  passport: string;
  clearPassport: boolean;
  expiry: string;
  nationality: string;
  gender: string;
  seat: string;
  meal: string;
  kosher: boolean;
  access: string;
  ff: string;
  clearFf: boolean;
  notes: string;
}

function initial(t?: TravelerDetail | null): FormState {
  return {
    first: t?.legal_first_name ?? '',
    last: t?.legal_last_name ?? '',
    dob: t?.date_of_birth ?? '',
    passport: '',
    clearPassport: false,
    expiry: t?.passport_expiry ?? '',
    nationality: t?.nationality ?? '',
    gender: t?.gender ?? '',
    seat: t?.seat_preference ?? '',
    meal: t?.meal_preference ?? '',
    kosher: t?.kosher_required ?? false,
    access: (t?.accessibility_needs ?? []).join(', '),
    ff: '',
    clearFf: false,
    notes: t?.notes ?? '',
  };
}

const PASSPORT_RE = /^[A-Za-z0-9]{5,20}$/;

export function validateTravelerForm(f: FormState, today = new Date().toISOString().slice(0, 10)): Record<string, string> {
  const e: Record<string, string> = {};
  if (!f.first.trim()) e.first = 'יש להזין שם פרטי כפי שמופיע בדרכון';
  if (!f.last.trim()) e.last = 'יש להזין שם משפחה כפי שמופיע בדרכון';
  if (!f.dob) e.dob = 'יש להזין תאריך לידה';
  else if (f.dob >= today) e.dob = 'תאריך הלידה חייב להיות בעבר';
  if (f.passport.trim() && !PASSPORT_RE.test(f.passport.trim().replace(/\s/g, ''))) e.passport = 'מספר דרכון: 5–20 אותיות לועזיות או ספרות';
  if (f.nationality.trim() && !/^[A-Za-z]{2}$/.test(f.nationality.trim())) e.nationality = 'קוד מדינה בן שתי אותיות (למשל IL)';
  if (f.access.split(',').filter((x) => x.trim()).length > 10) e.access = 'עד 10 צרכי נגישות';
  return e;
}

export interface TravelerFormProps {
  memberId: string;
  traveler?: TravelerDetail | null;
  onDone: () => void;
}

export function TravelerForm({ memberId, traveler, onDone }: TravelerFormProps) {
  const [f, setF] = useState<FormState>(() => initial(traveler));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useSaveTraveler(memberId);
  const serverErrors = serverFieldErrors(save.error);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((s) => ({ ...s, [k]: v }));
  const err = (k: string, serverKey = k) => errors[k] ?? serverErrors[serverKey];
  const mealKnown = !f.meal || f.meal in MEAL_LABELS;

  function submit(ev: FormEvent) {
    ev.preventDefault();
    const found = validateTravelerForm(f);
    setErrors(found);
    if (Object.keys(found).length) return;
    const body: Record<string, unknown> = {
      legal_first_name: f.first.trim(),
      legal_last_name: f.last.trim(),
      date_of_birth: f.dob,
      passport_expiry: f.expiry || null,
      nationality: f.nationality.trim().toUpperCase() || null,
      gender: f.gender || null,
      seat_preference: f.seat || null,
      meal_preference: f.meal || null,
      kosher_required: f.kosher,
      accessibility_needs: f.access.split(',').map((x) => x.trim()).filter(Boolean),
      notes: f.notes.trim() || null,
    };
    // Secrets are only sent when changed; omitted = keep the stored value, null = clear it.
    if (f.passport.trim()) body.passport_number = f.passport.trim().replace(/\s/g, '').toUpperCase();
    else if (f.clearPassport) body.passport_number = null;
    if (f.ff.trim()) body.frequent_flyer = f.ff.trim();
    else if (f.clearFf) body.frequent_flyer = null;
    save.mutate(body, { onSuccess: onDone });
  }

  const encryptionDown = isApiError(save.error) && save.error.status === 503;
  const general = encryptionDown
    ? 'לא ניתן לשמור: מפתח ההצפנה של השרת אינו מוגדר. בעל החשבון צריך להגדיר את ORI_DATA_KEY בהגדרות השרת ולהפעיל אותו מחדש.'
    : submitErrorMessage(save.error);

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4" data-testid="traveler-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="שם פרטי (כמו בדרכון)" required error={err('first', 'legal_first_name')}>
          <Input value={f.first} onChange={(e) => set('first', e.target.value)} maxLength={80} autoComplete="off" dir="ltr" className="text-start" />
        </Field>
        <Field label="שם משפחה (כמו בדרכון)" required error={err('last', 'legal_last_name')}>
          <Input value={f.last} onChange={(e) => set('last', e.target.value)} maxLength={80} autoComplete="off" dir="ltr" className="text-start" />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="תאריך לידה" required error={err('dob', 'date_of_birth')}>
          <Input type="date" value={f.dob} max={new Date().toISOString().slice(0, 10)} onChange={(e) => set('dob', e.target.value)} dir="ltr" className="text-start" />
        </Field>
        <Field label="מגדר" optional>
          <NativeSelect value={f.gender} onChange={(e) => set('gender', e.target.value)}>
            <option value="">לא צוין</option>
            {Object.entries(GENDER_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="מספר דרכון"
          optional
          error={err('passport', 'passport_number')}
          hint={traveler?.has_passport ? 'נשמר מספר דרכון. השאירו ריק כדי לא לשנות אותו.' : 'יישמר מוצפן. אפשר להוסיף גם מאוחר יותר.'}
        >
          <Input value={f.passport} onChange={(e) => set('passport', e.target.value.toUpperCase())} maxLength={24} autoComplete="off" dir="ltr" className="text-start" placeholder={traveler?.has_passport ? (traveler.passport_masked ?? '••••') : ''} />
        </Field>
        <Field label="תוקף הדרכון" optional error={err('expiry', 'passport_expiry')}>
          <Input type="date" value={f.expiry} onChange={(e) => set('expiry', e.target.value)} dir="ltr" className="text-start" />
        </Field>
      </div>
      {traveler?.has_passport && (
        <Checkbox label="הסרת מספר הדרכון השמור" checked={f.clearPassport} onChange={(e) => set('clearPassport', e.target.checked)} disabled={!!f.passport.trim()} />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="נתינות (קוד מדינה)" optional hint="למשל IL, US, FR" error={err('nationality')}>
          <Input value={f.nationality} onChange={(e) => set('nationality', e.target.value.toUpperCase())} maxLength={2} dir="ltr" className="text-start uppercase" />
        </Field>
        <Field label="העדפת מושב" optional>
          <NativeSelect value={f.seat} onChange={(e) => set('seat', e.target.value)}>
            <option value="">ללא העדפה</option>
            {Object.entries(SEAT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="העדפת ארוחה" optional>
          <NativeSelect value={f.meal} onChange={(e) => set('meal', e.target.value)}>
            <option value="">ללא העדפה</option>
            {!mealKnown && <option value={f.meal}>{f.meal}</option>}
            {Object.entries(MEAL_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field
          label="מספר חבר מועדון טיסה"
          optional
          error={err('ff', 'frequent_flyer')}
          hint={traveler?.has_frequent_flyer ? 'נשמר מספר. השאירו ריק כדי לא לשנות.' : undefined}
        >
          <Input value={f.ff} onChange={(e) => set('ff', e.target.value)} maxLength={40} autoComplete="off" dir="ltr" className="text-start" />
        </Field>
      </div>
      {traveler?.has_frequent_flyer && (
        <Checkbox label="הסרת מספר חבר המועדון השמור" checked={f.clearFf} onChange={(e) => set('clearFf', e.target.checked)} disabled={!!f.ff.trim()} />
      )}
      <Checkbox label="נדרש אוכל כשר" checked={f.kosher} onChange={(e) => set('kosher', e.target.checked)} />
      <Field label="צרכי נגישות" optional hint="מופרדים בפסיק, עד 10 (למשל: כיסא גלגלים, ליווי בנחיתה)" error={err('access', 'accessibility_needs')}>
        <Input value={f.access} onChange={(e) => set('access', e.target.value)} />
      </Field>
      <Field label="הערות" optional error={err('notes')} hint={`${f.notes.length}/500`}>
        <Textarea rows={3} maxLength={500} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
      </Field>
      {general && (
        <Callout tone={encryptionDown ? 'warn' : 'danger'} role="alert">
          {general}
        </Callout>
      )}
      <div className="flex flex-wrap-reverse justify-end gap-2 pt-1">
        <Button variant="secondary" onClick={onDone}>
          ביטול
        </Button>
        <Button type="submit" loading={save.isPending}>
          שמירת הפרופיל
        </Button>
      </div>
    </form>
  );
}
