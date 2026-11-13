import { BellPlus, LayoutList, Scale, SlidersHorizontal, Table2, X } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, ButtonLink, Callout, DialogClose, Drawer, EmptyState, ErrorState, NativeSelect, Skeleton } from '@/components/ui';
import { canEdit, useAuth } from '@/features/auth';
import { FACTOR_LABELS, FACTOR_ORDER } from '@/features/offers/labels';
import {
  COMPARE_MIN,
  FeaturedDeal,
  OfferCard,
  OfferDetailDialog,
  OfferTable,
  pickFeatured,
  useCompareSelection,
  type TableSortKey,
} from '@/features/offers';
import { buildRoute, LazyRouteMap } from '@/features/route-map';
import { cn } from '@/lib/cn';
import type { Category } from '@/lib/schemas/common';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import type { SearchResponse } from '@/lib/schemas/search';
import { useAirportIndex, usePlaceName } from '../airportsApi';
import { EMPTY_FILTERS, SORT_OPTIONS, activeFilterCount, filterOffers, filterOptions, sortOffers, type OfferFilters, type SortKey } from '../filters';
import { useSearchResult } from '../hooks';
import { MD_UP, prefersReducedMotion, readPref, useMediaQuery, writePref } from '../useMediaQuery';
import { DEFAULT_WEIGHTS, toWeights, weightsEqual, weightsToParam, type Weights } from '../weights';
import { FilterPanel } from './FilterPanel';
import { ProviderStatusStrip } from './ProviderStatusStrip';
import { RerankPanel } from './RerankPanel';

const PAGE = 12;
const VIEW_PREF = 'ori.results.view';
const RESULT_VIEWS = ['list', 'table'] as const;
type ResultView = (typeof RESULT_VIEWS)[number];

const CATEGORY_PLURAL: Record<Category, string> = { flight: 'טיסות', hotel: 'מלונות', car: 'רכבים', activity: 'אטרקציות' };

const EMPTY_SUGGESTIONS: Record<Category, string[]> = {
  flight: [
    'בחרו בלוח המחירים תאריך שיש בו מחיר',
    'הגדילו את הגמישות בתאריכים (±1 עד ±3 ימים)',
    'הסירו את מגבלת העצירות או המחיר',
    'בדקו את קודי שדות התעופה, או נסו שדה תעופה סמוך',
  ],
  hotel: ['נסו תאריכים אחרים או פחות לילות', 'הורידו את דירוג הכוכבים או את דרישת ביטול החינם', 'בדקו שם עיר אחר או כתיב שונה'],
  car: ['הרחיבו את טווח התאריכים', 'הסירו מגבלות סוג רכב או תיבת הילוכים', 'נסו מקום איסוף אחר, למשל שדה התעופה הקרוב'],
  activity: ['הרחיבו את טווח התאריכים', 'הסירו תחומי עניין או דרישת שפה', 'נסו יעד אחר או כתיב שונה'],
};

function SidePanel(props: {
  category: Category;
  currency: string;
  filters: OfferFilters;
  setFilters: (patch: Partial<OfferFilters>) => void;
  applied: Weights;
  weightsPending: boolean;
  onApplyWeights: (w: Weights) => void;
  options: ReturnType<typeof filterOptions>;
  filterCount: number;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <RerankPanel key={weightsToParam(props.applied)} applied={props.applied} pending={props.weightsPending} onApply={props.onApplyWeights} />
      <hr className="border-line" />
      <FilterPanel
        category={props.category}
        filters={props.filters}
        onChange={props.setFilters}
        providers={props.options.providers}
        carriers={props.options.carriers}
        cabins={props.options.cabins}
        windows={props.options.windows}
        currency={props.currency}
      />
      {props.filterCount > 0 && (
        <Button variant="secondary" size="sm" onClick={props.onClear}>
          ניקוי מסננים ({props.filterCount})
        </Button>
      )}
    </div>
  );
}

function ViewToggle({ value, onChange }: { value: ResultView; onChange: (v: ResultView) => void }) {
  const items = [
    { v: 'list' as const, label: 'רשימה', Icon: LayoutList },
    { v: 'table' as const, label: 'טבלה', Icon: Table2 },
  ];
  return (
    <div className="hidden rounded-lg border border-line bg-surface-sunken p-0.5 md:inline-flex" role="group" aria-label="תצוגת התוצאות">
      {items.map(({ v, label, Icon }) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors',
            value === v ? 'bg-surface text-fg shadow-sm' : 'text-fg-muted hover:text-fg',
          )}
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 sm:p-5" aria-busy="true">
      <Skeleton className="h-4 w-32" />
      <Skeleton className="aspect-[1.7] w-full rounded-xl" />
    </div>
  );
}

export interface SearchResultsProps {
  base: SearchResponse;
  onEditSearch: () => void;
  /** A newer search (e.g. a fare-calendar date) is running: results are dimmed and marked busy. */
  pending?: boolean;
  /** Bring the results into view and focus their heading on mount (after choosing calendar dates). */
  autoFocus?: boolean;
}

/**
 * Everything under the search header: featured deal (+ route map for flights), honesty notes, rank/filters,
 * list ⇄ table of offers, compare bar and provider status.
 */
export function SearchResults({ base, onEditSearch, pending = false, autoFocus = false }: SearchResultsProps) {
  const category = base.category;
  const isFlight = category === 'flight';
  const [weightsParam, setWeightsParam] = useState<string | undefined>(undefined);
  const { user } = useAuth();
  const ranked = useSearchResult(base.search_id, weightsParam);
  const data = ranked.data ?? base;
  const rerankFailed = ranked.isError && weightsParam !== undefined;
  const applied = toWeights(data.weights);
  const customWeights = !weightsEqual(applied, DEFAULT_WEIGHTS) && weightsParam !== undefined;

  const [sort, setSort] = useState<SortKey>('score');
  const [filters, setFiltersState] = useState<OfferFilters>(EMPTY_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const [panelOpen, setPanelOpen] = useState(false);
  const [detail, setDetail] = useState<CanonicalOffer | null>(null);
  const [viewPref, setViewPref] = useState<ResultView>(() => readPref(VIEW_PREF, RESULT_VIEWS, 'list'));
  const [mapOfferId, setMapOfferId] = useState<string | null>(null);
  const isMd = useMediaQuery(MD_UP);
  const showTable = viewPref === 'table' && isMd;
  const selection = useCompareSelection();
  const airports = useAirportIndex(isFlight);
  const placeName = usePlaceName(isFlight);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);

  const currency = typeof data.params.currency === 'string' ? data.params.currency : 'ILS';
  const options = useMemo(() => filterOptions(data.offers), [data.offers]);
  const visible = useMemo(() => sortOffers(filterOffers(data.offers, filters, currency), sort), [data.offers, filters, currency, sort]);
  const filterCount = activeFilterCount(filters);
  const featured = useMemo(
    () => pickFeatured(data.offers, visible, data.highlights, filterCount > 0),
    [data.offers, visible, data.highlights, filterCount],
  );
  const mapOffer = (mapOfferId ? data.offers.find((o) => o.id === mapOfferId) : undefined) ?? featured?.offer ?? null;
  const route = useMemo(() => (isFlight && mapOffer ? buildRoute(mapOffer, airports) : null), [isFlight, mapOffer, airports]);

  useEffect(() => {
    if (!autoFocus) return;
    rootRef.current?.scrollIntoView?.({ block: 'start', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    headingRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);

  const setFilters = (patch: Partial<OfferFilters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };
  const clearFilters = () => setFiltersState(EMPTY_FILTERS);

  const applyWeights = (w: Weights) => {
    setWeightsParam(weightsEqual(w, DEFAULT_WEIGHTS) ? undefined : weightsToParam(w));
    setSort('score');
  };

  const changeView = (v: ResultView) => {
    setViewPref(v);
    writePref(VIEW_PREF, v);
  };

  const showOnMap = (o: CanonicalOffer) => {
    setMapOfferId(o.id);
    mapRef.current?.scrollIntoView?.({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };

  const countText =
    data.offers.length === 0
      ? 'לא נמצאו הצעות'
      : `${data.offers.length} הצעות${data.total_offers_before_dedupe > data.offers.length ? ` (מתוך ${data.total_offers_before_dedupe} לפני איחוד כפילויות)` : ''}`;

  const side = (
    <SidePanel
      category={category}
      currency={currency}
      filters={filters}
      setFilters={setFilters}
      applied={applied}
      weightsPending={ranked.isFetching}
      onApplyWeights={applyWeights}
      options={options}
      filterCount={filterCount}
      onClear={clearFilters}
    />
  );

  const busy = ranked.isFetching || pending;

  return (
    <div
      ref={rootRef}
      className="flex scroll-mt-[calc(var(--spacing-topbar)+1rem)] flex-col gap-6"
      data-testid="search-results"
      data-search-id={data.search_id}
      aria-busy={pending || undefined}
    >
      <p role="status" aria-live="polite" className="sr-only">
        {pending
          ? 'מחפשים הצעות לתאריכים שנבחרו…'
          : ranked.isFetching
            ? 'מעדכנים דירוג…'
            : `${countText}${filterCount ? `, מוצגות ${visible.length} אחרי סינון` : ''}`}
      </p>

      {data.status === 'failed' && (
        <Callout tone="danger" title="החיפוש לא החזיר תוצאות מאף ספק" role="alert">
          כל הספקים שנבדקו נכשלו או אינם מחוברים. פירוט ב"מקורות החיפוש" למטה.
        </Callout>
      )}
      {data.status === 'partial' && (
        <Callout tone="warn" title="חלק מהספקים לא ענו">
          התוצאות חלקיות — ייתכנו הצעות נוספות אצל ספקים שלא ענו. פירוט ב"מקורות החיפוש" למטה.
        </Callout>
      )}

      {featured && (
        <div
          className={cn(
            'grid grid-cols-[minmax(0,1fr)] gap-4 transition-opacity',
            route && 'xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]',
            pending && 'opacity-60',
          )}
        >
          <FeaturedDeal pick={featured} onReview={setDetail} placeName={isFlight ? placeName : undefined} />
          {route && mapOffer && (
            <div ref={mapRef} className="scroll-mt-[calc(var(--spacing-topbar)+1rem)]">
              <Suspense fallback={<MapSkeleton />}>
                <LazyRouteMap
                  route={route}
                  subtitle={mapOffer.id === featured.offer.id ? `${mapOffer.title} · ההצעה המודגשת` : mapOffer.title}
                  className="h-full"
                />
              </Suspense>
            </div>
          )}
        </div>
      )}

      <div className={cn('grid grid-cols-[minmax(0,1fr)] gap-6', !showTable && 'lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start')}>
        {!showTable && (
          <aside
            className="hidden rounded-xl border border-line bg-surface p-5 shadow-xs lg:sticky lg:top-[calc(var(--spacing-topbar)+1rem)] lg:block lg:max-h-[calc(100dvh-var(--spacing-topbar)-2rem)] lg:overflow-y-auto"
            aria-label="דירוג וסינון"
          >
            {data.offers.length > 0 ? side : <p className="text-sm text-fg-muted">אין הצעות לדירוג או לסינון.</p>}
          </aside>
        )}

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 ref={headingRef} tabIndex={-1} className="text-base font-bold text-fg focus:outline-none" data-testid="result-count">
                {countText}
              </h2>
              {filterCount > 0 && data.offers.length > 0 && (
                <p className="text-xs text-fg-muted">
                  מוצגות {visible.length} אחרי סינון ·{' '}
                  <button type="button" className="font-medium text-accent underline-offset-4 hover:underline" onClick={clearFilters}>
                    ניקוי מסננים
                  </button>
                </p>
              )}
              {customWeights && (
                <p className="text-xs text-fg-muted">
                  <Badge tone="accent" size="sm">
                    דירוג מותאם
                  </Badge>{' '}
                  משקלים: {FACTOR_ORDER.map((f) => `${FACTOR_LABELS[f]} ${applied[f]}%`).join(' · ')}
                </p>
              )}
            </div>
            {data.offers.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <ViewToggle value={viewPref} onChange={changeView} />
                <Button
                  variant="secondary"
                  size="md"
                  className={cn(!showTable && 'lg:hidden')}
                  leadingIcon={<SlidersHorizontal aria-hidden="true" />}
                  onClick={() => setPanelOpen(true)}
                >
                  דירוג וסינון
                  {filterCount > 0 && (
                    <Badge tone="accent" size="sm">
                      {filterCount}
                    </Badge>
                  )}
                </Button>
                <label className="flex items-center gap-2 text-sm text-fg-muted">
                  <span className="hidden sm:inline">מיון:</span>
                  <span className="sr-only sm:hidden">מיון</span>
                  <NativeSelect
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    options={SORT_OPTIONS[category].map((o) => ({ value: o.key, label: o.label }))}
                    className="min-w-44"
                  />
                </label>
              </div>
            )}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {data.has_demo_results && (
              <Callout tone="neutral" title="חלק מהתוצאות הן נתוני הדגמה">
                הצעות המסומנות "הדגמה" הן נתונים סינתטיים: זה לא מחיר אמיתי, לא זמינות אמיתית, ואי אפשר להזמין אותן.
                {data.has_live_results ? ' ההצעות המסומנות "חי" הן מספקים אמיתיים.' : ''}
              </Callout>
            )}
            <Callout tone="info" title="כיסוי החיפוש" className={cn(!data.has_demo_results && 'md:col-span-2')}>
              {data.coverage_note}
            </Callout>
          </div>

          {canEdit(user) && (
            <div>
              <ButtonLink
                to={`/alerts?from_search=${encodeURIComponent(data.search_id)}`}
                variant="secondary"
                size="sm"
                leadingIcon={<BellPlus aria-hidden="true" />}
              >
                יצירת התראת מחיר לחיפוש הזה
              </ButtonLink>
            </div>
          )}

          {rerankFailed && (
            <ErrorState
              compact
              title="לא ניתן היה לחשב דירוג מותאם"
              error={ranked.error}
              onRetry={() => void ranked.refetch()}
              retrying={ranked.isFetching}
            />
          )}

          <div className={cn('flex flex-col gap-4 transition-opacity', busy && 'opacity-60')} aria-busy={ranked.isFetching || undefined}>
            {data.offers.length === 0 ? (
              <EmptyState
                icon={<SlidersHorizontal />}
                title="לא נמצאו הצעות"
                description={
                  <>
                    <p>ייתכן שהחיפוש מצומצם מדי, או שאין ספק מחובר שמכסה אותו.</p>
                    <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-start">
                      {EMPTY_SUGGESTIONS[category].map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </>
                }
                action={
                  <Button variant="accent" onClick={onEditSearch}>
                    עריכת החיפוש
                  </Button>
                }
              />
            ) : visible.length === 0 ? (
              <EmptyState
                compact
                title="אין הצעות שמתאימות למסננים"
                description="הסירו חלק מהמסננים כדי לראות עוד תוצאות."
                action={
                  <Button variant="secondary" size="sm" onClick={clearFilters}>
                    ניקוי מסננים
                  </Button>
                }
              />
            ) : showTable ? (
              <>
                <OfferTable
                  offers={visible.slice(0, shown)}
                  category={category}
                  caption={`טבלת השוואה: ${visible.length} ${CATEGORY_PLURAL[category]}, ${SORT_OPTIONS[category].find((o) => o.key === sort)?.label ?? ''}`}
                  sort={sort}
                  onSort={(k: TableSortKey) => setSort(k)}
                  onOpenDetails={setDetail}
                  featuredId={featured?.offer.id}
                  onShowOnMap={isFlight && airports ? showOnMap : undefined}
                  mapOfferId={route ? mapOffer?.id : null}
                />
                {visible.length > shown && (
                  <Button variant="secondary" className="self-center" onClick={() => setShown((n) => n + PAGE)}>
                    הצגת עוד ({visible.length - shown})
                  </Button>
                )}
              </>
            ) : (
              <>
                <ol className="flex flex-col gap-4">
                  {visible.slice(0, shown).map((offer) => (
                    <li key={offer.id}>
                      <OfferCard offer={offer} onOpenDetails={setDetail} />
                    </li>
                  ))}
                </ol>
                {visible.length > shown && (
                  <Button variant="secondary" className="self-center" onClick={() => setShown((n) => n + PAGE)}>
                    הצגת עוד ({visible.length - shown})
                  </Button>
                )}
              </>
            )}
          </div>

          {selection.count > 0 && (
            <div
              className="sticky bottom-[calc(var(--spacing-tabbar)+0.75rem)] z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-sea-200 bg-surface p-3 shadow-lg lg:bottom-4"
              role="region"
              aria-label="הצעות שנבחרו להשוואה"
            >
              <p className="flex items-center gap-2 text-sm font-medium text-fg">
                <Scale className="size-4 text-sea-600" aria-hidden="true" />
                {selection.count} הצעות נבחרו להשוואה
                {!selection.canCompare && <span className="text-xs font-normal text-fg-muted">(בחרו לפחות {COMPARE_MIN})</span>}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={selection.clear}>
                  ניקוי
                </Button>
                {selection.canCompare ? (
                  <ButtonLink to="/compare" size="sm" variant="accent">
                    השוואה
                  </ButtonLink>
                ) : (
                  <Button size="sm" variant="accent" disabled>
                    השוואה
                  </Button>
                )}
              </div>
            </div>
          )}

          <ProviderStatusStrip providers={data.providers} className="border-t border-line pt-4" />

          <p className="text-xs leading-relaxed text-fg-subtle">
            הציונים והדירוג נועדו לעזור למיין. המחיר הסופי ותנאי ההזמנה נקבעים אצל הספק.{' '}
            <Link to="/help" className="font-medium text-accent underline-offset-4 hover:underline">
              איך מחושב הציון?
            </Link>
          </p>
        </div>
      </div>

      <Drawer open={panelOpen} onOpenChange={setPanelOpen} title="דירוג וסינון" hideTitle className="bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold text-fg">דירוג וסינון</h2>
          <DialogClose className="grid size-9 place-items-center rounded-md text-fg-subtle hover:bg-ink-50" aria-label="סגירה">
            <X className="size-5" aria-hidden="true" />
          </DialogClose>
        </div>
        <div className="flex-1 overflow-y-auto p-5">{side}</div>
        <div className="border-t border-line p-4">
          <Button fullWidth onClick={() => setPanelOpen(false)}>
            הצגת {visible.length} הצעות
          </Button>
        </div>
      </Drawer>

      <OfferDetailDialog offer={detail} onOpenChange={(o) => !o && setDetail(null)} />
    </div>
  );
}
