import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Grid3x3, Info } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Button, Callout, ErrorState, FreshnessText, ModeBadge, MoneyText, Skeleton } from '@/components/ui';
import { cabinLabel } from '@/features/offers/labels';
import { addDaysIso, todayIso } from '@/features/search/forms/common';
import { MD_UP, prefersReducedMotion, readPref, useMediaQuery, writePref } from '@/features/search/useMediaQuery';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import type { FareCell, FareCalendarResponse } from '@/lib/schemas/calendar';
import { useFareCalendar } from '../hooks';
import {
  addMonths,
  calendarBaseFromParams,
  cellKey,
  indexCells,
  inRange,
  matrixNights,
  matrixRequest,
  matrixStartFor,
  monthDays,
  monthLabel,
  monthOf,
  monthRequest,
  monthWeeks,
  moveLinear,
  moveMatrix,
  nightsSupported,
  searchableRange,
  STATUS_LABELS,
  TIER_LABELS,
  WEEKDAY_LONG,
  WEEKDAY_SHORT,
  weekday,
  withoutRepeatedSentences,
  type CalendarBase,
  type CalendarView,
} from '../model';
import { CalendarLegend } from './CalendarLegend';
import { FareCellButton } from './FareCellButton';

export interface SelectedCalendarCell {
  depart_date: string;
  return_date: string | null;
  nights: number | null;
}

export interface FareCalendarProps {
  /** Params of the current flight search (route, party, cabin, bags, dates). */
  params: Record<string, unknown>;
  /** Runs the normal flight search for the chosen dates. */
  onSelect: (cell: SelectedCalendarCell) => void;
  /** `cellKey` of the cell whose search is running. */
  pendingKey?: string | null;
  /** Error of the last cell search (Hebrew). */
  selectError?: ReactNode;
  /** Hebrew city name for an IATA code. */
  placeName?: (code: string) => string | undefined;
  /** Coverage note already shown on the page (search results) — its sentences are not repeated here. */
  pageCoverageNote?: string | null;
  className?: string;
}

const VIEW_PREF = 'ori.fareCalendar.view';
const VIEWS = ['month', 'matrix'] as const;

function isRtl(el: Element | null): boolean {
  const dir = el?.closest('[dir]')?.getAttribute('dir') ?? document.documentElement.getAttribute('dir') ?? 'rtl';
  return dir !== 'ltr';
}

function shortDate(iso: string): string {
  return formatDate(iso, 'date-short') ?? iso;
}

/**
 * Fare calendar (centrepiece of the flight search): month grid of depart dates (fixed nights) or a depart × nights
 * matrix, coloured by price tier with text/glyph states, roving-tabindex keyboard navigation (arrows, Home/End,
 * Enter), a swipeable week strip on phones, and honest DEMO / CACHED / coverage labelling from the API.
 */
export function FareCalendar(props: FareCalendarProps) {
  const base = useMemo(() => calendarBaseFromParams(props.params), [props.params]);
  if (!base) return null;
  return <CalendarInner base={base} {...props} />;
}

function CalendarInner({ base, onSelect, pendingKey, selectError, placeName, pageCoverageNote, className }: FareCalendarProps & { base: CalendarBase }) {
  const titleId = useId();
  const legendId = useId();
  const periodId = useId();
  const [today] = useState(todayIso);
  const range = searchableRange(today);
  const isMd = useMediaQuery(MD_UP);
  const oneWay = base.nights === null;
  const [viewPref, setViewPref] = useState<CalendarView>(() => readPref(VIEW_PREF, VIEWS, 'month'));
  const view: CalendarView = oneWay ? 'month' : viewPref;
  const [month, setMonth] = useState(() => monthOf(base.departDate));
  const [matrixStart, setMatrixStart] = useState(() => matrixStartFor(base.departDate, today));
  const [matrixCenter, setMatrixCenter] = useState(() => base.nights ?? 7);
  const nightsList = useMemo(() => matrixNights(matrixCenter), [matrixCenter]);

  const req = useMemo(
    () => (view === 'month' ? monthRequest(base, month, today) : matrixRequest(base, matrixStart, nightsList, today)),
    [view, base, month, matrixStart, nightsList, today],
  );
  const q = useFareCalendar(req);
  const data = q.data;
  const cells = useMemo(() => indexCells(data?.cells ?? []), [data]);
  const selectedKey = cellKey(base.departDate, base.nights);

  // Layout (all cells rendered, so roving focus can move without waiting for data).
  const days = useMemo(() => monthDays(month), [month]);
  const departs = useMemo(() => {
    const start = matrixStart < today ? today : matrixStart;
    return Array.from({ length: 7 }, (_, i) => addDaysIso(start, i));
  }, [matrixStart, today]);
  const layoutKeys = useMemo(
    () => (view === 'month' ? days.map((d) => cellKey(d, base.nights)) : nightsList.flatMap((n) => departs.map((d) => cellKey(d, n)))),
    [view, days, departs, nightsList, base.nights],
  );

  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);
  const firstInRange = layoutKeys.find((k) => inRange(k.slice(0, 10), today, base.nights)) ?? layoutKeys[0];
  const focusKey = activeKey && layoutKeys.includes(activeKey) ? activeKey : layoutKeys.includes(selectedKey) ? selectedKey : firstInRange;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const stripRef = useRef<HTMLDivElement>(null);

  // Phones: bring the searched (or first searchable) day into view inside the strip, without moving focus.
  const stamp = data?.generated_at ?? (q.isPending ? 'pending' : 'idle');
  const scrollTarget = layoutKeys.includes(selectedKey) ? selectedKey : firstInRange;
  useEffect(() => {
    const strip = stripRef.current;
    if (isMd || view !== 'month' || !strip) return;
    const el = refs.current.get(scrollTarget);
    if (!el || !strip.scrollBy) return;
    const c = strip.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    strip.scrollBy({ left: r.left + r.width / 2 - (c.left + c.width / 2), behavior: 'auto' });
  }, [isMd, view, stamp, scrollTarget]);

  const focusCell = (key: string) => {
    setActiveKey(key);
    refs.current.get(key)?.focus();
  };

  const select = (depart: string, nights: number | null) => {
    const cell = cells.get(cellKey(depart, nights));
    setActiveKey(cellKey(depart, nights));
    onSelect({ depart_date: depart, return_date: cell?.return_date ?? (nights != null ? addDaysIso(depart, nights) : null), nights });
  };

  const onLinearKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const next = moveLinear(index, e.key, { length: days.length, rtl: isRtl(e.currentTarget), firstWeekday: weekday(days[0]) });
    if (next === null) return;
    e.preventDefault();
    focusCell(cellKey(days[next], base.nights));
  };

  const onMatrixKey = (e: KeyboardEvent<HTMLButtonElement>, row: number, col: number) => {
    const next = moveMatrix({ row, col }, e.key, { rows: nightsList.length, cols: departs.length, rtl: isRtl(e.currentTarget) });
    if (!next) return;
    e.preventDefault();
    focusCell(cellKey(departs[next.col], nightsList[next.row]));
  };

  const scrollWeek = (dir: 1 | -1) => {
    const strip = stripRef.current;
    if (!strip?.scrollBy) return;
    const first = strip.querySelector<HTMLElement>('[data-testid="fare-cell"]');
    const step = (first?.getBoundingClientRect().width || 76) + 6;
    strip.scrollBy({ left: dir * 7 * step * (isRtl(strip) ? -1 : 1), behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const changeView = (v: CalendarView) => {
    if (v === view) return;
    // Re-centre on the current search when switching.
    if (v === 'month') setMonth(monthOf(base.departDate));
    else {
      setMatrixStart(matrixStartFor(base.departDate, today));
      setMatrixCenter(base.nights ?? 7);
    }
    setViewPref(v);
    writePref(VIEW_PREF, v);
    setActiveKey(null);
  };

  const cellProps = (depart: string, nights: number | null) => {
    const key = cellKey(depart, nights);
    return {
      depart,
      nights,
      cell: cells.get(key),
      selected: key === selectedKey,
      pending: key === pendingKey,
      outOfRange: !inRange(depart, today, nights),
      active: key === focusKey,
      onSelect: () => select(depart, nights),
      onFocus: () => setActiveKey(key),
      onHover: (h: boolean) => setHoverKey(h ? key : null),
      buttonRef: (el: HTMLButtonElement | null) => {
        if (el) refs.current.set(key, el);
        else refs.current.delete(key);
      },
    };
  };

  const detailKey = (hoverKey && layoutKeys.includes(hoverKey) ? hoverKey : null) ?? focusKey;
  const modes = new Set((data?.cells ?? []).map((c) => c.mode).filter(Boolean));
  const loading = !!req && q.isPending;
  const prevMonthDisabled = month <= monthOf(range.from);
  const nextMonthDisabled = month >= monthOf(range.to);
  const prevWeekDisabled = departs[0] <= range.from;
  const nextWeekDisabled = addDaysIso(departs[0], 7 + Math.max(...nightsList)) > range.to;
  const city = (code: string) => placeName?.(code) ?? code;
  const pax = base.adults + base.childrenAges.length;

  let body: ReactNode;
  if (!nightsSupported(base.nights)) {
    body = (
      <Callout tone="info" title="לוח המחירים אינו זמין לחיפוש הזה">
        הלוח מציג טיסות בכיוון אחד או הלוך-חזור של 1–30 לילות.
      </Callout>
    );
  } else if (!req) {
    body = <p className="rounded-lg bg-surface-sunken p-4 text-sm text-fg-muted">התקופה הזו מחוץ לטווח החיפוש (מהיום ועד שנה קדימה).</p>;
  } else if (q.isError) {
    const err = q.error;
    body =
      isApiError(err) && err.status === 404 ? (
        <Callout tone="info" title="לוח המחירים עדיין לא זמין בשרת">
          אפשר להמשיך לחפש תאריך מסוים בטופס החיפוש. הלוח יופיע כאן כשהשירות יופעל.
        </Callout>
      ) : isApiError(err) && err.status === 429 ? (
        <Callout tone="warn" title="הגעתם למגבלת הבדיקות של לוח המחירים" role="alert">
          {err.message} אפשר לנסות שוב בעוד כמה דקות.
        </Callout>
      ) : (
        <ErrorState compact error={err} title="לא ניתן לטעון את לוח המחירים" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      );
  } else if (view === 'month') {
    body = isMd ? (
      <div role="grid" aria-labelledby={`${titleId} ${periodId}`} aria-describedby={legendId} aria-busy={loading || undefined} className="flex flex-col gap-1.5">
        <div role="row" className="grid grid-cols-7 gap-1.5">
          {WEEKDAY_SHORT.map((w, i) => (
            <div role="columnheader" key={w} className="pb-0.5 text-center text-xs font-medium text-fg-subtle">
              <abbr title={WEEKDAY_LONG[i]} className="no-underline">
                {w}
              </abbr>
            </div>
          ))}
        </div>
        {monthWeeks(month).map((week, wi) => (
          <div role="row" key={wi} className="grid grid-cols-7 gap-1.5">
            {week.map((d, di) =>
              d ? (
                <div role="gridcell" key={d}>
                  {loading ? (
                    <Skeleton className="h-16 w-full rounded-lg sm:h-[4.25rem]" />
                  ) : (
                    <FareCellButton variant="grid" {...cellProps(d, base.nights)} onKeyDown={(e) => onLinearKey(e, days.indexOf(d))} />
                  )}
                </div>
              ) : (
                <div role="gridcell" key={`pad-${di}`} />
              ),
            )}
          </div>
        ))}
      </div>
    ) : (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" leadingIcon={<ChevronRight className="ltr:rotate-180" aria-hidden="true" />} onClick={() => scrollWeek(-1)}>
            השבוע הקודם
          </Button>
          <Button size="sm" variant="ghost" trailingIcon={<ChevronLeft className="ltr:rotate-180" aria-hidden="true" />} onClick={() => scrollWeek(1)}>
            השבוע הבא
          </Button>
        </div>
        <div
          ref={stripRef}
          role="grid"
          aria-labelledby={`${titleId} ${periodId}`}
          aria-describedby={legendId}
          aria-busy={loading || undefined}
          className="scrollbar-thin -mx-1 snap-x snap-mandatory overflow-x-auto scroll-px-1 px-1 pb-2 pt-1"
          data-testid="fare-strip"
        >
          <div role="row" className="flex gap-1.5">
            {days.map((d, i) => (
              <div role="gridcell" key={d} className="w-[4.75rem] shrink-0 snap-start">
                {loading ? (
                  <Skeleton className="h-[5.25rem] w-full rounded-lg" />
                ) : (
                  <FareCellButton variant="strip" {...cellProps(d, base.nights)} onKeyDown={(e) => onLinearKey(e, i)} />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  } else {
    const cols = 'grid grid-cols-[4.75rem_repeat(7,minmax(4.5rem,1fr))] gap-1.5';
    body = (
      <div className="scrollbar-thin -mx-1 overflow-x-auto px-1 pb-2">
        <div role="grid" aria-labelledby={`${titleId} ${periodId}`} aria-describedby={legendId} aria-busy={loading || undefined} className="flex min-w-[38rem] flex-col gap-1.5">
          <div role="row" className={cols}>
            <div role="columnheader" className="sticky start-0 z-10 flex items-end bg-surface pb-1 text-2xs font-medium leading-tight text-fg-subtle">
              לילות ↓ / יציאה
            </div>
            {departs.map((d) => (
              <div role="columnheader" key={d} className="flex flex-col items-center pb-1 text-center leading-tight">
                <abbr title={WEEKDAY_LONG[weekday(d)]} className="text-2xs font-medium text-fg-subtle no-underline">
                  {WEEKDAY_SHORT[weekday(d)]}
                </abbr>
                <span className="text-xs font-semibold text-fg">{shortDate(d)}</span>
              </div>
            ))}
          </div>
          {nightsList.map((n, ri) => (
            <div role="row" key={n} className={cols}>
              <div role="rowheader" className="sticky start-0 z-10 flex items-center bg-surface text-xs font-semibold text-fg">
                {n === 1 ? 'לילה אחד' : `${n} לילות`}
              </div>
              {departs.map((d, ci) => (
                <div role="gridcell" key={d}>
                  {loading ? (
                    <Skeleton className="h-12 w-full rounded-lg" />
                  ) : (
                    <FareCellButton variant="matrix" {...cellProps(d, n)} onKeyDown={(e) => onMatrixKey(e, ri, ci)} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <section
      aria-labelledby={titleId}
      data-testid="fare-calendar"
      data-view={view}
      data-state={q.isError ? 'error' : loading ? 'loading' : data ? 'ready' : 'idle'}
      className={cn('rounded-2xl border border-line bg-surface shadow-sm', className)}
    >
      <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={titleId} className="text-base font-bold text-fg">
              לוח מחירים
            </h2>
            {data?.has_demo && <ModeBadge mode="DEMO" size="sm" />}
            {modes.has('CACHED') && <ModeBadge mode="CACHED" size="sm" />}
            {modes.has('LIVE') && <ModeBadge mode="LIVE" size="sm" />}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
            <span className="inline-flex items-center gap-1">
              {city(base.origin)}
              <ArrowLeft className="size-3 ltr:rotate-180" aria-hidden="true" />
              <span className="sr-only">אל</span>
              {city(base.destination)}
            </span>
            <span aria-hidden="true">·</span>
            <span>{oneWay ? 'כיוון אחד' : view === 'month' ? (base.nights === 1 ? 'לילה אחד' : `${base.nights} לילות`) : 'יציאה × מספר לילות'}</span>
            <span aria-hidden="true">·</span>
            <span>{pax === 1 ? 'נוסע אחד' : `${pax} נוסעים`}</span>
            <span aria-hidden="true">·</span>
            <span>{cabinLabel(base.cabin)}</span>
          </p>
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-line bg-surface-sunken p-1" role="radiogroup" aria-label="תצוגת לוח המחירים">
          {(
            [
              { v: 'month', label: 'לוח חודשי', icon: CalendarDays },
              { v: 'matrix', label: 'מטריצת לילות', icon: Grid3x3 },
            ] as const
          ).map(({ v, label, icon: Icon }) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={view === v}
              disabled={v === 'matrix' && oneWay}
              title={v === 'matrix' && oneWay ? 'זמין לטיסות הלוך-חזור' : undefined}
              onClick={() => changeView(v)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                view === v ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:p-5">
        {selectError && (
          <Callout tone="danger" title="החיפוש לתאריכים שנבחרו נכשל" role="alert">
            {selectError}
          </Callout>
        )}

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-1">
            {view === 'month' ? (
              <>
                <PeriodButton label="החודש הקודם" dir="prev" disabled={prevMonthDisabled} onClick={() => setMonth(addMonths(month, -1))} />
                <p id={periodId} className="min-w-28 text-center text-sm font-semibold text-fg" aria-live="polite">
                  {monthLabel(month)}
                </p>
                <PeriodButton label="החודש הבא" dir="next" disabled={nextMonthDisabled} onClick={() => setMonth(addMonths(month, 1))} />
              </>
            ) : (
              <>
                <PeriodButton
                  label="7 ימים מוקדם יותר"
                  dir="prev"
                  disabled={prevWeekDisabled}
                  onClick={() => setMatrixStart(addDaysIso(departs[0], -7) < today ? today : addDaysIso(departs[0], -7))}
                />
                <p id={periodId} className="min-w-36 text-center text-sm font-semibold text-fg" aria-live="polite">
                  {shortDate(departs[0])} – {shortDate(departs[departs.length - 1])}
                </p>
                <PeriodButton label="7 ימים מאוחר יותר" dir="next" disabled={nextWeekDisabled} onClick={() => setMatrixStart(addDaysIso(departs[0], 7))} />
              </>
            )}
          </div>
          {data && <CalendarStats data={data} />}
        </div>

        {loading && (
          <p role="status" className="sr-only">
            טוענים את לוח המחירים…
          </p>
        )}
        {body}

        {data && data.stats.priced === 0 && !q.isError && (
          <p className="flex items-start gap-2 rounded-lg bg-surface-sunken p-3 text-sm text-fg-muted" data-testid="fare-calendar-empty">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            לא נמצאו מחירים בתקופה הזו. נסו חודש אחר{oneWay ? '' : ', את מטריצת הלילות'} או חיפוש רגיל בתאריך מסוים.
          </p>
        )}

        {data && <CellDetails cell={cells.get(detailKey)} cellKeyValue={detailKey} />}

        <div className="flex flex-col gap-3 border-t border-line pt-3">
          <CalendarLegend id={legendId} note={data?.legend_note} />
          {data && <Notes data={data} pageCoverageNote={pageCoverageNote} />}
        </div>
      </div>
    </section>
  );
}

function PeriodButton({ label, dir, disabled, onClick }: { label: string; dir: 'prev' | 'next'; disabled: boolean; onClick: () => void }) {
  const Icon = dir === 'prev' ? ChevronRight : ChevronLeft;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-10 place-items-center rounded-md border border-line text-fg-muted transition-colors hover:bg-surface-sunken hover:text-fg disabled:cursor-not-allowed disabled:opacity-40"
    >
      <Icon className="size-5 ltr:rotate-180" aria-hidden="true" />
    </button>
  );
}

function CalendarStats({ data }: { data: FareCalendarResponse }) {
  const s = data.stats;
  return (
    <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-muted" data-testid="fare-stats">
      {s.min && (
        <div className="flex items-baseline gap-1">
          <dt>הנמוך בלוח:</dt>
          <dd className="font-bold text-tangerine-800">
            <MoneyText value={s.min} />
          </dd>
        </div>
      )}
      {s.median && (
        <div className="flex items-baseline gap-1">
          <dt>חציון:</dt>
          <dd className="font-semibold text-fg">
            <MoneyText value={s.median} />
          </dd>
        </div>
      )}
      <div className="flex items-baseline gap-1">
        <dt className="sr-only">מצב הבדיקה:</dt>
        <dd>
          {s.priced} עם מחיר · {s.no_offers} ללא טיסות · {s.not_searched} לא נבדקו{s.error ? ` · ${s.error} שגיאות` : ''}
        </dd>
      </div>
    </dl>
  );
}

function CellDetails({ cell, cellKeyValue }: { cell: FareCell | undefined; cellKeyValue: string }) {
  const [depart, nightsRaw] = cellKeyValue.split('|');
  const nights = nightsRaw ? Number(nightsRaw) : null;
  const ret = cell?.return_date ?? (nights != null ? addDaysIso(depart, nights) : null);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-surface-sunken px-3 py-2 text-xs text-fg-muted" data-testid="fare-cell-details" aria-live="off">
      <span className="font-semibold text-fg">
        {formatDate(depart, 'weekday-date') ?? depart}
        {ret && <> ← {formatDate(ret, 'weekday-date') ?? ret}</>}
      </span>
      {!cell ? (
        <span>לא נבדק</span>
      ) : cell.status === 'priced' ? (
        <>
          <span>
            החל מ-<MoneyText value={cell.min_total} className="font-bold text-fg" />
            {cell.travelers ? (cell.travelers === 1 ? ' לנוסע אחד' : ` ל-${cell.travelers} נוסעים`) : ''}
          </span>
          {cell.per_person && (cell.travelers ?? 0) > 1 && (
            <span>
              <MoneyText value={cell.per_person} className="font-semibold text-fg" /> לנוסע
            </span>
          )}
          {cell.tier && <span>{TIER_LABELS[cell.tier]}</span>}
          {cell.offers_count != null && <span>{cell.offers_count === 1 ? 'הצעה אחת' : `${cell.offers_count} הצעות`}</span>}
          {cell.provider_name && <span>{cell.provider_name}</span>}
          {cell.mode && <ModeBadge mode={cell.mode} size="sm" showTooltip={false} />}
          {cell.fetched_at && <FreshnessText value={cell.fetched_at} />}
        </>
      ) : (
        <>
          <span className="font-medium">{STATUS_LABELS[cell.status]}</span>
          {cell.message && <span>{cell.message}</span>}
        </>
      )}
    </div>
  );
}

function Notes({ data, pageCoverageNote }: { data: FareCalendarResponse; pageCoverageNote?: string | null }) {
  const coverage = data.coverage_note ? withoutRepeatedSentences(data.coverage_note, pageCoverageNote) : '';
  return (
    <div className="flex flex-col gap-1.5 text-xs leading-relaxed text-fg-subtle" data-testid="fare-coverage">
      {coverage && <p>{coverage}</p>}
      <p>בחירת תא מריצה את החיפוש הרגיל לתאריכים האלה; המחיר הסופי נקבע בחיפוש ואצל הספק.</p>
      {data.sources.length > 0 && (
        <details className="group">
          <summary className="w-fit cursor-pointer font-medium text-accent hover:text-accent-hover">מקורות הנתונים בלוח</summary>
          <ul className="mt-1.5 flex flex-col gap-1">
            {data.sources.map((s) => (
              <li key={s.provider_id} className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-fg-muted">{s.provider_name}</span>
                {s.mode && <ModeBadge mode={s.mode} size="sm" showTooltip={false} />}
                {s.message && <span>— {s.message}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
