import { Scale, SlidersHorizontal, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, ButtonLink, Callout, DialogClose, Drawer, EmptyState, ErrorState, NativeSelect } from '@/components/ui';
import { FACTOR_LABELS, FACTOR_ORDER } from '@/features/offers/labels';
import { OfferCard, OfferDetailDialog, useCompareSelection, COMPARE_MIN } from '@/features/offers';
import { cn } from '@/lib/cn';
import type { Category } from '@/lib/schemas/common';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import type { SearchResponse } from '@/lib/schemas/search';
import { EMPTY_FILTERS, SORT_OPTIONS, activeFilterCount, filterOffers, filterOptions, sortOffers, type OfferFilters, type SortKey } from '../filters';
import { useSearchResult } from '../hooks';
import { DEFAULT_WEIGHTS, toWeights, weightsEqual, weightsToParam, type Weights } from '../weights';
import { FilterPanel } from './FilterPanel';
import { ProviderStatusStrip } from './ProviderStatusStrip';
import { RerankPanel } from './RerankPanel';

const PAGE = 12;

const EMPTY_SUGGESTIONS: Record<Category, string[]> = {
  flight: ['הגדילו את הגמישות בתאריכים (±1 עד ±3 ימים)', 'הסירו את מגבלת העצירות או המחיר', 'בדקו את קודי שדות התעופה, או נסו שדה תעופה סמוך'],
  hotel: ['נסו תאריכים אחרים או פחות לילות', 'הורידו את דירוג הכוכבים או את דרישת ביטול החינם', 'בדקו שם עיר אחר או כתיב שונה'],
  car: ['הרחיבו את טווח התאריכים', 'הסירו מגבלות סוג רכב או תיבת הילוכים', 'נסו מקום איסוף אחר, למשל שדה התעופה הקרוב'],
  activity: ['הרחיבו את טווח התאריכים', 'הסירו תחומי עניין או דרישת שפה', 'נסו יעד אחר או כתיב שונה'],
};

function SidePanel(props: {
  category: Category;
  currency: string;
  data: SearchResponse;
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

export interface SearchResultsProps {
  base: SearchResponse;
  onEditSearch: () => void;
}

/** Everything under the search form: provider strip, honesty notes, sort/filters, re-rank, offer cards. */
export function SearchResults({ base, onEditSearch }: SearchResultsProps) {
  const category = base.category;
  const [weightsParam, setWeightsParam] = useState<string | undefined>(undefined);
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
  const selection = useCompareSelection();

  const currency = typeof data.params.currency === 'string' ? data.params.currency : 'ILS';
  const options = useMemo(() => filterOptions(data.offers), [data.offers]);
  const visible = useMemo(() => sortOffers(filterOffers(data.offers, filters, currency), sort), [data.offers, filters, currency, sort]);
  const filterCount = activeFilterCount(filters);
  const setFilters = (patch: Partial<OfferFilters>) => {
    setFiltersState((f) => ({ ...f, ...patch }));
    setShown(PAGE);
  };

  const applyWeights = (w: Weights) => {
    setWeightsParam(weightsEqual(w, DEFAULT_WEIGHTS) ? undefined : weightsToParam(w));
    setSort('score');
  };

  const countText =
    data.offers.length === 0
      ? 'לא נמצאו הצעות'
      : `${data.offers.length} הצעות${data.total_offers_before_dedupe > data.offers.length ? ` (מתוך ${data.total_offers_before_dedupe} לפני איחוד כפילויות)` : ''}`;

  const side = (
    <SidePanel
      category={category}
      currency={currency}
      data={data}
      filters={filters}
      setFilters={setFilters}
      applied={applied}
      weightsPending={ranked.isFetching}
      onApplyWeights={applyWeights}
      options={options}
      filterCount={filterCount}
      onClear={() => setFiltersState(EMPTY_FILTERS)}
    />
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] lg:items-start" data-testid="search-results" data-search-id={data.search_id}>
      <aside className="hidden rounded-xl border border-line bg-surface p-5 shadow-xs lg:sticky lg:top-[calc(var(--spacing-topbar)+1rem)] lg:block lg:max-h-[calc(100dvh-var(--spacing-topbar)-2rem)] lg:overflow-y-auto" aria-label="דירוג וסינון">
        {data.offers.length > 0 ? side : <p className="text-sm text-fg-muted">אין הצעות לדירוג או לסינון.</p>}
      </aside>

      <div className="flex min-w-0 flex-col gap-4">
        <p role="status" aria-live="polite" className="sr-only">
          {ranked.isFetching ? 'מעדכנים דירוג…' : `${countText}${filterCount ? `, מוצגות ${visible.length} אחרי סינון` : ''}`}
        </p>

        {data.status === 'failed' && (
          <Callout tone="danger" title="החיפוש לא החזיר תוצאות מאף ספק" role="alert">
            כל הספקים שנבדקו נכשלו או אינם מחוברים. פירוט בכרטיסי הספקים למטה.
          </Callout>
        )}
        {data.status === 'partial' && (
          <Callout tone="warn" title="חלק מהספקים לא ענו">
            התוצאות חלקיות — ייתכנו הצעות נוספות אצל ספקים שלא ענו. פירוט בכרטיסי הספקים למטה.
          </Callout>
        )}
        {data.has_demo_results && (
          <Callout tone="neutral" title="חלק מהתוצאות הן נתוני הדגמה">
            הצעות המסומנות "הדגמה" הן נתונים סינתטיים: זה לא מחיר אמיתי, לא זמינות אמיתית, ואי אפשר להזמין אותן.
            {data.has_live_results ? ' ההצעות המסומנות "חי" הן מספקים אמיתיים.' : ''}
          </Callout>
        )}
        <Callout tone="info" title="כיסוי החיפוש">
          {data.coverage_note}
        </Callout>

        <ProviderStatusStrip providers={data.providers} />

        {rerankFailed && (
          <ErrorState
            compact
            title="לא ניתן היה לחשב דירוג מותאם"
            error={ranked.error}
            onRetry={() => void ranked.refetch()}
            retrying={ranked.isFetching}
          />
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <div>
            <h2 className="text-base font-bold text-fg" data-testid="result-count">
              {countText}
            </h2>
            {filterCount > 0 && data.offers.length > 0 && (
              <p className="text-xs text-fg-muted">
                מוצגות {visible.length} אחרי סינון ·{' '}
                <button type="button" className="font-medium text-accent underline-offset-4 hover:underline" onClick={() => setFiltersState(EMPTY_FILTERS)}>
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
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="md" className="lg:hidden" leadingIcon={<SlidersHorizontal aria-hidden="true" />} onClick={() => setPanelOpen(true)}>
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

        <div className={cn('flex flex-col gap-4 transition-opacity', ranked.isFetching && 'opacity-60')} aria-busy={ranked.isFetching}>
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
                <Button variant="secondary" size="sm" onClick={() => setFiltersState(EMPTY_FILTERS)}>
                  ניקוי מסננים
                </Button>
              }
            />
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

        <p className="text-xs leading-relaxed text-fg-subtle">
          הציונים והדירוג נועדו לעזור למיין. המחיר הסופי ותנאי ההזמנה נקבעים אצל הספק.{' '}
          <Link to="/help" className="font-medium text-accent underline-offset-4 hover:underline">
            איך מחושב הציון?
          </Link>
        </p>
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
