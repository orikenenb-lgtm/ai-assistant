import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FareCalendarRequest } from '@/lib/schemas/calendar';
import { createFetchMock, errorResponse, jsonResponse, renderWithProviders } from '@/test/utils';
import { calendarResponse, calendarSearchParams } from '../testFixtures';
import { FareCalendar } from './FareCalendar';

function mockViewport(desktop: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation(
    (query: string) =>
      ({
        matches: desktop && query === '(min-width: 768px)',
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

function stubCalendar(respond?: (req: FareCalendarRequest) => Response) {
  const requests: FareCalendarRequest[] = [];
  const fetchMock = createFetchMock({
    'POST /api/search/flight/calendar': (init) => {
      const req = JSON.parse(String(init.body)) as FareCalendarRequest;
      requests.push(req);
      return respond ? respond(req) : jsonResponse(calendarResponse(req));
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return requests;
}

const cells = () => screen.getAllByTestId('fare-cell');
const cellFor = (date: string, nights = '5') => cells().find((c) => c.dataset.date === date && c.dataset.nights === nights)!;

describe('FareCalendar', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T10:00:00'));
    try {
      window.localStorage.clear();
    } catch {
      /* ignore */
    }
  });
  afterEach(() => vi.useRealTimers());

  it('renders the month with every state, legend, DEMO badge and honest notes (desktop grid)', async () => {
    mockViewport(true);
    const requests = stubCalendar();
    renderWithProviders(
      <FareCalendar params={calendarSearchParams} onSelect={() => {}} pageCoverageNote="אין התחייבות לכיסוי מלא של השוק — ייתכנו מחירים ואפשרויות נוספים אצל ספקים אחרים." />,
    );
    const cal = screen.getByTestId('fare-calendar');
    await waitFor(() => expect(cal).toHaveAttribute('data-state', 'ready'));
    expect(requests[0]).toMatchObject({ origin: 'TLV', destination: 'FCO', depart_from: '2026-12-01', depart_to: '2026-12-31', trip_nights: [5], adults: 2, children_ages: [7] });

    expect(within(cal).getByRole('grid')).toBeInTheDocument();
    expect(within(cal).getAllByRole('columnheader')).toHaveLength(7);
    expect(cells()).toHaveLength(31);
    expect(cellFor('2026-12-03')).toHaveAttribute('data-status', 'priced');
    expect(cellFor('2026-12-03')).toHaveAttribute('data-tier', 'best');
    expect(cellFor('2026-12-06')).toHaveAttribute('data-status', 'no_offers');
    expect(cellFor('2026-12-06')).toHaveTextContent('אין טיסות');
    expect(cellFor('2026-12-07')).toHaveAttribute('data-status', 'not_searched');
    expect(cellFor('2026-12-07')).toHaveTextContent('לא נבדק');
    expect(cellFor('2026-12-08')).toHaveAttribute('data-status', 'error');
    expect(cellFor('2026-12-08')).toHaveTextContent('!');
    // Best cell: price text + a visible marker + tier in the accessible name.
    expect(cellFor('2026-12-03').textContent?.replace(/[‎‏]/g, '')).toContain('2,100');
    expect(cellFor('2026-12-03').getAttribute('aria-label')).toContain('המחיר הנמוך ביותר בלוח');
    // Current search dates are marked.
    expect(cellFor('2026-12-10')).toHaveAttribute('aria-current', 'date');

    const legend = screen.getByTestId('fare-legend');
    for (const label of ['המחיר הנמוך בלוח', 'נמוך', 'בינוני', 'גבוה', 'אין טיסות', 'לא נבדק', 'שגיאה בבדיקה', 'החיפוש הנוכחי']) {
      expect(within(legend).getByText(label)).toBeInTheDocument();
    }
    expect(within(cal).getAllByText('הדגמה').length).toBeGreaterThan(0);
    // Coverage note shown once on the page: the repeated sentence is dropped, the calendar-specific one kept.
    const coverage = screen.getByTestId('fare-coverage');
    expect(coverage).toHaveTextContent('המחירים בלוח מבוססים על ספקי הדגמה.');
    expect(coverage).not.toHaveTextContent('אין התחייבות לכיסוי מלא');
  });

  it('roving tabindex + arrow keys (RTL) and Enter selects the focused dates', async () => {
    mockViewport(true);
    stubCalendar();
    const onSelect = vi.fn();
    const user = userEvent.setup({ advanceTimers: () => {} });
    renderWithProviders(<FareCalendar params={calendarSearchParams} onSelect={onSelect} />);
    await waitFor(() => expect(screen.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready'));

    // Exactly one cell is in the tab order: the searched date.
    const tabbable = cells().filter((c) => c.tabIndex === 0);
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0].dataset.date).toBe('2026-12-10');

    tabbable[0].focus();
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(cellFor('2026-12-11'));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(cellFor('2026-12-18'));
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cellFor('2026-12-17'));
    expect(cellFor('2026-12-17').tabIndex).toBe(0);
    expect(cellFor('2026-12-10').tabIndex).toBe(-1);
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith({ depart_date: '2026-12-17', return_date: '2026-12-22', nights: 5 });

    // The details line shows the exact amount of the focused cell.
    expect(screen.getByTestId('fare-cell-details').textContent?.replace(/[‎‏]/g, '')).toContain('2,575.50');
  });

  it('switches to the depart × nights matrix (7×7) and back', async () => {
    mockViewport(true);
    const requests = stubCalendar();
    const user = userEvent.setup({ advanceTimers: () => {} });
    renderWithProviders(<FareCalendar params={calendarSearchParams} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready'));

    await user.click(screen.getByRole('radio', { name: 'מטריצת לילות' }));
    await waitFor(() => expect(screen.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready'));
    expect(screen.getByTestId('fare-calendar')).toHaveAttribute('data-view', 'matrix');
    expect(requests.at(-1)).toMatchObject({ depart_from: '2026-12-07', depart_to: '2026-12-13', trip_nights: [2, 3, 4, 5, 6, 7, 8] });
    expect(cells()).toHaveLength(49);
    expect(screen.getAllByRole('rowheader').map((r) => r.textContent)).toEqual(['2 לילות', '3 לילות', '4 לילות', '5 לילות', '6 לילות', '7 לילות', '8 לילות']);
    expect(cellFor('2026-12-10', '5')).toHaveAttribute('aria-current', 'date');

    await user.click(screen.getByRole('button', { name: '7 ימים מאוחר יותר' }));
    await waitFor(() => expect(requests.at(-1)).toMatchObject({ depart_from: '2026-12-14', depart_to: '2026-12-20' }));
  });

  it('phones get a swipeable week strip with previous/next week buttons', async () => {
    mockViewport(false);
    stubCalendar();
    renderWithProviders(<FareCalendar params={calendarSearchParams} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready'));
    expect(screen.getByTestId('fare-strip')).toHaveClass('snap-x');
    expect(screen.getByRole('button', { name: 'השבוע הקודם' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'השבוע הבא' })).toBeInTheDocument();
    expect(cells()).toHaveLength(31);
  });

  it('one-way searches disable the matrix', async () => {
    mockViewport(true);
    const requests = stubCalendar();
    renderWithProviders(<FareCalendar params={{ ...calendarSearchParams, return_date: null }} onSelect={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('fare-calendar')).toHaveAttribute('data-state', 'ready'));
    expect(screen.getByRole('radio', { name: 'מטריצת לילות' })).toBeDisabled();
    expect(requests[0].trip_nights).toEqual([]);
    expect(cellFor('2026-12-03', '')).toHaveAttribute('data-status', 'priced');
  });

  it('shows honest states when the endpoint is missing or rate limited', async () => {
    mockViewport(true);
    stubCalendar(() => errorResponse(404, 'NOT_FOUND', 'הנתיב לא נמצא'));
    const { unmount } = renderWithProviders(<FareCalendar params={calendarSearchParams} onSelect={() => {}} />);
    expect(await screen.findByText('לוח המחירים עדיין לא זמין בשרת')).toBeInTheDocument();
    unmount();

    stubCalendar(() => errorResponse(429, 'RATE_LIMITED', 'יותר מדי בקשות ללוח המחירים'));
    renderWithProviders(<FareCalendar params={calendarSearchParams} onSelect={() => {}} />);
    expect(await screen.findByText('הגעתם למגבלת הבדיקות של לוח המחירים')).toBeInTheDocument();
    expect(screen.getByText(/יותר מדי בקשות ללוח המחירים/)).toBeInTheDocument();
  });
});
