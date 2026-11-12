import { ArrowLeftRight, ChevronDown, Search } from 'lucide-react';
import { useId, useState } from 'react';
import { Button, Callout, Field, IconButton, Input } from '@/components/ui';
import { CABIN_LABELS, WINDOW_LABELS } from '@/features/offers/labels';
import { cn } from '@/lib/cn';
import { useFlightPlaces } from '../airportsApi';
import { addDaysIso, CURRENCIES, errorFor, MAX_DAYS_AHEAD, MAX_TRAVELLERS, todayIso, type FieldErrors } from '../forms/common';
import { defaultFlightState, validateFlight, type FlightFormState } from '../forms/flight';
import { useSearchForm } from '../forms/useSearchForm';
import { COMPACT_LABEL, InlineSelect, PlaceCombobox, SegmentedChoice, TravelersPicker } from './formControls';

const opts = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

const FLEX_OPTIONS = [
  { value: '0', label: 'תאריכים מדויקים' },
  { value: '1', label: '±1 יום' },
  { value: '2', label: '±2 ימים' },
  { value: '3', label: '±3 ימים' },
];

const BAG_OPTIONS = [
  { value: '0', label: 'ללא' },
  { value: '1', label: '1 לנוסע' },
  { value: '2', label: '2 לנוסע' },
  { value: '3', label: '3 לנוסע' },
];

const STOPS_OPTIONS = [
  { value: '', label: 'לא משנה' },
  { value: '0', label: 'ישירות בלבד' },
  { value: '1', label: 'עד עצירה אחת' },
  { value: '2', label: 'עד 2 עצירות' },
];

export interface SearchFormProps<S> {
  initial?: S;
  pending: boolean;
  serverErrors: FieldErrors;
  onSubmit: (body: Record<string, unknown>) => void;
}

/**
 * Compact, light flight search header: one row on wide screens (route · dates · travellers · search) with a thin
 * toolbar above it (trip type, flexibility, cabin, bags, budget, more options); stacked on mobile.
 * Validation is the same Zod schema as before (mirrors the backend).
 */
export function FlightSearchForm({ initial, pending, serverErrors, onSubmit }: SearchFormProps<FlightFormState>) {
  const { state: s, update, errors, submit } = useSearchForm(initial ?? defaultFlightState(), validateFlight, serverErrors, onSubmit);
  const places = useFlightPlaces();
  const today = todayIso();
  const maxDate = addDaysIso(today, MAX_DAYS_AHEAD);
  const round = s.tripType === 'round';
  const [moreOpen, setMoreOpen] = useState(s.maxStops !== '' || s.window !== 'any' || s.currency !== 'ILS');
  const moreId = useId();
  const formError = errors[''];
  const unplaced = Object.keys(errors).filter((k) => k !== '').length;
  const travellersError = errorFor(errors, 'children_ages') ?? errors.adults;

  return (
    <form
      noValidate
      aria-label="חיפוש טיסות"
      className="flex flex-col gap-4"
      data-testid="flight-search-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {formError && (
        <Callout tone="danger" role="alert" title="לא ניתן לבצע את החיפוש">
          {formError}
        </Callout>
      )}
      {!formError && unplaced > 0 && (
        <p className="text-sm font-medium text-coral-700" role="alert">
          יש לתקן {unplaced === 1 ? 'שדה אחד' : `${unplaced} שדות`} לפני החיפוש.
        </p>
      )}

      {/* Toolbar: trip type + the options that change the fare most */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5">
        <SegmentedChoice
          legend="סוג הטיסה"
          value={s.tripType}
          onChange={(tripType) => update({ tripType })}
          options={[
            { value: 'round', label: 'הלוך-חזור' },
            { value: 'oneway', label: 'כיוון אחד' },
          ]}
        />
        <InlineSelect label="גמישות" value={String(s.flexDays)} onChange={(v) => update({ flexDays: Number(v) })} options={FLEX_OPTIONS} />
        <InlineSelect label="מחלקה" value={s.cabin} onChange={(cabin) => update({ cabin })} options={opts(CABIN_LABELS)} />
        <InlineSelect label="מזוודות לבטן" value={String(s.checkedBags)} onChange={(v) => update({ checkedBags: Number(v) })} options={BAG_OPTIONS} />
        <BudgetInput value={s.maxPrice} currency={s.currency} error={errors.max_price} onChange={(maxPrice) => update({ maxPrice })} />
        <button
          type="button"
          className="inline-flex h-10 items-center gap-1 rounded-md px-1 text-sm font-medium text-accent hover:text-accent-hover"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          onClick={() => setMoreOpen((v) => !v)}
        >
          אפשרויות נוספות
          <ChevronDown className={cn('size-4 transition-transform', moreOpen && 'rotate-180')} aria-hidden="true" />
        </button>
      </div>
      <div id={moreId} hidden={!moreOpen} className="flex flex-wrap items-center gap-x-4 gap-y-2.5 rounded-lg bg-surface-sunken px-3 py-2.5">
        <InlineSelect label="עצירות" value={s.maxStops} onChange={(maxStops) => update({ maxStops })} options={STOPS_OPTIONS} />
        <InlineSelect label="שעות המראה" value={s.window} onChange={(window) => update({ window })} options={opts(WINDOW_LABELS)} />
        <InlineSelect label="מטבע" value={s.currency} onChange={(currency) => update({ currency })} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        {errors.currency && <p className="text-sm text-coral-700">{errors.currency}</p>}
      </div>

      {/* Main row */}
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] xl:flex-[1.15]">
          <PlaceCombobox
            label="מוצא"
            required
            density="compact"
            places={places}
            value={s.origin}
            onChange={(origin) => update({ origin })}
            error={errors.origin}
            placeholder="TLV"
          />
          <div className="hidden pt-[1.375rem] md:block">
            <IconButton
              label="החלפת מוצא ויעד"
              icon={<ArrowLeftRight />}
              variant="secondary"
              onClick={() => update({ origin: s.destination, destination: s.origin })}
            />
          </div>
          <PlaceCombobox
            label="יעד"
            required
            density="compact"
            places={places}
            value={s.destination}
            onChange={(destination) => update({ destination })}
            error={errors.destination}
            placeholder="FCO"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.1fr)_auto] xl:flex-[1.6]">
          <Field label="תאריך יציאה" required error={errors.depart_date} labelClassName={COMPACT_LABEL}>
            <Input type="date" min={today} max={maxDate} value={s.departDate} onChange={(e) => update({ departDate: e.target.value })} />
          </Field>
          <Field
            label="תאריך חזרה"
            required={round}
            error={errors.return_date}
            hint={round ? undefined : 'כיוון אחד'}
            labelClassName={COMPACT_LABEL}
          >
            <Input
              type="date"
              min={s.departDate || today}
              max={maxDate}
              disabled={!round}
              value={round ? s.returnDate : ''}
              onChange={(e) => update({ returnDate: e.target.value })}
            />
          </Field>
          <TravelersPicker
            adults={s.adults}
            childrenAges={s.childrenAges}
            onAdults={(adults) => update({ adults })}
            onChildrenAges={(childrenAges) => update({ childrenAges })}
            maxTravellers={MAX_TRAVELLERS}
            error={travellersError}
          />
          <div className="flex flex-col gap-1.5">
            <span aria-hidden="true" className={cn(COMPACT_LABEL, 'invisible hidden md:block')}>
              ·
            </span>
            <Button type="submit" loading={pending} loadingText="מחפשים…" leadingIcon={<Search aria-hidden="true" />} className="w-full px-6 md:w-auto">
              חיפוש
            </Button>
          </div>
        </div>
      </div>
      <p className="text-xs text-fg-subtle">החיפוש נשלח לכל הספקים הפעילים; ספקים שאינם מחוברים יסומנו בתוצאות. לאחר החיפוש יוצג לוח מחירים לפי תאריכים.</p>
    </form>
  );
}

function BudgetInput({ value, currency, error, onChange }: { value: string; currency: string; error?: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="shrink-0 text-xs font-medium text-fg-muted">
          תקציב מקסימלי
        </label>
        <div className="relative" dir="ltr">
          <Input
            id={id}
            inputMode="decimal"
            className="w-32 pe-12 text-start"
            placeholder="ללא הגבלה"
            value={value}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${id}-hint${error ? ` ${id}-err` : ''}`}
            onChange={(e) => onChange(e.target.value)}
          />
          <span id={`${id}-hint`} className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-fg-subtle" dir="ltr">
            <span className="sr-only">סה״כ ב-</span>
            {currency}
          </span>
        </div>
      </div>
      {error && (
        <p id={`${id}-err`} className="text-sm text-coral-700">
          {error}
        </p>
      )}
    </div>
  );
}
