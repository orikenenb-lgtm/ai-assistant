import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookingDetailPage from '@/pages/bookings/BookingDetailPage';
import { createFetchMock, errorResponse, jsonResponse, renderRoutes, testSession } from '@/test/utils';
import { approvedApproval, makeBooking } from '../testFixtures';
import type { Booking } from '@/lib/schemas/bookings';

const routes = [{ path: '/bookings/:bookingId', element: <BookingDetailPage /> }];
const REF = 'A1b2C3d4E5f6G7h8I9j0K1l2';
const DEMO_URL = `/demo-supplier/checkout?ref=${REF}`;
const AWAITING = 'ממתין להשלמה באתר הספק';

function waiting(over: Parameters<typeof makeBooking>[0] = {}): Booking {
  return makeBooking({
    execution_mode: 'HOSTED_CHECKOUT',
    is_simulation: false,
    is_demo: true,
    simulation_scenario: null,
    state: 'APPROVED',
    state_label: AWAITING,
    provider_id: 'demo_kidventures',
    provider_name: "דמו קידוונצ'רס",
    approval: approvedApproval,
    warnings: [`${AWAITING}. ההזמנה אינה מאושרת עד שתירשם כאן אסמכתת הספק.`],
    can: { open_checkout: true, record_confirmation: true, cancel: true, revalidate: true },
    ...over,
  });
}

function setup(booking: Booking, handlers: Record<string, (init: RequestInit & { url: string }) => Response | Promise<Response>> = {}, role: 'owner' | 'viewer' = 'owner') {
  const fetchMock = createFetchMock({
    'GET /api/auth/me': () => jsonResponse({ ...testSession, user: { ...testSession.user, role } }),
    'GET /api/bookings/b1': () => jsonResponse(booking),
    ...handlers,
  });
  vi.stubGlobal('fetch', fetchMock);
  return { ...renderRoutes(routes, { initialEntries: ['/bookings/b1'] }), fetchMock };
}

const link = (over: Record<string, unknown> = {}) =>
  jsonResponse({ url: DEMO_URL, provider_id: 'demo_kidventures', provider_name: "דמו קידוונצ'רס", instructions: 'הדגמה', warnings: ['DEMO — אין חיוב'], is_demo: true, ...over });

describe('hosted checkout (provider redirect) UI states', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it('APPROVED shows "waiting for completion on the supplier site" with the supplier, and never a confirmed booking', async () => {
    setup(waiting());
    const panel = await screen.findByTestId('awaiting-supplier-panel');
    expect(panel).toHaveTextContent(AWAITING);
    expect(panel).toHaveTextContent('ההזמנה עדיין לא בוצעה ואינה מאושרת');
    expect(panel).toHaveTextContent('DEMO, אין חיוב');
    expect(within(panel).getByTestId('awaiting-supplier-name')).toHaveTextContent("דמו קידוונצ'רס");
    expect(screen.getByTestId('execution-banner')).toHaveTextContent('הדגמה (DEMO) — ההזמנה תושלם בדף ספק לדוגמה; אין חיוב');
    expect(screen.getByTestId('state-badge')).toHaveTextContent(AWAITING);

    expect(screen.queryByTestId('confirmed-panel')).toBeNull();
    expect(screen.queryByTestId('supplier-reference')).toBeNull();
    expect(screen.queryByTestId('approved-note')).toBeNull();
    expect(screen.queryByTestId('submit-panel')).toBeNull();
    const text = screen.getByTestId('booking-review').textContent ?? '';
    for (const claim of ['ההזמנה אושרה', 'אושר על ידי הספק', 'אושר ע״י הספק', 'נרשמה אסמכת']) expect(text).not.toContain(claim);
    const steps = within(screen.getByTestId('booking-stepper')).getAllByRole('listitem');
    expect(steps[3]).toHaveAttribute('aria-current', 'step');
    expect(steps[3]).toHaveTextContent('ממתין לספק');
    expect(steps[5]).toHaveAttribute('data-status', 'todo');
  });

  it('a viewer sees the waiting state without any control', async () => {
    setup(waiting({ can: {} }), {}, 'viewer');
    expect(await screen.findByTestId('awaiting-supplier-panel')).toHaveTextContent(AWAITING);
    expect(screen.queryByRole('button', { name: /דף הספק לדוגמה/ })).toBeNull();
    expect(screen.queryByTestId('record-confirmation-form')).toBeNull();
    expect(screen.queryByTestId('confirmed-panel')).toBeNull();
  });

  it('opens only the in-app DEMO supplier page, in a new tab, after a POST', async () => {
    const { fetchMock } = setup(waiting(), { 'POST /api/bookings/b1/checkout-link': () => link() });
    await userEvent.click(await screen.findByRole('button', { name: 'מעבר לדף הספק לדוגמה (DEMO)' }));
    const a = await screen.findByTestId('checkout-open-link');
    expect(a).toHaveAttribute('href', DEMO_URL);
    expect(a).toHaveAttribute('data-internal', 'true');
    expect(a).toHaveAttribute('target', '_blank');
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('dialog')).toHaveTextContent('אין תשלום, אין חיוב ואין הזמנה אמיתית');
    const post = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/checkout-link') && (init as RequestInit).method === 'POST');
    expect(post).toBeTruthy();
    // still waiting — opening the supplier page confirms nothing
    expect(screen.queryByTestId('confirmed-panel')).toBeNull();
  });

  it.each([
    ['an external URL on a DEMO link', { url: 'https://evil.example/demo-supplier/checkout?ref=' + REF }],
    ['a protocol-relative URL', { url: '//evil.example/demo-supplier/checkout?ref=' + REF }],
    ['extra parameters', { url: DEMO_URL + '&next=https://evil.example' }],
    ['a relative URL on a non-DEMO link', { is_demo: false }],
  ])('refuses to render a link for %s', async (_name, over) => {
    setup(waiting(), { 'POST /api/bookings/b1/checkout-link': () => link(over) });
    await userEvent.click(await screen.findByRole('button', { name: 'מעבר לדף הספק לדוגמה (DEMO)' }));
    expect(await screen.findByText('הקישור שהתקבל אינו מאובטח ולכן לא ייפתח.')).toBeInTheDocument();
    expect(screen.queryByTestId('checkout-open-link')).toBeNull();
  });

  it('a wrong reference is rejected and the booking stays "waiting"; the right one confirms as a DEMO reference', async () => {
    let attempts = 0;
    const confirmed = waiting({
      state: 'CONFIRMED',
      state_label: 'אושר על ידי הספק',
      supplier_reference: 'DEMO-0A1B2C3D4E',
      can: {},
      warnings: [],
      notice: 'אסמכתת ספק ההדגמה אומתה ונרשמה. לא בוצעה הזמנה אמיתית ולא בוצע חיוב.',
      reservation: {
        id: 'r1',
        supplier_reference: 'DEMO-0A1B2C3D4E',
        mode: 'HOSTED_CHECKOUT',
        status: 'CONFIRMED',
        amount: { amount: '1000.00', currency: 'ILS' },
        confirmed_at: '2026-11-12T10:10:00Z',
        notes: null,
      },
    });
    const { fetchMock } = setup(waiting(), {
      'POST /api/bookings/b1/record-confirmation': () =>
        ++attempts === 1 ? errorResponse(409, 'SUPPLIER_REFERENCE_NOT_FOUND', 'האסמכתה לא נמצאה אצל ספק ההדגמה עבור הזמנה זו.') : jsonResponse(confirmed),
    });
    const form = await screen.findByTestId('record-confirmation-form');
    expect(form).toHaveTextContent('אסמכתה שגויה לא תתקבל');
    const input = within(form).getByLabelText(/אסמכתת ספק/);
    await userEvent.type(input, 'DEMO-WRONG00000');
    await userEvent.click(within(form).getByRole('button', { name: 'רישום האסמכתה' }));
    const problem = await screen.findByTestId('booking-problem');
    expect(problem).toHaveTextContent('האסמכתה לא אומתה — ההזמנה לא אושרה');
    await waitFor(() => expect(screen.getByTestId('awaiting-supplier-panel')).toBeInTheDocument());
    expect(screen.queryByTestId('confirmed-panel')).toBeNull();

    await userEvent.clear(screen.getByLabelText(/אסמכתת ספק/));
    await userEvent.type(screen.getByLabelText(/אסמכתת ספק/), 'DEMO-0A1B2C3D4E');
    await userEvent.click(screen.getByRole('button', { name: 'רישום האסמכתה' }));
    const panel = await screen.findByTestId('confirmed-panel');
    expect(panel).toHaveTextContent('נרשמה אסמכתה של ספק לדוגמה (DEMO)');
    expect(panel).toHaveTextContent('אסמכתת הדגמה — אין חיוב');
    expect(within(panel).getByTestId('supplier-reference')).toHaveTextContent('DEMO-0A1B2C3D4E');
    expect(within(panel).getByTestId('demo-reference-note')).toHaveTextContent('לא בוצעה הזמנה אמיתית ולא בוצע חיוב');
    expect(screen.queryByTestId('awaiting-supplier-panel')).toBeNull();
    const posts = fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/record-confirmation'));
    expect(posts).toHaveLength(2);
  });

  it('a real (non-DEMO) supplier reference is labelled as typed by hand and unverified', async () => {
    setup(
      waiting({
        is_demo: false,
        state: 'CONFIRMED',
        state_label: 'אושר על ידי הספק',
        supplier_reference: 'REAL-12345',
        can: {},
        warnings: ['האסמכתה הוזנה ידנית ולא אומתה מול הספק.'],
      }),
    );
    const panel = await screen.findByTestId('confirmed-panel');
    expect(panel).toHaveTextContent('נרשמה אסמכתת הספק');
    expect(within(panel).getByTestId('manual-reference-note')).toHaveTextContent('המערכת לא אימתה אותה מול הספק');
    expect(screen.queryByTestId('demo-reference-note')).toBeNull();
  });
});
