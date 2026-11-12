import { Plus, Trash2 } from 'lucide-react';
import { Button, Checkbox, Field, IconButton, Input } from '@/components/ui';
import { DESTINATION_CITIES } from '../airports';
import { BOARD_LABELS } from '@/features/offers/labels';
import { addDaysIso, diffDays, errorFor, MAX_DAYS_AHEAD, todayIso } from '../forms/common';
import { MAX_CHILDREN_PER_ROOM, MAX_NIGHTS, MAX_ROOMS, defaultHotelState, validateHotel, type HotelFormState } from '../forms/hotel';
import { useSearchForm } from '../forms/useSearchForm';
import type { SearchFormProps } from './FlightSearchForm';
import { ChildAgesEditor, CurrencyPriceFields, SearchFormShell, SelectField, Stepper } from './formControls';

export function HotelSearchForm({ initial, pending, serverErrors, onSubmit }: SearchFormProps<HotelFormState>) {
  const { state: s, update, errors, submit } = useSearchForm(initial ?? defaultHotelState(), validateHotel, serverErrors, onSubmit);
  const today = todayIso();
  const maxDate = addDaysIso(today, MAX_DAYS_AHEAD);
  const nights = s.checkIn && s.checkOut ? diffDays(s.checkIn, s.checkOut) : 0;

  const setRoom = (i: number, patch: Partial<HotelFormState['rooms'][number]>) =>
    update({ rooms: s.rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <SearchFormShell
      ariaLabel="חיפוש מלונות"
      errors={errors}
      pending={pending}
      onSubmit={submit}
      advancedInitiallyOpen={s.minStars !== '' || s.board !== 'any' || s.freeCancellationOnly || s.kosherPreference || s.accessibilityRequired || s.maxPrice !== '' || s.currency !== 'ILS'}
      advanced={
        <>
          <SelectField
            label="דירוג כוכבים מינימלי"
            value={s.minStars}
            onChange={(minStars) => update({ minStars })}
            options={[
              { value: '', label: 'לא משנה' },
              ...[2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n}+ כוכבים` })),
            ]}
          />
          <SelectField
            label="ארוחות"
            value={s.board}
            onChange={(board) => update({ board })}
            options={(['any', 'breakfast', 'half_board', 'all_inclusive'] as const).map((b) => ({ value: b, label: BOARD_LABELS[b] }))}
          />
          <CurrencyPriceFields
            currency={s.currency}
            maxPrice={s.maxPrice}
            onCurrency={(currency) => update({ currency })}
            onMaxPrice={(maxPrice) => update({ maxPrice })}
            errors={errors}
          />
          <div className="flex flex-col gap-3 sm:col-span-2 lg:col-span-4">
            <Checkbox
              label="ביטול חינם בלבד"
              checked={s.freeCancellationOnly}
              onChange={(e) => update({ freeCancellationOnly: e.target.checked })}
            />
            <Checkbox
              label="העדפת כשרות"
              description="מציג מידע על כשרות רק כשהספק מסר אותו. אין אימות כשרות מצדנו — יש לבדוק מול המלון."
              checked={s.kosherPreference}
              onChange={(e) => update({ kosherPreference: e.target.checked })}
            />
            <Checkbox
              label="נדרשת נגישות"
              checked={s.accessibilityRequired}
              onChange={(e) => update({ accessibilityRequired: e.target.checked })}
            />
          </div>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto]">
        <Field label="יעד (עיר)" required error={errors.destination}>
          <Input
            list="hotel-destinations"
            autoComplete="off"
            placeholder="למשל: אתונה"
            value={s.destination}
            onChange={(e) => update({ destination: e.target.value })}
          />
        </Field>
        <datalist id="hotel-destinations">
          {DESTINATION_CITIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field label="כניסה" required error={errors.check_in}>
          <Input type="date" min={today} max={maxDate} value={s.checkIn} onChange={(e) => update({ checkIn: e.target.value })} />
        </Field>
        <Field
          label="יציאה"
          required
          error={errors.check_out}
          hint={nights > 0 && nights <= MAX_NIGHTS ? `${nights} לילות` : `עד ${MAX_NIGHTS} לילות`}
        >
          <Input type="date" min={s.checkIn || today} max={maxDate} value={s.checkOut} onChange={(e) => update({ checkOut: e.target.value })} />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium text-fg">חדרים ואורחים</legend>
        <ul className="grid gap-3 lg:grid-cols-2">
          {s.rooms.map((room, i) => {
            const roomError = errors[`rooms.${i}`] ?? errors.rooms;
            return (
              <li key={i} className="flex flex-col gap-3 rounded-xl border border-line bg-surface-sunken p-4">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-fg">חדר {i + 1}</h3>
                  {s.rooms.length > 1 && (
                    <IconButton
                      label={`הסרת חדר ${i + 1}`}
                      icon={<Trash2 />}
                      size="sm"
                      onClick={() => update({ rooms: s.rooms.filter((_, j) => j !== i) })}
                    />
                  )}
                </div>
                <Stepper
                  label={`מבוגרים בחדר ${i + 1}`}
                  value={room.adults}
                  min={1}
                  max={6}
                  onChange={(adults) => setRoom(i, { adults })}
                  error={errors[`rooms.${i}.adults`]}
                />
                <ChildAgesEditor
                  ages={room.childrenAges}
                  max={MAX_CHILDREN_PER_ROOM}
                  onChange={(childrenAges) => setRoom(i, { childrenAges })}
                  error={errorFor(errors, `rooms.${i}.children_ages`)}
                />
                {roomError && <p className="text-sm text-coral-700">{roomError}</p>}
              </li>
            );
          })}
        </ul>
        <div>
          <Button
            variant="secondary"
            size="sm"
            leadingIcon={<Plus aria-hidden="true" />}
            disabled={s.rooms.length >= MAX_ROOMS}
            onClick={() => update({ rooms: [...s.rooms, { adults: 2, childrenAges: [] }] })}
          >
            הוספת חדר
          </Button>
          <span className="ms-3 text-xs text-fg-subtle">עד {MAX_ROOMS} חדרים</span>
        </div>
      </fieldset>
    </SearchFormShell>
  );
}
