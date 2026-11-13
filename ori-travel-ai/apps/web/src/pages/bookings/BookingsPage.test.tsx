import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartBookingButton } from '@/features/bookings';
import { makeBooking } from '@/features/bookings/testFixtures';
import { makeFlightOffer } from '@/features/offers/testFixtures';
import { createFetchMock, jsonResponse, renderRoutes, testSession } from '@/test/utils';
import BookingsPage from './BookingsPage';

const offer = makeFlightOffer({ id: 'o1' });
const summary = {
  id: 'b9',
  state: 'READY_FOR_APPROVAL',
  state_label: 'ממתין לאישור',
  category: 'flight',
  title: 'תל אביב – אתונה',
  provider_id: 'demo_skyline',
  provider_name: 'דמו סקייליין',
  execution_mode: 'SIMULATION',
  is_simulation: true,
  current_price: { amount: '1000.00', currency: 'ILS' },
  price_changed: false,
  offer_expired: false,
  travelers_count: 2,
  supplier_reference: null,
  trip_id: null,
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:05:00Z',
};

function stub(extra: Record<string, () => Response> = {}, user: Record<string, unknown> = {}) {
  const fetchMock = createFetchMock({
    'GET /api/auth/me': () => jsonResponse({ ...testSession, user: { ...testSession.user, ...user } }),
    'GET /api/bookings': () => jsonResponse({ items: [summary], total: 1, page: 1, page_size: 20 }),
    'GET /api/saved-offers': () =>
      jsonResponse([{ id: 's1', offer_id: 'o1', category: 'flight', note: null, trip_id: null, is_expired: false, created_at: '2026-11-12T10:00:00Z', offer }]),
    'GET /api/family/members': () =>
      jsonResponse([
        { id: 'm1', display_name: 'אורי', age_group: 'adult', is_minor: false, has_traveler_profile: false },
        { id: 'm2', display_name: 'נועה', age_group: 'child', is_minor: true, has_traveler_profile: false },
      ]),
    'GET /api/trips': () => jsonResponse([]),
    ...extra,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const routes = [
  { path: '/bookings', element: <BookingsPage /> },
  { path: '/bookings/:bookingId', element: <h1>פרטי הזמנה</h1> },
];

describe('BookingsPage', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('lists bookings with state and simulation badges', async () => {
    stub();
    renderRoutes(routes, { initialEntries: ['/bookings'] });
    const row = await screen.findByRole('row', { name: /תל אביב – אתונה/ });
    expect(within(row).getByTestId('state-badge')).toHaveTextContent('ממתין לאישור');
    expect(within(row).getByTestId('simulation-badge')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'תל אביב – אתונה' })).toHaveAttribute('href', '/bookings/b9');
  });

  it('opens the start dialog from ?offer_id=, creates the booking with the chosen travelers and scenario, then opens the review', async () => {
    const fetchMock = stub({
      'POST /api/bookings': () => jsonResponse(makeBooking({ id: 'b9', state: 'QUOTE_SELECTED' }), { status: 201 }),
      'GET /api/bookings/b9': () => jsonResponse(makeBooking({ id: 'b9' })),
    });
    renderRoutes(routes, { initialEntries: ['/bookings?offer_id=o1'] });
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByTestId('selected-offer')).toHaveTextContent('תל אביב – אתונה');
    const create = within(dialog).getByRole('button', { name: 'יצירת הזמנה להכנה' });
    expect(create).toBeDisabled();
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /אורי/ }));
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /נועה/ }));
    await userEvent.selectOptions(within(dialog).getByLabelText('תרחיש סימולציה'), 'timeout_unknown');
    await userEvent.click(create);
    await screen.findByRole('heading', { name: 'פרטי הזמנה' });
    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST');
    expect(JSON.parse((post![1] as RequestInit).body as string)).toEqual({
      offer_id: 'o1',
      traveler_member_ids: ['m1', 'm2'],
      simulation_scenario: 'timeout_unknown',
    });
  });

  it('is view-only for viewers (no start button, no dialog even with ?offer_id=)', async () => {
    stub({}, { role: 'viewer', can_book: false });
    renderRoutes(routes, { initialEntries: ['/bookings?offer_id=o1'] });
    expect(await screen.findByTestId('read-only-note')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'הכנת הזמנה חדשה' })).toBeNull();
  });
});

describe('StartBookingButton', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('links to /bookings?offer_id=… for users who may book', async () => {
    stub();
    renderRoutes([{ path: '/', element: <StartBookingButton offerId="o 1" /> }]);
    expect(await screen.findByRole('link', { name: 'הכנת הזמנה' })).toHaveAttribute('href', '/bookings?offer_id=o%201');
  });
  it('renders nothing for viewers', async () => {
    stub({}, { role: 'viewer', can_book: false });
    renderRoutes([{ path: '/', element: <><h1>x</h1><StartBookingButton offerId="o1" /></> }]);
    await screen.findByRole('heading');
    expect(screen.queryByRole('link', { name: 'הכנת הזמנה' })).toBeNull();
  });
});
