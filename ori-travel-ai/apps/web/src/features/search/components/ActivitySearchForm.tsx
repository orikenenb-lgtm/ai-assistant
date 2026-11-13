import { Checkbox, Field, Input } from '@/components/ui';
import { INTEREST_LABELS } from '@/features/offers/labels';
import { DESTINATION_CITIES } from '../airports';
import { addDaysIso, errorFor, MAX_DAYS_AHEAD, MAX_TRAVELLERS, todayIso } from '../forms/common';
import { INTERESTS, defaultActivityState, validateActivity, type ActivityFormState } from '../forms/activity';
import { useSearchForm } from '../forms/useSearchForm';
import type { SearchFormProps } from './FlightSearchForm';
import { ChildAgesEditor, ChipToggleGroup, CurrencyPriceFields, SearchFormShell, SelectField, Stepper } from './formControls';

export function ActivitySearchForm({ initial, pending, serverErrors, onSubmit }: SearchFormProps<ActivityFormState>) {
  const { state: s, update, errors, submit } = useSearchForm(initial ?? defaultActivityState(), validateActivity, serverErrors, onSubmit);
  const today = todayIso();
  const maxDate = addDaysIso(today, MAX_DAYS_AHEAD);

  return (
    <SearchFormShell
      ariaLabel="חיפוש אטרקציות"
      errors={errors}
      pending={pending}
      onSubmit={submit}
      advancedInitiallyOpen={s.accessibilityRequired || s.language !== '' || s.maxPrice !== '' || s.currency !== 'ILS'}
      advanced={
        <>
          <SelectField
            label="שפת הפעילות"
            value={s.language}
            onChange={(language) => update({ language })}
            options={[
              { value: '', label: 'לא משנה' },
              { value: 'he', label: 'עברית' },
              { value: 'en', label: 'אנגלית' },
              { value: 'fr', label: 'צרפתית' },
              { value: 'es', label: 'ספרדית' },
            ]}
          />
          <CurrencyPriceFields
            currency={s.currency}
            maxPrice={s.maxPrice}
            onCurrency={(currency) => update({ currency })}
            onMaxPrice={(maxPrice) => update({ maxPrice })}
            errors={errors}
          />
          <div className="sm:col-span-2 lg:col-span-4">
            <Checkbox
              label="נדרשת נגישות"
              checked={s.accessibilityRequired}
              onChange={(e) => update({ accessibilityRequired: e.target.checked })}
            />
          </div>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <Field label="יעד (עיר)" required error={errors.destination}>
          <Input
            list="activity-destinations"
            autoComplete="off"
            placeholder="למשל: אתונה"
            value={s.destination}
            onChange={(e) => update({ destination: e.target.value })}
          />
        </Field>
        <datalist id="activity-destinations">
          {DESTINATION_CITIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <Field label="מתאריך" required error={errors.date_from}>
          <Input type="date" min={today} max={maxDate} value={s.dateFrom} onChange={(e) => update({ dateFrom: e.target.value })} />
        </Field>
        <Field label="עד תאריך" required error={errors.date_to} hint="עד 30 יום">
          <Input type="date" min={s.dateFrom || today} max={maxDate} value={s.dateTo} onChange={(e) => update({ dateTo: e.target.value })} />
        </Field>
      </div>
      <ChipToggleGroup
        legend="תחומי עניין (רשות)"
        options={INTERESTS.map((i) => ({ value: i, label: INTEREST_LABELS[i] }))}
        value={s.interests}
        onChange={(interests) => update({ interests })}
      />
      <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
        <Stepper label="מבוגרים" value={s.adults} min={1} max={MAX_TRAVELLERS} onChange={(adults) => update({ adults })} error={errors.adults} />
        <ChildAgesEditor
          ages={s.childrenAges}
          onChange={(childrenAges) => update({ childrenAges })}
          max={8}
          error={errorFor(errors, 'children_ages')}
        />
      </div>
    </SearchFormShell>
  );
}
