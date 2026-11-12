import { ArrowLeft, BadgePercent, Search } from 'lucide-react';
import { useId, type ReactNode } from 'react';
import { DateText, FreshnessText, ModeBadge, MoneyText } from '@/components/ui';
import { StartBookingButton } from '@/features/bookings/components/StartBookingButton';
import { cn } from '@/lib/cn';
import { formatDuration } from '@/lib/format';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import { travellersCovered, type FeaturedPick } from '../featured';
import { stopsLabel } from '../labels';
import { baggageText, offerFacts } from './OfferFacts';
import { unitPrices } from './PriceBreakdown';

export interface FeaturedDealProps {
  pick: FeaturedPick;
  /** Opens the offer's details ("בדיקת ההצעה"). */
  onReview: (offer: CanonicalOffer) => void;
  /** Hebrew city name for an IATA code (route line); the code is shown when unknown. */
  placeName?: (code: string) => string | undefined;
  className?: string;
}

function Fact({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col', className)}>
      <dt className="text-2xs font-medium text-tangerine-800/80">{label}</dt>
      <dd className="min-w-0 text-sm font-medium text-fg">{children}</dd>
    </div>
  );
}

/** "סה״כ ל-3 נוסעים" — the count comes from the offer's own passenger breakdown. */
export function totalLabel(offer: CanonicalOffer): string {
  const n = travellersCovered(offer);
  if (!n) return offer.price.total_status === 'estimated' ? 'סה״כ משוער' : 'סה״כ ידוע';
  const who = offer.category === 'activity' ? (n === 1 ? 'משתתף אחד' : `${n} משתתפים`) : n === 1 ? 'נוסע אחד' : `${n} נוסעים`;
  return `סה״כ ל-${who}`;
}

/**
 * Emphasised "featured deal" panel (tangerine `deal` tokens): the cheapest offer AMONG THE OFFERS FOUND IN THIS SEARCH.
 * Large total, total vs. per-person, airline, route, dates, baggage, supplier, freshness and the data mode — all from
 * the offer itself. Never claims to be the cheapest flight in the market.
 */
export function FeaturedDeal({ pick, onReview, placeName, className }: FeaturedDealProps) {
  const { offer } = pick;
  const headingId = useId();
  const estimated = offer.price.total_status === 'estimated';
  const perPerson = offer.price.per_person;
  const otherUnits = unitPrices(offer.price).filter((u) => u.key !== 'person');
  const d = offer.details;
  const city = (code: string) => placeName?.(code) ?? code;

  return (
    <section
      aria-labelledby={headingId}
      data-testid="featured-deal"
      data-offer-id={offer.id}
      data-source={pick.source}
      className={cn(
        'relative flex flex-col gap-5 overflow-hidden rounded-2xl border border-deal-line bg-deal-soft p-5 shadow-sm sm:p-6',
        className,
      )}
    >
      <span aria-hidden="true" className="absolute inset-y-0 start-0 w-1.5 bg-deal-strong" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-deal-strong px-3 py-1 text-xs font-semibold text-white">
          <BadgePercent className="size-3.5" aria-hidden="true" />
          {pick.filtered ? 'הזול ביותר לפי המסננים' : 'המחיר הנמוך בחיפוש'}
        </span>
        <ModeBadge mode={offer.source.mode} size="sm" />
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-tangerine-800">
            {pick.filtered ? 'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה ותואמות את המסננים' : 'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה'}
          </h2>
          <p className="mt-1 text-base font-semibold leading-snug text-fg">{offer.title}</p>
          {offer.subtitle && <p className="text-sm text-fg-muted">{offer.subtitle}</p>}
        </div>
        <div className="flex shrink-0 flex-col sm:items-end sm:text-end">
          <p className="text-4xl font-extrabold leading-none tracking-tight text-deal sm:text-5xl" data-testid="featured-total">
            <MoneyText value={offer.price.total} estimated={estimated} />
          </p>
          <p className="mt-1.5 text-sm font-medium text-tangerine-800">{totalLabel(offer)}</p>
          {perPerson && (
            <p className="text-sm text-fg-muted" data-testid="featured-per-person">
              <MoneyText value={perPerson} className="font-semibold text-fg" /> לנוסע
            </p>
          )}
          {otherUnits.map((u) => (
            <p key={u.key} className="text-sm text-fg-muted">
              <MoneyText value={u.value} className="font-semibold text-fg" /> {u.label}
            </p>
          ))}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-5 gap-y-3 border-t border-deal-line pt-4 sm:grid-cols-3">
        {d.kind === 'flight' ? (
          <>
            <Fact label="חברת תעופה">{[...new Set(d.slices.flatMap((s) => s.segments.map((g) => g.carrier_name)))].join(' · ') || '—'}</Fact>
            {d.slices[0] && (
              <Fact label="מסלול">
                <span className="inline-flex flex-wrap items-center gap-1">
                  {city(d.slices[0].origin)}
                  <ArrowLeft className="size-3.5 ltr:rotate-180" aria-hidden="true" />
                  <span className="sr-only">אל</span>
                  {city(d.slices[0].destination)}
                  <span className="text-xs font-normal text-fg-muted" dir="ltr">
                    ({d.slices[0].origin}–{d.slices[0].destination})
                  </span>
                </span>
              </Fact>
            )}
            {d.slices[0] && (
              <Fact label={d.slices.length > 1 ? 'תאריכים' : 'תאריך'}>
                <DateText value={d.slices[0].departing_at} preset="date-short" timeZone="source" />
                {d.slices.length > 1 && (
                  <>
                    {' – '}
                    <DateText value={d.slices[d.slices.length - 1].departing_at} preset="date-short" timeZone="source" />
                  </>
                )}
              </Fact>
            )}
            {d.slices[0] && (
              <Fact label="עצירות ומשך (הלוך)">
                {stopsLabel(d.slices[0].stops)} · {formatDuration(d.slices[0].duration_minutes)}
              </Fact>
            )}
            <Fact label="כבודה">{baggageText(d.baggage).filter((t) => t !== 'תיק אישי').join(' · ')}</Fact>
          </>
        ) : (
          offerFacts(offer)
            .slice(0, 4)
            .map((f) => (
              <Fact key={f.key} label={f.label}>
                {f.value}
              </Fact>
            ))
        )}
        <Fact label="ספק">{offer.source.provider_name}</Fact>
        <Fact label="נבדק">
          <FreshnessText value={offer.source.fetched_at} prefix="" />
        </Fact>
      </dl>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-tangerine-800" data-testid="featured-note">
          {pick.note?.trim()}
          {pick.comparableCount > 1 && `${/[.!?]$/.test(pick.note?.trim() ?? '.') ? '' : '.'} הושוו ${pick.comparableCount} הצעות.`}
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onReview(offer)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-deal-strong px-4 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-deal active:bg-tangerine-800"
          >
            <Search className="size-4" aria-hidden="true" />
            בדיקת ההצעה
          </button>
          <StartBookingButton offerId={offer.id} size="md" />
        </div>
      </div>
    </section>
  );
}
