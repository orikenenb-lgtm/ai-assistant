import { Info } from 'lucide-react';
import { Checkbox, Field, Input } from '@/components/ui';
import { CAR_CLASS_LABELS, TRANSMISSION_LABELS } from '@/features/offers/labels';
import { YOUNG_DRIVER_AGE, defaultCarState, validateCar, type CarFormState } from '../forms/car';
import { useSearchForm } from '../forms/useSearchForm';
import type { SearchFormProps } from './FlightSearchForm';
import { CurrencyPriceFields, PlaceCombobox, SearchFormShell, SelectField, Stepper } from './formControls';

const opts = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export function CarSearchForm({ initial, pending, serverErrors, onSubmit }: SearchFormProps<CarFormState>) {
  const { state: s, update, errors, submit } = useSearchForm(initial ?? defaultCarState(), validateCar, serverErrors, onSubmit);
  const age = Number(s.driverAge);
  const young = s.driverAge.trim() !== '' && Number.isFinite(age) && age >= 18 && age < YOUNG_DRIVER_AGE;

  return (
    <SearchFormShell
      ariaLabel="חיפוש רכבים"
      errors={errors}
      pending={pending}
      onSubmit={submit}
      advancedInitiallyOpen={s.carClass !== 'any' || s.transmission !== 'any' || s.minSeats > 2 || s.maxPrice !== '' || s.currency !== 'ILS'}
      advanced={
        <>
          <SelectField label="סוג רכב" value={s.carClass} onChange={(carClass) => update({ carClass })} options={opts(CAR_CLASS_LABELS)} />
          <SelectField label="תיבת הילוכים" value={s.transmission} onChange={(transmission) => update({ transmission })} options={opts(TRANSMISSION_LABELS)} />
          <Stepper label="מספר מקומות מינימלי" value={s.minSeats} min={2} max={9} onChange={(minSeats) => update({ minSeats })} error={errors.min_seats} />
          <CurrencyPriceFields
            currency={s.currency}
            maxPrice={s.maxPrice}
            onCurrency={(currency) => update({ currency })}
            onMaxPrice={(maxPrice) => update({ maxPrice })}
            errors={errors}
          />
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <PlaceCombobox
          label="מקום איסוף"
          required
          mode="free"
          value={s.pickupLocation}
          onChange={(pickupLocation) => update({ pickupLocation })}
          error={errors.pickup_location}
          placeholder="ATH או שם עיר"
          hint="קוד שדה תעופה או עיר"
        />
        {s.dropoffSame ? (
          <div className="flex items-end pb-1">
            <Checkbox label="החזרה באותו מקום" checked onChange={() => update({ dropoffSame: false })} />
          </div>
        ) : (
          <PlaceCombobox
            label="מקום החזרה"
            required
            mode="free"
            value={s.dropoffLocation}
            onChange={(dropoffLocation) => update({ dropoffLocation })}
            error={errors.dropoff_location}
            placeholder="קוד או עיר"
          />
        )}
        <Field label="איסוף (תאריך ושעה מקומיים)" required error={errors.pickup_at}>
          <Input type="datetime-local" step={900} value={s.pickupAt} onChange={(e) => update({ pickupAt: e.target.value })} />
        </Field>
        <Field label="החזרה (תאריך ושעה מקומיים)" required error={errors.dropoff_at}>
          <Input type="datetime-local" step={900} min={s.pickupAt} value={s.dropoffAt} onChange={(e) => update({ dropoffAt: e.target.value })} />
        </Field>
      </div>
      {!s.dropoffSame && (
        <div>
          <Checkbox label="החזרה באותו מקום" checked={false} onChange={() => update({ dropoffSame: true })} />
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="גיל הנהג" required error={errors.driver_age}>
          <Input type="number" inputMode="numeric" min={18} max={99} value={s.driverAge} onChange={(e) => update({ driverAge: e.target.value })} />
        </Field>
        {young && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm leading-relaxed text-amber-700 sm:col-span-2" role="note">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            נהגים מתחת לגיל {YOUNG_DRIVER_AGE} עשויים לשלם תוספת נהג צעיר, ולעיתים אין זכאות לחלק מהרכבים. הסכום המדויק נקבע אצל הספק.
          </div>
        )}
      </div>
    </SearchFormShell>
  );
}
