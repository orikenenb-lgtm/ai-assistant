import { ChevronDown, Minus, Plus, Search, X } from 'lucide-react';
import { useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Callout, Field, Input, NativeSelect, buttonClasses, controlClasses } from '@/components/ui';
import { cn } from '@/lib/cn';
import { PLACES, findPlace, searchPlaces, type Place } from '../airports';
import { CURRENCIES, errorFor, type FieldErrors } from '../forms/common';

// ---------------------------------------------------------------- Stepper --

export interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}

/** − / + number control (mobile friendly). Announces the new value politely. */
export function Stepper({ label, value, min, max, onChange, hint, error, className }: StepperProps) {
  const id = useId();
  const btn = cn(buttonClasses({ variant: 'secondary', size: 'md' }), 'size-10 px-0');
  return (
    <div className={cn('flex flex-col gap-1.5', className)} role="group" aria-labelledby={`${id}-l`}>
      <span id={`${id}-l`} className="text-sm font-medium text-fg">
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <button type="button" className={btn} aria-label={`הפחתה: ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
          <Minus aria-hidden="true" />
        </button>
        <output
          aria-live="polite"
          aria-label={`${label}: ${value}`}
          className="grid h-10 min-w-12 place-items-center rounded-md border border-line bg-surface px-3 text-sm font-semibold tabular-nums"
        >
          {value}
        </output>
        <button type="button" className={btn} aria-label={`הוספה: ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
          <Plus aria-hidden="true" />
        </button>
      </div>
      {error && (
        <p className="text-sm text-coral-700" role="alert">
          {error}
        </p>
      )}
      {hint && <p className="text-xs text-fg-subtle">{hint}</p>}
    </div>
  );
}

// -------------------------------------------------------- Child ages editor --

const AGE_OPTIONS = Array.from({ length: 18 }, (_, i) => ({
  value: String(i),
  label: i === 0 ? 'מתחת לגיל שנה' : i === 1 ? 'שנה' : String(i),
}));

export interface ChildAgesEditorProps {
  ages: number[];
  onChange: (ages: number[]) => void;
  max: number;
  error?: ReactNode;
  className?: string;
}

export function ChildAgesEditor({ ages, onChange, max, error, className }: ChildAgesEditorProps) {
  const hasInfant = ages.some((a) => a < 2);
  // Unique per editor instance: a hotel search renders one editor per room (BUG-E2E-02).
  const idBase = useId();
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <span className="text-sm font-medium text-fg">ילדים (לפי גיל)</span>
      {ages.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {ages.map((age, i) => (
            <li key={i} className="flex items-center gap-1 rounded-lg border border-line bg-surface-sunken p-1.5 ps-2.5">
              <label htmlFor={`${idBase}-child-age-${i}`} className="text-xs text-fg-muted">
                ילד/ה {i + 1}
              </label>
              <NativeSelect
                id={`${idBase}-child-age-${i}`}
                aria-label={`גיל ילד ${i + 1}`}
                className="h-8 w-32 text-sm"
                value={String(age)}
                options={AGE_OPTIONS}
                onChange={(e) => onChange(ages.map((a, j) => (j === i ? Number(e.target.value) : a)))}
              />
              <button
                type="button"
                className="grid size-8 place-items-center rounded-md text-fg-subtle hover:bg-ink-100 hover:text-fg"
                aria-label={`הסרת ילד ${i + 1}`}
                onClick={() => onChange(ages.filter((_, j) => j !== i))}
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Plus aria-hidden="true" />}
          disabled={ages.length >= max}
          onClick={() => onChange([...ages, 8])}
        >
          הוספת ילד
        </Button>
      </div>
      {hasInfant && <p className="text-xs text-fg-subtle">תינוק מתחת לגיל 2 צריך מבוגר מלווה — לכל תינוק מבוגר אחד לפחות.</p>}
      {error && (
        <p className="text-sm text-coral-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------- Airport combobox --

/** Small muted field label used by the compact flight search header. */
export const COMPACT_LABEL = 'text-xs font-medium text-fg-muted';

export interface PlaceComboboxProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** "iata": expects a 3-letter code (typing a name offers matches). "free": any place text (city, airport code). */
  mode?: 'iata' | 'free';
  error?: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  placeholder?: string;
  className?: string;
  inputName?: string;
  /** Suggestion list (default: the bundled client list). Flights pass the `/api/geo/airports` dataset. */
  places?: readonly Place[];
  /** Visual density: "compact" uses a small muted label (search header). */
  density?: 'default' | 'compact';
}

/** Accessible combobox (ARIA 1.2 listbox pattern) over an airport list; free text still allowed. */
export function PlaceCombobox({
  label,
  value,
  onChange,
  mode = 'iata',
  error,
  hint,
  required,
  placeholder,
  className,
  inputName,
  places = PLACES,
  density = 'default',
}: PlaceComboboxProps) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const wrapRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => searchPlaces(value, 8, places), [value, places]);
  const resolved = findPlace(value, places);
  const showList = open && options.length > 0;

  function select(code: string) {
    onChange(code);
    setOpen(false);
    setActive(-1);
  }

  return (
    <Field
      label={label}
      required={required}
      error={error}
      hint={
        hint ??
        (resolved ? (
          <span
            className={density === 'compact' ? 'block truncate' : undefined}
            title={density === 'compact' ? `${resolved.city} · ${resolved.name}` : undefined}
          >
            {resolved.city} · {resolved.name}
          </span>
        ) : mode === 'iata' ? (
          'קוד IATA בן 3 אותיות, או שם עיר לחיפוש'
        ) : undefined)
      }
      className={className}
      labelClassName={density === 'compact' ? COMPACT_LABEL : undefined}
    >
      <div
        className="relative"
        ref={wrapRef}
        onBlur={(e) => {
          if (!wrapRef.current?.contains(e.relatedTarget as Node | null)) {
            setOpen(false);
            setActive(-1);
          }
        }}
      >
        <Input
          name={inputName}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder={placeholder}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(options.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === 'Enter' && showList && active >= 0) {
              e.preventDefault();
              select(options[active].code);
            } else if (e.key === 'Escape' && showList) {
              e.preventDefault();
              e.stopPropagation();
              setOpen(false);
            }
          }}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label={`הצעות עבור ${label}`}
            className="scrollbar-thin absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-line-strong bg-surface py-1 shadow-md"
          >
            {options.map((p, i) => (
              <li
                key={p.code}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={cn('flex cursor-pointer items-baseline gap-2 px-3 py-2 text-sm', i === active ? 'bg-sea-50' : 'hover:bg-sand-50')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => select(p.code)}
              >
                <span dir="ltr" className="w-9 shrink-0 font-mono text-xs font-semibold text-sea-700">
                  {p.code}
                </span>
                <span className="min-w-0 truncate">
                  <span className="font-medium text-fg">{p.city}</span>
                  <span className="text-fg-muted"> · {p.name}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Field>
  );
}

// -------------------------------------------------------- Travelers picker --

export interface TravelersPickerProps {
  adults: number;
  childrenAges: number[];
  onAdults: (n: number) => void;
  onChildrenAges: (ages: number[]) => void;
  maxTravellers: number;
  error?: ReactNode;
  className?: string;
}

export function travellersSummary(adults: number, children: number): string {
  const a = adults === 1 ? 'מבוגר אחד' : `${adults} מבוגרים`;
  if (!children) return a;
  return `${a} + ${children === 1 ? 'ילד' : `${children} ילדים`}`;
}

/**
 * Compact "who is travelling" control: a disclosure button showing the summary, opening a small panel with the adults
 * stepper and per-child ages. Escape / outside click closes it and returns focus to the button.
 */
export function TravelersPicker({ adults, childrenAges, onAdults, onChildrenAges, maxTravellers, error, className }: TravelersPickerProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };
  return (
    <div
      ref={wrapRef}
      className={cn('relative flex flex-col gap-1.5', className)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          close(true);
        }
      }}
      onBlur={(e) => {
        if (open && !wrapRef.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <span id={`${id}-label`} className={COMPACT_LABEL}>
        נוסעים
      </span>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        onClick={() => setOpen((v) => !v)}
        className={cn(controlClasses, 'flex h-10 items-center justify-between gap-2 px-3 text-start')}
      >
        <span id={`${id}-value`} className="truncate">
          {travellersSummary(adults, childrenAges.length)}
        </span>
        <ChevronDown className={cn('size-4 shrink-0 text-fg-subtle transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>
      {error && (
        <p id={`${id}-error`} className="text-sm text-coral-700" role="alert">
          {error}
        </p>
      )}
      <div
        id={`${id}-panel`}
        role="group"
        aria-label="בחירת נוסעים"
        hidden={!open}
        className="absolute inset-x-0 top-full z-30 mt-1.5 flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 shadow-lg md:inset-x-auto md:end-0 md:w-80"
      >
        <Stepper label="מבוגרים" value={adults} min={1} max={maxTravellers} onChange={onAdults} hint={`עד ${maxTravellers} נוסעים בסך הכול`} />
        <ChildAgesEditor ages={childrenAges} onChange={onChildrenAges} max={Math.min(8, maxTravellers - adults)} />
        <div className="flex justify-end border-t border-line pt-3">
          <Button size="sm" variant="secondary" onClick={() => close(true)}>
            סיום
          </Button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------ inline select --

export interface InlineSelectProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  className?: string;
}

/** Label + small select on one line (search header toolbar). */
export function InlineSelect({ label, value, onChange, options, className }: InlineSelectProps) {
  const id = useId();
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <label htmlFor={id} className="shrink-0 text-xs font-medium text-fg-muted">
        {label}
      </label>
      <div className="min-w-0 flex-1 sm:flex-none">
        <NativeSelect id={id} value={value} options={options} onChange={(e) => onChange(e.target.value)} className="min-w-20" />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ small fields --

export interface SelectFieldProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  error?: ReactNode;
  hint?: ReactNode;
  className?: string;
}

export function SelectField({ label, value, onChange, options, error, hint, className }: SelectFieldProps) {
  return (
    <Field label={label} error={error} hint={hint} className={className}>
      <NativeSelect value={value} options={options} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function CurrencyPriceFields({
  currency,
  maxPrice,
  onCurrency,
  onMaxPrice,
  errors,
}: {
  currency: string;
  maxPrice: string;
  onCurrency: (v: string) => void;
  onMaxPrice: (v: string) => void;
  errors: FieldErrors;
}) {
  return (
    <>
      <SelectField
        label="מטבע"
        value={currency}
        onChange={onCurrency}
        options={CURRENCIES.map((c) => ({ value: c, label: c }))}
        error={errors.currency}
      />
      <Field label="מחיר מקסימלי" optional error={errors.max_price} hint={`סה״כ ב-${currency}`}>
        <Input
          inputMode="decimal"
          dir="ltr"
          className="text-start"
          placeholder="ללא הגבלה"
          value={maxPrice}
          onChange={(e) => onMaxPrice(e.target.value)}
        />
      </Field>
    </>
  );
}

export function ChipToggleGroup({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: Array<{ value: string; label: string }>;
  value: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-fg">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
              className={cn(
                'h-9 rounded-full border px-3.5 text-sm font-medium transition-colors',
                on ? 'border-sea-600 bg-sea-600 text-white' : 'border-line-strong bg-surface text-fg-muted hover:bg-sand-50',
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function SegmentedChoice<T extends string>({
  legend,
  value,
  options,
  onChange,
}: {
  legend: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">{legend}</legend>
      <div className="inline-flex rounded-lg border border-line bg-surface-sunken p-1" role="radiogroup" aria-label={legend}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'touch-target h-9 rounded-md px-4 text-sm font-medium transition-colors',
              value === o.value ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

// -------------------------------------------------------------- form shell --

export interface SearchFormShellProps {
  children: ReactNode;
  advanced?: ReactNode;
  advancedInitiallyOpen?: boolean;
  advancedLabel?: string;
  errors: FieldErrors;
  pending: boolean;
  onSubmit: () => void;
  submitLabel?: string;
  ariaLabel: string;
}

export function SearchFormShell({
  children,
  advanced,
  advancedInitiallyOpen = false,
  advancedLabel = 'אפשרויות נוספות',
  errors,
  pending,
  onSubmit,
  submitLabel = 'חיפוש',
  ariaLabel,
}: SearchFormShellProps) {
  const [advOpen, setAdvOpen] = useState(advancedInitiallyOpen);
  const advId = useId();
  const formError = errors[''];
  const unplaced = Object.keys(errors).filter((k) => k !== '').length;
  return (
    <form
      noValidate
      aria-label={ariaLabel}
      className="flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
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
      {children}
      {advanced && (
        <div className="flex flex-col gap-4">
          <button
            type="button"
            className="touch-target inline-flex w-fit items-center gap-1.5 text-sm font-medium text-accent hover:text-accent-hover"
            aria-expanded={advOpen}
            aria-controls={advId}
            onClick={() => setAdvOpen((v) => !v)}
          >
            {advancedLabel}
            <ChevronDown className={cn('size-4 transition-transform', advOpen && 'rotate-180')} aria-hidden="true" />
          </button>
          <div id={advId} hidden={!advOpen} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {advanced}
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button type="submit" size="lg" loading={pending} loadingText="מחפשים אצל הספקים…" leadingIcon={<Search aria-hidden="true" />}>
          {submitLabel}
        </Button>
        <p className="text-xs text-fg-subtle">החיפוש נשלח לכל הספקים הפעילים; הספקים שאינם מחוברים יסומנו בתוצאות.</p>
      </div>
    </form>
  );
}

export { errorFor };
