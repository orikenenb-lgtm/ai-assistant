import { ArrowLeft, ExternalLink, Plane, Search } from 'lucide-react';
import { useId } from 'react';
import { Button, ModeBadge, MoneyText, Spinner } from '@/components/ui';
import { stopsLabel } from '@/features/offers/labels';
import type { FareCell } from '@/lib/schemas/calendar';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import { googleFlightsUrl, weekdayDayMonth } from '../model';

export interface CheapestTicketProps {
  origin: string;
  destination: string;
  originName: string;
  destinationName: string;
  nights: number | null;
  cell: FareCell;
  /** Average minus cheapest (whole currency units), or null when not meaningful. */
  saving: number | null;
  /** Number of priced days the average is based on. */
  pricedDays: number;
  /** Cheapest offer of the normal search for this day (airline, time, stops) — null while loading / unavailable. */
  offer: CanonicalOffer | null;
  offerLoading: boolean;
  /** Opens the normal flight search for this day (offer details + booking preparation). */
  onOpenSearch: () => void;
  openingSearch: boolean;
}

function wholeMoney(amount: number, currency: string): string {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

function hhmm(iso: string): string {
  return iso.slice(11, 16);
}

/**
 * "Cheapest day of the year" ticket: route header, big price, dates, flight facts, saving vs. the average of the
 * scanned days, and two ways forward — the in-app search (DEMO) and a link to check the REAL price on Google Flights.
 */
export function CheapestTicket(props: CheapestTicketProps) {
  const { origin, destination, originName, destinationName, nights, cell, saving, pricedDays, offer } = props;
  const headingId = useId();
  const currency = cell.min_total?.currency ?? 'ILS';
  const slice = offer?.details.kind === 'flight' ? offer.details.slices[0] : undefined;
  const carriers =
    offer?.details.kind === 'flight'
      ? [...new Set(offer.details.slices.flatMap((s) => s.segments.map((g) => g.carrier_name)))].join(' · ')
      : '';
  const facts = [
    carriers,
    slice ? hhmm(slice.departing_at) : '',
    slice ? (slice.stops === 0 ? 'טיסה ישירה' : stopsLabel(slice.stops)) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const external = googleFlightsUrl({
    origin,
    destination,
    depart: cell.depart_date,
    ret: cell.return_date,
  });

  return (
    <section
      aria-labelledby={headingId}
      data-testid="cheapest-ticket"
      data-date={cell.depart_date}
      className="relative overflow-hidden rounded-3xl border border-deal-line bg-surface shadow-lg"
    >
      <header className="flex items-center justify-between gap-3 bg-deal-strong px-5 py-4 text-white sm:px-6">
        <h2 id={headingId} className="flex flex-wrap items-center gap-2 text-xl font-extrabold">
          {originName}
          <ArrowLeft className="size-5 ltr:rotate-180" aria-hidden="true" />
          <span className="sr-only">אל</span>
          {destinationName}
        </h2>
        <span className="flex items-center gap-1.5 text-sm font-semibold tracking-wide" dir="ltr">
          {origin}
          <Plane className="size-4" aria-hidden="true" />
          {destination}
        </span>
      </header>

      <div className="flex flex-col gap-5 px-5 pb-5 pt-5 sm:px-6">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-tangerine-800">
            הכי זול בשנה הקרובה{nights ? ` · ${nights} לילות` : ' · כיוון אחד'}
          </p>
          <ModeBadge mode={cell.mode ?? 'DEMO'} size="sm" />
        </div>

        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p
              className="text-5xl font-extrabold leading-none tracking-tight text-deal sm:text-6xl"
              data-testid="ticket-price"
            >
              <MoneyText value={cell.min_total} />
            </p>
            <p className="mt-2 text-sm text-fg-muted">
              סה״כ {cell.travelers && cell.travelers > 1 ? `ל-${cell.travelers} נוסעים` : 'לנוסע אחד'}
              {cell.per_person && cell.travelers && cell.travelers > 1 && (
                <>
                  {' · '}
                  <MoneyText value={cell.per_person} className="font-semibold text-fg" /> לנוסע
                </>
              )}
            </p>
            <p className="mt-3 text-lg font-bold text-fg" data-testid="ticket-dates">
              {weekdayDayMonth(cell.depart_date)}
              {cell.return_date && <> עד {weekdayDayMonth(cell.return_date)}</>}
            </p>
            <p className="min-h-5 text-sm text-fg-muted" data-testid="ticket-facts">
              {props.offerLoading ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner size="sm" decorative /> טוען פרטי טיסה…
                </span>
              ) : (
                facts || (cell.provider_name ? `ספק: ${cell.provider_name}` : '')
              )}
            </p>
          </div>

          {saving !== null && (
            <div
              data-testid="ticket-saving"
              className="flex size-28 shrink-0 flex-col items-center justify-center rounded-full bg-ink-900 text-center text-white shadow-md sm:size-32"
            >
              <span className="text-xs font-medium">חוסכים</span>
              <span className="text-xl font-extrabold leading-tight">{wholeMoney(saving, currency)}</span>
              <span className="text-[0.7rem] leading-tight">מול הממוצע</span>
            </div>
          )}
        </div>

        {/* Ticket perforation */}
        <div aria-hidden="true" className="relative -mx-5 sm:-mx-6">
          <span className="absolute -start-3 top-1/2 size-6 -translate-y-1/2 rounded-full border border-deal-line bg-canvas" />
          <span className="absolute -end-3 top-1/2 size-6 -translate-y-1/2 rounded-full border border-deal-line bg-canvas" />
          <div className="mx-5 border-t-2 border-dashed border-deal-line sm:mx-6" />
        </div>

        <div className="flex flex-col gap-2.5">
          <Button onClick={props.onOpenSearch} loading={props.openingSearch} leadingIcon={<Search />} fullWidth>
            פרטי הטיסה והכנת הזמנה (הדגמה)
          </Button>
          <a
            href={external}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="google-flights-link"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-deal-line bg-deal-soft px-4 text-sm font-semibold text-deal hover:bg-tangerine-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-deal"
          >
            בדיקת המחיר האמיתי ב-Google Flights
            <ExternalLink className="size-4" aria-hidden="true" />
            <span className="sr-only">(נפתח בלשונית חדשה)</span>
          </a>
          <p className="text-xs leading-relaxed text-fg-muted">
            המחיר כאן הוא <strong className="font-semibold">נתון הדגמה</strong>, ולא מחיר אמיתי.
            {saving !== null && ` החיסכון מחושב מול ממוצע ${pricedDays} הימים שנסרקו.`} ב-Google Flights יוצגו מחירים
            אמיתיים ועדכניים לאותם תאריכים, ושם צריך לבחור גם את מספר הנוסעים.
          </p>
        </div>
      </div>
    </section>
  );
}
