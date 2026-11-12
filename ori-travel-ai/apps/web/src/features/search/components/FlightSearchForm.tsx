import { ArrowLeftRight } from 'lucide-react';
import { Field, IconButton, Input } from '@/components/ui';
import { WINDOW_LABELS, CABIN_LABELS } from '@/features/offers/labels';
import { addDaysIso, errorFor, MAX_DAYS_AHEAD, MAX_TRAVELLERS, todayIso, type FieldErrors } from '../forms/common';
import { defaultFlightState, validateFlight, type FlightFormState } from '../forms/flight';
import { useSearchForm } from '../forms/useSearchForm';
import { ChildAgesEditor, CurrencyPriceFields, PlaceCombobox, SearchFormShell, SegmentedChoice, SelectField, Stepper } from './formControls';

const opts = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export interface SearchFormProps<S> {
  initial?: S;
  pending: boolean;
  serverErrors: FieldErrors;
  onSubmit: (body: Record<string, unknown>) => void;
}

export function FlightSearchForm({ initial, pending, serverErrors, onSubmit }: SearchFormProps<FlightFormState>) {
  const { state: s, update, errors, submit } = useSearchForm(initial ?? defaultFlightState(), validateFlight, serverErrors, onSubmit);
  const today = todayIso();
  const maxDate = addDaysIso(today, MAX_DAYS_AHEAD);
  const round = s.tripType === 'round';
  const infants = s.childrenAges.filter((a) => a < 2).length;

  return (
    <SearchFormShell
      ariaLabel="חיפוש טיסות"
      errors={errors}
      pending={pending}
      onSubmit={submit}
      advancedInitiallyOpen={s.cabin !== 'economy' || s.maxStops !== '' || s.checkedBags > 0 || s.window !== 'any' || s.maxPrice !== '' || s.currency !== 'ILS'}
      advanced={
        <>
          <SelectField label="מחלקה" value={s.cabin} onChange={(cabin) => update({ cabin })} options={opts(CABIN_LABELS)} />
          <SelectField
            label="עצירות מקסימליות"
            value={s.maxStops}
            onChange={(maxStops) => update({ maxStops })}
            options={[
              { value: '', label: 'לא משנה' },
              { value: '0', label: 'ישירות בלבד' },
              { value: '1', label: 'עד עצירה אחת' },
              { value: '2', label: 'עד 2 עצירות' },
            ]}
          />
          <SelectField label="חלון שעות המראה" value={s.window} onChange={(window) => update({ window })} options={opts(WINDOW_LABELS)} />
          <Stepper label="מזוודות לבטן (לנוסע)" value={s.checkedBags} min={0} max={3} onChange={(checkedBags) => update({ checkedBags })} />
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
      <SegmentedChoice
        legend="סוג הטיסה"
        value={s.tripType}
        onChange={(tripType) => update({ tripType })}
        options={[
          { value: 'round', label: 'הלוך-חזור' },
          { value: 'oneway', label: 'כיוון אחד' },
        ]}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_auto_1fr_1fr_1fr]">
        <PlaceCombobox label="מוצא" required value={s.origin} onChange={(origin) => update({ origin })} error={errors.origin} placeholder="TLV" />
        <div className="hidden items-start pt-7 lg:flex">
          <IconButton
            label="החלפת מוצא ויעד"
            icon={<ArrowLeftRight />}
            variant="secondary"
            onClick={() => update({ origin: s.destination, destination: s.origin })}
          />
        </div>
        <PlaceCombobox label="יעד" required value={s.destination} onChange={(destination) => update({ destination })} error={errors.destination} placeholder="ATH" />
        <Field label="תאריך יציאה" required error={errors.depart_date}>
          <Input type="date" min={today} max={maxDate} value={s.departDate} onChange={(e) => update({ departDate: e.target.value })} />
        </Field>
        <Field label="תאריך חזרה" required={round} error={errors.return_date} hint={round ? undefined : 'כיוון אחד — אין חזרה'}>
          <Input
            type="date"
            min={s.departDate || today}
            max={maxDate}
            disabled={!round}
            value={round ? s.returnDate : ''}
            onChange={(e) => update({ returnDate: e.target.value })}
          />
        </Field>
      </div>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-[auto_auto_1fr]">
        <Stepper
          label="מבוגרים"
          value={s.adults}
          min={1}
          max={MAX_TRAVELLERS}
          onChange={(adults) => update({ adults })}
          error={errors.adults}
          hint={`עד ${MAX_TRAVELLERS} נוסעים בסך הכול`}
        />
        <Stepper
          label="גמישות בתאריכים (±ימים)"
          value={s.flexDays}
          min={0}
          max={3}
          onChange={(flexDays) => update({ flexDays })}
          error={errors.flex_days}
          hint={s.flexDays ? `נבדקים תאריכים עד ${s.flexDays} ימים לפני ואחרי` : 'תאריכים מדויקים'}
        />
        <ChildAgesEditor
          ages={s.childrenAges}
          onChange={(childrenAges) => update({ childrenAges })}
          max={Math.min(8, MAX_TRAVELLERS - s.adults)}
          error={errorFor(errors, 'children_ages')}
          className="sm:col-span-2 lg:col-span-1"
        />
      </div>
      {infants > s.adults && <span className="sr-only">מספר התינוקות גדול ממספר המבוגרים</span>}
    </SearchFormShell>
  );
}
