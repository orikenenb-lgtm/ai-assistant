import { ArrowDownUp, ArrowUp, CircleCheck, CircleHelp, CircleX, Luggage, MapPin } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button, DateText, FreshnessText, ModeBadge, MoneyText } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import type { Category } from '@/lib/schemas/common';
import type { CanonicalOffer, FlightSlice } from '@/lib/schemas/offers';
import { stopsLabel } from '../labels';
import { cancellationKind } from './CancellationSummary';
import { CompareToggle } from './CompareToggle';
import { dayOffset, sliceTitle } from './FlightItinerary';
import { offerFacts } from './OfferFacts';
import { unitPrices } from './PriceBreakdown';

export type TableSortKey = 'price' | 'duration';

export interface OfferTableProps {
  offers: CanonicalOffer[];
  category: Category;
  /** Table caption (screen readers; also the accessible name of the table). */
  caption: string;
  /** Current sort of the list (column headers reflect it with aria-sort). */
  sort?: string;
  onSort?: (key: TableSortKey) => void;
  onOpenDetails: (offer: CanonicalOffer) => void;
  /** Id of the featured (cheapest-in-search) offer — marked in its row. */
  featuredId?: string | null;
  /** Flights: show the route of an offer on the map. */
  onShowOnMap?: (offer: CanonicalOffer) => void;
  mapOfferId?: string | null;
  className?: string;
}

const TH = 'whitespace-nowrap px-2.5 py-2.5 text-start text-xs font-semibold text-fg-muted';
const TD = 'px-2.5 py-3 align-top text-sm text-fg';

function SortHeader({
  label,
  sortKey,
  sort,
  onSort,
  hint,
}: {
  label: string;
  sortKey: TableSortKey;
  sort?: string;
  onSort?: (k: TableSortKey) => void;
  hint: string;
}) {
  const active = sort === sortKey;
  if (!onSort) return <>{label}</>;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={cn('-mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-ink-50 hover:text-fg', active && 'text-fg')}
    >
      {label}
      <span className="sr-only"> — {hint}</span>
      {active ? <ArrowUp className="size-3.5" aria-hidden="true" /> : <ArrowDownUp className="size-3.5 opacity-60" aria-hidden="true" />}
    </button>
  );
}

function SliceLine({ slice, title }: { slice: FlightSlice; title: string }) {
  const offset = dayOffset(slice.departing_at, slice.arriving_at);
  const via = slice.segments.slice(0, -1).map((s) => s.destination);
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="w-8 shrink-0 text-2xs font-medium text-fg-subtle">{title}</span>
      <span className="inline-flex items-baseline gap-1 font-semibold tabular-nums" dir="ltr">
        <DateText value={slice.departing_at} preset="time" timeZone="source" />
        <span className="text-fg-subtle" aria-hidden="true">
          →
        </span>
        <DateText value={slice.arriving_at} preset="time" timeZone="source" />
        {offset > 0 && (
          <sup className="text-2xs font-medium text-amber-700" title={`נחיתה ${offset === 1 ? 'למחרת' : `${offset} ימים אחרי`}`}>
            +{offset}
          </sup>
        )}
      </span>
      <span className="text-xs text-fg-muted">
        <DateText value={slice.departing_at} preset="date-short" timeZone="source" /> · {stopsLabel(slice.stops)}
        {via.length > 0 && (
          <>
            {' '}
            (<span dir="ltr">{via.join(', ')}</span>)
          </>
        )}{' '}
        · {formatDuration(slice.duration_minutes)}
      </span>
    </div>
  );
}

function CancellationCell({ offer }: { offer: CanonicalOffer }) {
  const kind = cancellationKind(offer.cancellation);
  const map: Record<typeof kind, { icon: ReactNode; text: ReactNode; cls: string }> = {
    free: {
      icon: <CircleCheck className="size-4 shrink-0" aria-hidden="true" />,
      text: (
        <>
          ביטול חינם
          <span className="block font-normal text-fg-muted">
            עד <DateText value={offer.cancellation.free_cancellation_until} preset="date-short" timeZone="source" />
          </span>
        </>
      ),
      cls: 'text-moss-700',
    },
    refundable: { icon: <CircleCheck className="size-4 shrink-0" aria-hidden="true" />, text: 'ניתן להחזר', cls: 'text-moss-700' },
    nonrefundable: { icon: <CircleX className="size-4 shrink-0" aria-hidden="true" />, text: 'ללא החזר', cls: 'text-coral-700' },
    unknown: { icon: <CircleHelp className="size-4 shrink-0" aria-hidden="true" />, text: 'לא ידוע', cls: 'text-fg-muted' },
  };
  const m = map[kind];
  return (
    <span className={cn('inline-flex items-start gap-1 whitespace-nowrap text-xs font-medium', m.cls)}>
      {m.icon}
      <span>{m.text}</span>
    </span>
  );
}

function BaggageCell({ offer }: { offer: CanonicalOffer }) {
  if (offer.details.kind !== 'flight') return null;
  const b = offer.details.baggage;
  const checked = b.checked_included;
  const carry = b.carry_on_included;
  const extra = [
    checked && checked > 0 && b.checked_bag_weight_kg ? `${b.checked_bag_weight_kg} ק״ג` : null,
    carry == null ? 'טרולי: לא ידוע' : carry > 0 ? 'טרולי' : 'ללא טרולי',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div className="flex flex-col gap-0.5 whitespace-nowrap text-xs">
      <span className={cn('inline-flex items-center gap-1 font-medium', checked && checked > 0 ? 'text-moss-700' : 'text-fg-muted')}>
        <Luggage className="size-3.5 shrink-0" aria-hidden="true" />
        {checked == null ? 'מזוודה: לא ידוע' : checked > 0 ? (checked === 1 ? 'מזוודה לבטן' : `${checked} מזוודות לבטן`) : 'ללא מזוודה לבטן'}
      </span>
      <span className="ps-[1.125rem] text-fg-muted">{extra}</span>
    </div>
  );
}

function unitPrice(offer: CanonicalOffer) {
  const units = unitPrices(offer.price);
  return units.find((u) => u.key === 'person') ?? units[0] ?? null;
}

/**
 * Semantic comparison table of offers (desktop). Every value is read from the offer itself; the featured offer is
 * marked with text, not colour alone. Flights get itinerary/baggage columns; other categories get key facts.
 */
export function OfferTable({
  offers,
  category,
  caption,
  sort,
  onSort,
  onOpenDetails,
  featuredId,
  onShowOnMap,
  mapOfferId,
  className,
}: OfferTableProps) {
  const flight = category === 'flight';
  const ariaSort = (key: TableSortKey) => (sort === key ? ('ascending' as const) : undefined);
  return (
    <div className={cn('scrollbar-thin w-full max-w-full overflow-x-auto rounded-xl border border-line bg-surface shadow-xs', className)}>
      <table className="w-full min-w-[60rem] border-collapse" data-testid="results-table" data-category={category}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-surface-sunken">
            <th scope="col" className={TH}>
              {flight ? 'חברה וספק' : 'הצעה'}
            </th>
            <th scope="col" className={TH} aria-sort={flight ? ariaSort('duration') : undefined}>
              {flight ? <SortHeader label="מסלול" sortKey="duration" sort={sort} onSort={onSort} hint="מיון לפי משך הטיסה" /> : 'פרטים עיקריים'}
            </th>
            <th scope="col" className={TH} aria-sort={ariaSort('price')}>
              <SortHeader label="סה״כ" sortKey="price" sort={sort} onSort={onSort} hint="מיון לפי מחיר" />
            </th>
            <th scope="col" className={TH}>
              {flight ? 'לנוסע' : 'ליחידה'}
            </th>
            {flight && (
              <th scope="col" className={TH}>
                כבודה
              </th>
            )}
            <th scope="col" className={TH}>
              ביטול
            </th>
            <th scope="col" className={TH}>
              נבדק
            </th>
            <th scope="col" className={TH}>
              מקור
            </th>
            <th scope="col" className={TH}>
              <span className="sr-only">פעולות</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const featured = o.id === featuredId;
            const unit = unitPrice(o);
            const d = o.details;
            return (
              <tr
                key={o.id}
                data-offer-id={o.id}
                data-featured={featured || undefined}
                className={cn('border-b border-line last:border-b-0 transition-colors', featured ? 'bg-deal-soft' : 'hover:bg-surface-sunken/60')}
              >
                <th scope="row" className={cn(TD, 'min-w-36 max-w-48 text-start font-normal')}>
                  {featured && (
                    <span className="mb-1 inline-flex items-center rounded-full bg-deal-strong px-2 py-0.5 text-2xs font-semibold text-white">
                      הזול בחיפוש
                    </span>
                  )}
                  <span className="block font-semibold leading-snug text-fg">
                    {d.kind === 'flight'
                      ? [...new Set(d.slices.flatMap((s) => s.segments.map((g) => g.carrier_name)))].join(' · ') || o.title
                      : o.title}
                  </span>
                  <span className="block text-xs text-fg-muted">
                    {d.kind === 'flight' && d.fare_brand ? `${d.fare_brand} · ` : o.subtitle && d.kind !== 'flight' ? `${o.subtitle} · ` : ''}
                    {o.source.provider_name}
                  </span>
                  {o.score?.rank != null && <span className="block text-2xs text-fg-subtle">מקום {o.score.rank} בדירוג</span>}
                </th>
                <td className={cn(TD, 'min-w-56')}>
                  {d.kind === 'flight' ? (
                    <div className="flex flex-col gap-1.5">
                      {d.slices.map((s, i) => (
                        <SliceLine key={`${s.origin}-${i}`} slice={s} title={sliceTitle(i, d.slices.length)} />
                      ))}
                    </div>
                  ) : (
                    <ul className="flex flex-col gap-0.5 text-xs text-fg-muted">
                      {offerFacts(o)
                        .slice(0, 3)
                        .map((f) => (
                          <li key={f.key}>{f.value}</li>
                        ))}
                    </ul>
                  )}
                </td>
                <td className={cn(TD, 'whitespace-nowrap')}>
                  <MoneyText
                    value={o.price.total}
                    estimated={o.price.total_status === 'estimated'}
                    className={cn('text-base font-bold', featured ? 'text-deal' : 'text-fg')}
                  />
                  {o.price.total_status === 'estimated' && <span className="block text-2xs text-amber-700">משוער</span>}
                </td>
                <td className={cn(TD, 'whitespace-nowrap')}>
                  {unit ? (
                    <>
                      <MoneyText value={unit.value} className="font-medium" />
                      {!flight && <span className="block text-2xs text-fg-subtle">{unit.label}</span>}
                    </>
                  ) : (
                    <span className="text-fg-subtle">—</span>
                  )}
                </td>
                {flight && (
                  <td className={TD}>
                    <BaggageCell offer={o} />
                  </td>
                )}
                <td className={TD}>
                  <CancellationCell offer={o} />
                </td>
                <td className={cn(TD, 'whitespace-nowrap text-xs text-fg-muted')}>
                  <FreshnessText value={o.source.fetched_at} prefix="" />
                </td>
                <td className={TD}>
                  <ModeBadge mode={o.source.mode} size="sm" showTooltip={false} />
                </td>
                <td className={cn(TD, 'whitespace-nowrap')}>
                  <div className="flex items-center justify-end gap-1.5">
                    {onShowOnMap && d.kind === 'flight' && (
                      <button
                        type="button"
                        aria-pressed={mapOfferId === o.id}
                        onClick={() => onShowOnMap(o)}
                        aria-label={`הצגת המסלול במפה: ${o.title}`}
                        title="הצגת המסלול במפה"
                        className={cn(
                          'grid size-8 place-items-center rounded-md border transition-colors',
                          mapOfferId === o.id
                            ? 'border-sky-500 bg-sky-50 text-sky-700'
                            : 'border-line text-fg-muted hover:bg-surface-sunken hover:text-fg',
                        )}
                      >
                        <MapPin className="size-4" aria-hidden="true" />
                      </button>
                    )}
                    <CompareToggle offerId={o.id} compact />
                    <Button size="sm" variant="primary" onClick={() => onOpenDetails(o)} aria-label={`פרטים: ${o.title}`}>
                      פרטים
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
