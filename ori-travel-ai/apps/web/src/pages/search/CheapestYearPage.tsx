import { CalendarRange, ScanSearch } from 'lucide-react';
import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Button, Callout, Card, ErrorState, PageHeader, Skeleton } from '@/components/ui';
import { buildRoute, LazyRouteMap } from '@/features/route-map';
import { useAirportIndex, useFlightPlaces, usePlaceName } from '@/features/search/airportsApi';
import { PlaceCombobox, SelectField } from '@/features/search/components/formControls';
import { useRunSearch } from '@/features/search/hooks';
import {
  CheapestDays,
  CheapestTicket,
  cheapestCell,
  cheapestDays,
  savingVsAverage,
  useYearScan,
  YearHeatmap,
} from '@/features/year-scan';
import type { FareCell, YearScanRequest } from '@/lib/schemas/calendar';
import type { CanonicalOffer } from '@/lib/schemas/offers';

const NIGHT_OPTIONS = [
  { value: '0', label: 'כיוון אחד' },
  ...Array.from({ length: 30 }, (_, i) => ({
    value: String(i + 1),
    label: i === 0 ? 'לילה אחד' : `${i + 1} לילות`,
  })),
];
const ADULT_OPTIONS = Array.from({ length: 9 }, (_, i) => ({
  value: String(i + 1),
  label: i === 0 ? 'מבוגר אחד' : `${i + 1} מבוגרים`,
}));
const IATA = /^[A-Z]{3}$/;

function requestFromParams(p: URLSearchParams): YearScanRequest | null {
  const origin = (p.get('from') ?? '').toUpperCase();
  const destination = (p.get('to') ?? '').toUpperCase();
  const nights = Number(p.get('nights') ?? '4');
  const adults = Number(p.get('adults') ?? '2');
  if (!IATA.test(origin) || !IATA.test(destination) || origin === destination) return null;
  if (!Number.isInteger(nights) || nights < 0 || nights > 30 || !Number.isInteger(adults) || adults < 1 || adults > 9)
    return null;
  return {
    origin,
    destination,
    nights: nights || null,
    adults,
    children_ages: [],
    cabin: 'economy',
    currency: 'ILS',
  };
}

function cheapestOffer(offers: readonly CanonicalOffer[]): CanonicalOffer | null {
  let best: CanonicalOffer | null = null;
  for (const o of offers) if (!best || Number(o.price.total.amount) < Number(best.price.total.amount)) best = o;
  return best;
}

/**
 * "Cheapest flight of the year": pick a destination and a trip length, the server checks every depart date of the
 * coming year (DEMO providers + cached real results only), and the page shows the year as a heatmap, the cheapest
 * day as a ticket with the saving vs. the average, the route map, and a link to check the real price.
 */
export default function CheapestYearPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const request = useMemo(() => requestFromParams(params), [params]);

  const [origin, setOrigin] = useState(request?.origin ?? 'TLV');
  const [destination, setDestination] = useState(request?.destination ?? '');
  const [nights, setNights] = useState(String(request ? (request.nights ?? 0) : 4));
  const [adults, setAdults] = useState(String(request?.adults ?? 2));
  const [formError, setFormError] = useState<string | null>(null);

  const places = useFlightPlaces();
  const placeName = usePlaceName();
  const airports = useAirportIndex();
  const scan = useYearScan(request);
  const data = scan.data;
  const best = useMemo(() => (data ? cheapestCell(data) : null), [data]);
  const saving = useMemo(() => (data ? savingVsAverage(data) : null), [data]);
  const topDays = useMemo(() => (data ? cheapestDays(data, 10) : []), [data]);

  // Normal search for the cheapest day: real offer facts (airline, time, stops) for the ticket + the route map.
  const bestSearch = useRunSearch('flight');
  const daySearch = useRunSearch('flight');
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const bestKey = data && best ? `${data.generated_at}|${best.depart_date}` : null;
  const searchedKey = useRef<string | null>(null);

  const searchBody = (cell: FareCell) => ({
    origin: request?.origin,
    destination: request?.destination,
    depart_date: cell.depart_date,
    return_date: cell.return_date ?? null,
    adults: request?.adults ?? 1,
    children_ages: [],
    cabin: 'economy',
    currency: 'ILS',
  });

  useEffect(() => {
    if (!bestKey || !best || bestKey === searchedKey.current) return;
    searchedKey.current = bestKey;
    bestSearch.mutate(searchBody(best));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestKey]);

  const offer = bestSearch.data ? cheapestOffer(bestSearch.data.offers) : null;
  const route = useMemo(() => (offer ? buildRoute(offer, airports) : null), [offer, airports]);

  const openDay = (cell: FareCell) => {
    if (best && cell.depart_date === best.depart_date && bestSearch.data) {
      navigate(`/search/flights?search_id=${encodeURIComponent(bestSearch.data.search_id)}`);
      return;
    }
    setPendingDate(cell.depart_date);
    daySearch.mutate(searchBody(cell), {
      onSuccess: (res) => navigate(`/search/flights?search_id=${encodeURIComponent(res.search_id)}`),
      onSettled: () => setPendingDate(null),
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const o = origin.trim().toUpperCase();
    const d = destination.trim().toUpperCase();
    if (!IATA.test(o)) return setFormError('יש לבחור שדה תעופה למוצא מהרשימה');
    if (!IATA.test(d)) return setFormError('יש לבחור יעד מהרשימה');
    if (o === d) return setFormError('המוצא והיעד חייבים להיות שונים');
    setFormError(null);
    setParams({ from: o, to: d, nights, adults });
  };

  const cityOf = (code: string) => placeName(code) ?? code;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="הטיסה הזולה בשנה"
        description="בוחרים יעד ומספר לילות, והמערכת בודקת כל יום יציאה בשנה הקרובה ומוצאת את הזול ביותר."
        icon={<CalendarRange />}
      />

      <Card>
        <form onSubmit={onSubmit} noValidate aria-label="סריקת השנה" className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto] lg:items-end">
            <PlaceCombobox label="מוצא" value={origin} onChange={setOrigin} places={places} required />
            <PlaceCombobox
              label="יעד"
              value={destination}
              onChange={setDestination}
              places={places}
              required
              placeholder="לאן טסים?"
            />
            <SelectField label="לילות" value={nights} onChange={setNights} options={NIGHT_OPTIONS} />
            <SelectField label="נוסעים" value={adults} onChange={setAdults} options={ADULT_OPTIONS} />
            <Button type="submit" leadingIcon={<ScanSearch />} loading={scan.isFetching} className="lg:mb-0.5">
              סריקת השנה הקרובה
            </Button>
          </div>
          {formError && (
            <p role="alert" className="text-sm font-medium text-coral-700">
              {formError}
            </p>
          )}
        </form>
      </Card>

      {!request && (
        <Callout tone="info" title="איך זה עובד?">
          המערכת בודקת כל יום יציאה בשנה הקרובה (בערך 360 ימים) ומציגה מפת חום של המחירים. הסריקה משתמשת רק בספקי הדגמה
          ובמחירים שמורים מחיפושים קודמים, ולא שואלת ספקים חיים, ולכן המחירים הם נתוני הדגמה. כדי לראות מחיר אמיתי אפשר
          לפתוח את אותם תאריכים ב-Google Flights.
        </Callout>
      )}

      {request && scan.isPending && (
        <Card className="flex flex-col gap-3" aria-busy="true">
          <p className="font-semibold text-fg">
            סורקים את השנה הקרובה: {cityOf(request.origin)} ← {cityOf(request.destination)}…
          </p>
          <Skeleton className="h-64 w-full" />
        </Card>
      )}

      {request && scan.isError && (
        <ErrorState
          error={scan.error}
          title="הסריקה לא הושלמה"
          onRetry={() => void scan.refetch()}
          retrying={scan.isFetching}
        />
      )}

      {data && request && (
        <>
          {best ? (
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
              <CheapestTicket
                origin={request.origin}
                destination={request.destination}
                originName={cityOf(request.origin)}
                destinationName={cityOf(request.destination)}
                nights={request.nights}
                cell={best}
                saving={saving}
                pricedDays={data.stats.priced}
                offer={offer}
                offerLoading={bestSearch.isPending}
                onOpenSearch={() => openDay(best)}
                openingSearch={pendingDate === best.depart_date}
              />
              {route ? (
                <Suspense fallback={<Skeleton className="h-80 w-full rounded-2xl" />}>
                  <LazyRouteMap route={route} subtitle={`${cityOf(request.origin)} – ${cityOf(request.destination)}`} />
                </Suspense>
              ) : (
                <Skeleton className="hidden h-80 w-full rounded-2xl lg:block" />
              )}
            </div>
          ) : (
            <Callout tone="warn" title="לא נמצאו מחירים בשנה הקרובה">
              הספקים שנבדקו לא החזירו מחירים למסלול הזה. נסו יעד אחר או חיפוש רגיל.
            </Callout>
          )}

          <Card>
            <YearHeatmap
              key={data.generated_at ?? ''}
              scan={data}
              bestDate={best?.depart_date ?? null}
              onPickDay={openDay}
              disabled={pendingDate !== null}
            />
          </Card>

          {daySearch.isError && <ErrorState error={daySearch.error} title="החיפוש לתאריך שנבחר נכשל" compact />}

          <CheapestDays days={topDays} onPick={openDay} pendingDate={pendingDate} />

          <p className="text-xs leading-relaxed text-fg-muted" data-testid="year-coverage">
            {data.coverage_note}
          </p>
        </>
      )}
    </div>
  );
}
