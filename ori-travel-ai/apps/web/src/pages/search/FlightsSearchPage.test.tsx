import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { calendarResponse, calendarSearchParams } from '@/features/fare-calendar/testFixtures';
import { makeFlightOffer } from '@/features/offers/testFixtures';
import { CanonicalOfferSchema } from '@/lib/schemas/offers';
import type { FareCalendarRequest } from '@/lib/schemas/calendar';
import { createFetchMock, jsonResponse, renderRoutes, testSession } from '@/test/utils';
import FlightsSearchPage from './FlightsSearchPage';

const cheap = makeFlightOffer({ id: 'a1', amount: '1000.00', rank: 2 });
const withBag = CanonicalOfferSchema.parse({
  ...makeFlightOffer({ id: 'b2', amount: '1500.00', rank: 1 }),
  details: { ...makeFlightOffer().details, baggage: { personal_item: true, carry_on_included: 1, checked_included: 1, checked_bag_weight_kg: 23 } },
});

function searchResponse(id: string, params: Record<string, unknown>) {
  return {
    search_id: id,
    category: 'flight',
    status: 'completed',
    params,
    created_at: '2026-11-12T10:00:00Z',
    completed_at: '2026-11-12T10:00:02Z',
    providers: [{ provider_id: 'demo_skyline', provider_name: 'דמו סקייליין', mode: 'DEMO', status: 'OK', result_count: 2, duration_ms: 40 }],
    offers: [cheap, withBag],
    total_offers_before_dedupe: 2,
    weights: { cost: 40, convenience: 25, flexibility: 20, quality: 15 },
    coverage_note: 'אין התחייבות לכיסוי מלא של השוק — ייתכנו מחירים ואפשרויות נוספים אצל ספקים אחרים.',
    has_demo_results: true,
    has_live_results: false,
    highlights: {
      currency: 'ILS',
      cheapest_offer_id: 'a1',
      fastest_offer_id: 'a1',
      best_score_offer_id: 'b2',
      comparable_count: 2,
      note: 'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה (מטבע זהה) — לא בהכרח בכל השוק',
    },
  };
}

const airports = [
  {
    code: 'TLV',
    city_code: 'TLV',
    name_he: 'נמל התעופה בן גוריון',
    name_en: 'Ben Gurion',
    city_he: 'תל אביב',
    city_en: 'Tel Aviv',
    country_code: 'IL',
    lat: 32.0114,
    lon: 34.8867,
    timezone: 'Asia/Jerusalem',
  },
  {
    code: 'ATH',
    city_code: 'ATH',
    name_he: 'נמל התעופה אתונה',
    name_en: 'Athens',
    city_he: 'אתונה',
    city_en: 'Athens',
    country_code: 'GR',
    lat: 37.9364,
    lon: 23.9445,
    timezone: 'Europe/Athens',
  },
  {
    code: 'FCO',
    city_code: 'ROM',
    name_he: 'נמל התעופה פיומיצ׳ינו',
    name_en: 'Fiumicino',
    city_he: 'רומא',
    city_en: 'Rome',
    country_code: 'IT',
    lat: 41.8003,
    lon: 12.2389,
    timezone: 'Europe/Rome',
  },
];

function stub() {
  const searches: Array<Record<string, unknown>> = [];
  const calendars: FareCalendarRequest[] = [];
  const fetchMock = createFetchMock({
    'GET /api/auth/me': () => jsonResponse(testSession),
    'GET /api/geo/airports': () => jsonResponse(airports),
    'GET /api/search/s1': () => jsonResponse(searchResponse('s1', calendarSearchParams)),
    'POST /api/search/flight/calendar': (init) => {
      const req = JSON.parse(String(init.body)) as FareCalendarRequest;
      calendars.push(req);
      return jsonResponse(calendarResponse(req));
    },
    'POST /api/search/flight': (init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      searches.push(body);
      return jsonResponse(searchResponse('s2', { ...body, category: 'flight' }));
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return { searches, calendars };
}

function desktop() {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: query === '(min-width: 768px)',
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

describe('FlightsSearchPage (V6 fast comparison)', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00'));
    try {
      window.localStorage.clear();
      window.sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });
  afterEach(() => vi.useRealTimers());

  it('calendar cell → normal flight search for those dates → URL ?search_id= updated', async () => {
    desktop();
    const { searches } = stub();
    const user = userEvent.setup({ advanceTimers: () => {} });
    const { router } = renderRoutes([{ path: '/search/flights', element: <FlightsSearchPage /> }], {
      initialEntries: ['/search/flights?search_id=s1'],
    });

    const featured = await screen.findByTestId('featured-deal');
    expect(featured).toHaveAttribute('data-offer-id', 'a1');
    expect(within(featured).getByRole('heading', { name: 'הזול ביותר מבין ההצעות שנמצאו בחיפוש זה' })).toBeInTheDocument();
    expect(screen.getByTestId('search-summary')).toHaveTextContent('TLV');

    await waitFor(() => expect(screen.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready'));
    const cell = screen.getAllByTestId('fare-cell').find((c) => c.dataset.date === '2026-12-03')!;
    await user.click(cell);

    await waitFor(() => expect(searches).toHaveLength(1));
    expect(searches[0]).toEqual({
      origin: 'TLV',
      destination: 'FCO',
      depart_date: '2026-12-03',
      return_date: '2026-12-08',
      adults: 2,
      children_ages: [7],
      cabin: 'economy',
      max_stops: null,
      checked_bags: 0,
      currency: 'ILS',
    });
    await waitFor(() => expect(router.state.location.search).toBe('?search_id=s2'));
    await waitFor(() => expect(screen.getByTestId('search-results')).toHaveAttribute('data-search-id', 's2'));
    // The new search becomes the calendar's "current" cell; the results heading receives focus.
    await waitFor(() =>
      expect(screen.getAllByTestId('fare-cell').find((c) => c.dataset.date === '2026-12-03')).toHaveAttribute('aria-current', 'date'),
    );
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('result-count')));
  });

  it('list ⇄ table toggle and the "כולל מזוודה לבטן" filter (featured follows the filters)', async () => {
    desktop();
    stub();
    const user = userEvent.setup({ advanceTimers: () => {} });
    renderRoutes([{ path: '/search/flights', element: <FlightsSearchPage /> }], { initialEntries: ['/search/flights?search_id=s1'] });

    expect(await screen.findAllByTestId('offer-card')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: 'טבלה' }));
    const table = screen.getByTestId('results-table');
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(screen.queryAllByTestId('offer-card')).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: /^דירוג וסינון/ }));
    const drawer = await screen.findByRole('dialog', { name: 'דירוג וסינון' });
    await user.click(within(drawer).getByRole('checkbox', { name: /כולל מזוודה לבטן/ }));
    await user.click(within(drawer).getByRole('button', { name: /^הצגת 1 הצעות/ }));

    expect(within(screen.getByTestId('results-table')).getAllByRole('row')).toHaveLength(2);
    const featured = screen.getByTestId('featured-deal');
    expect(featured).toHaveAttribute('data-offer-id', 'b2');
    expect(featured).toHaveTextContent('הזול ביותר מבין ההצעות שנמצאו בחיפוש זה ותואמות את המסננים');

    await user.click(screen.getByRole('button', { name: 'רשימה' }));
    expect(screen.getAllByTestId('offer-card')).toHaveLength(1);
  });
});
