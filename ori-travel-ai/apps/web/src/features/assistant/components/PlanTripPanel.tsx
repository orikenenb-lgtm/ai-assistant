import { CalendarDays, Coffee, ExternalLink, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Callout, Field, Input, NativeSelect, Spinner } from '@/components/ui';
import { INTEREST_LABELS, OfferCard, OfferDetailDialog } from '@/features/offers';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { PlanDay, PlanItem } from '@/lib/schemas/ai';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import { usePlanTrip } from '../hooks';
import { PLAN_INTERESTS } from '../labels';
import { validatePlanForm, type PlanFormValues } from '../planForm';
import { PlainText } from './PlainText';

const INITIAL: PlanFormValues = {
  destination: '',
  start_date: '',
  end_date: '',
  adults: 2,
  children_ages_text: '',
  interests: ['family'],
};

function PlanItemView({ item, onOpenDetails }: { item: PlanItem; onOpenDetails: (o: CanonicalOffer) => void }) {
  if (item.type === 'free' || !item.card) {
    return (
      <li className="flex items-start gap-3 rounded-xl border border-dashed border-line-strong bg-surface p-4" data-testid="plan-free-slot">
        <Coffee className="mt-0.5 size-5 shrink-0 text-fg-subtle" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-fg-subtle">{item.time_slot_label}</p>
          <p className="font-semibold text-fg">{item.type === 'free' ? 'יום חופשי' : item.title}</p>
          {item.type === 'free' && item.title && item.title !== 'יום חופשי' && <PlainText text={item.title} className="text-sm text-fg-muted" />}
          {item.reasons.map((r, i) => (
            <PlainText key={i} text={r} className="text-sm text-fg-muted" />
          ))}
        </div>
      </li>
    );
  }
  return (
    <li className="flex flex-col gap-2" data-testid="plan-activity">
      <div className="flex flex-wrap items-center gap-2 text-xs text-fg-muted">
        <Badge tone="info" size="sm">
          {item.time_slot_label}
        </Badge>
        {item.start_time && <span dir="ltr">{item.start_time}</span>}
        {item.duration_minutes ? <span>כ-{item.duration_minutes} דקות</span> : null}
      </div>
      {item.reasons.length > 0 && (
        <ul className="list-disc ps-5 text-sm text-fg-muted">
          {item.reasons.map((r, i) => (
            <li key={i}>
              <PlainText text={r} className="inline" />
            </li>
          ))}
        </ul>
      )}
      <OfferCard offer={item.card} onOpenDetails={onOpenDetails} showCompare={false} />
    </li>
  );
}

function DayView({ day, onOpenDetails }: { day: PlanDay; onOpenDetails: (o: CanonicalOffer) => void }) {
  return (
    <section aria-labelledby={`day-${day.date}`} className="flex flex-col gap-3" data-testid="plan-day">
      <h3 id={`day-${day.date}`} className="flex items-center gap-2 text-base font-bold text-fg">
        <CalendarDays className="size-4 text-fg-subtle" aria-hidden="true" />
        {day.label}
        <span className="text-sm font-normal text-fg-muted">({day.weekday})</span>
      </h3>
      <ol className="flex flex-col gap-3">
        {day.items.map((it, i) => (
          <PlanItemView key={`${it.offer_id ?? 'free'}-${i}`} item={it} onOpenDetails={onOpenDetails} />
        ))}
      </ol>
    </section>
  );
}

/** "תכנון טיול": POST /api/ai/plan-trip → day-by-day suggestions built only from real activity search results. */
export function PlanTripPanel() {
  const [values, setValues] = useState<PlanFormValues>(INITIAL);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [details, setDetails] = useState<CanonicalOffer | null>(null);
  const plan = usePlanTrip();

  const set = <K extends keyof PlanFormValues>(key: K, value: PlanFormValues[K]) => setValues((v) => ({ ...v, [key]: value }));

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { data, errors: errs } = validatePlanForm(values);
    setErrors(errs);
    if (data) plan.mutate(data);
  }

  const result = plan.data;

  return (
    <div className="grid gap-8 lg:grid-cols-[22rem_1fr] lg:items-start">
      <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-5 shadow-xs">
        <Field label="יעד" error={errors.destination}>
          <Input value={values.destination} onChange={(e) => set('destination', e.target.value)} placeholder="למשל: ברצלונה" maxLength={100} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="מתאריך" error={errors.start_date}>
            <Input type="date" value={values.start_date} onChange={(e) => set('start_date', e.target.value)} />
          </Field>
          <Field label="עד תאריך" error={errors.end_date}>
            <Input type="date" min={values.start_date || undefined} value={values.end_date} onChange={(e) => set('end_date', e.target.value)} />
          </Field>
        </div>
        <Field label="מבוגרים">
          <NativeSelect
            value={String(values.adults)}
            onChange={(e) => set('adults', Number(e.target.value))}
            options={Array.from({ length: 9 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }))}
          />
        </Field>
        <Field label="גילאי ילדים" optional hint="מספרים מופרדים בפסיק, למשל: 6, 9" error={errors.children_ages_text}>
          <Input value={values.children_ages_text} onChange={(e) => set('children_ages_text', e.target.value)} inputMode="numeric" dir="ltr" className="text-start" />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-fg">תחומי עניין</legend>
          <div className="flex flex-wrap gap-2">
            {PLAN_INTERESTS.map((i) => {
              const on = values.interests.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  aria-pressed={on}
                  onClick={() => set('interests', on ? values.interests.filter((x) => x !== i) : [...values.interests, i])}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm transition-colors',
                    on ? 'border-sea-500 bg-sea-50 font-medium text-sea-700' : 'border-line-strong bg-surface text-fg-muted hover:bg-sand-50',
                  )}
                >
                  {INTEREST_LABELS[i] ?? i}
                </button>
              );
            })}
          </div>
        </fieldset>
        <Button type="submit" loading={plan.isPending} leadingIcon={<Sparkles aria-hidden="true" />}>
          בניית תכנית
        </Button>
        <p className="text-xs leading-relaxed text-fg-subtle">
          התכנית נבנית מתוצאות חיפוש אטרקציות אמיתיות במערכת. ימים בלי פעילות מתאימה מסומנים כ&quot;יום חופשי&quot; — לא ממציאים פעילויות.
        </p>
      </form>

      <div className="min-w-0" aria-live="polite">
        {plan.isPending && (
          <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Spinner className="size-4" /> בונה תכנית…
          </p>
        )}
        {plan.isError && (
          <Callout tone="danger" role="alert" title="לא ניתן לבנות תכנית">
            {errorMessage(plan.error)}
          </Callout>
        )}
        {!result && !plan.isPending && !plan.isError && (
          <p className="rounded-2xl border border-dashed border-line-strong p-8 text-center text-sm text-fg-muted">
            מלאו את הפרטים ולחצו &quot;בניית תכנית&quot; כדי לקבל הצעה יומית.
          </p>
        )}
        {result && (
          <div className="flex flex-col gap-6" data-testid="plan-result">
            <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-5">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-fg">{result.destination}</h2>
                <Badge tone={result.intro_mode === 'model' ? 'accent' : 'muted'} size="sm">
                  {result.intro_mode === 'model' ? 'פתיח ממודל AI' : 'פתיח בסיסי'}
                </Badge>
              </div>
              <PlainText text={result.intro} className="text-sm leading-relaxed text-fg-muted" />
              {result.search_id && (
                <Link
                  to={`/search/activities?search_id=${encodeURIComponent(result.search_id)}`}
                  className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  פתיחת חיפוש האטרקציות המלא
                </Link>
              )}
            </div>
            {result.warnings.length > 0 && (
              <Callout tone="warn" title="שימו לב">
                <ul className="list-disc ps-5">
                  {result.warnings.map((w, i) => (
                    <li key={i}>
                      <PlainText text={w} className="inline" />
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
            {!result.grounding.ok && (
              <Callout tone="warn" title="הוסרו מחירים שלא אומתו מול תוצאות החיפוש" data-testid="grounding-notice">
                התכנית מציגה מחירים רק מתוך תוצאות החיפוש של המערכת.
              </Callout>
            )}
            {result.days.map((d) => (
              <DayView key={d.date} day={d} onOpenDetails={setDetails} />
            ))}
          </div>
        )}
      </div>
      <OfferDetailDialog offer={details} onOpenChange={(open) => !open && setDetails(null)} />
    </div>
  );
}
