import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock, errorResponse, jsonResponse, renderRoutes, testSession } from '@/test/utils';
import DemoSupplierCheckoutPage from './DemoSupplierCheckoutPage';

const REF = 'A1b2C3d4E5f6G7h8I9j0K1l2';
const routes = [
  { path: '/demo-supplier/checkout', element: <DemoSupplierCheckoutPage /> },
  { path: '/bookings/:bookingId', element: <p data-testid="booking-page">booking</p> },
];

const session = (over: Record<string, unknown> = {}) => ({
  ref: REF,
  status: 'OPEN',
  is_demo: true,
  provider_id: 'demo_kidventures',
  provider_name: "דמו קידוונצ'רס",
  booking_id: 'b1',
  title: 'סיור באקרופוליס עם מדריך דובר עברית',
  summary: ['מה מזמינים: סיור באקרופוליס עם מדריך דובר עברית', 'מחיר כולל: 185.00 ₪'],
  price: { amount: '185.00', currency: 'ILS' },
  supplier_reference: null,
  recorded: false,
  can_complete: true,
  message: 'זהו דף ספק לדוגמה.',
  ...over,
});

function setup(entry: string, handlers: Record<string, (init: RequestInit & { url: string }) => Response | Promise<Response>> = {}) {
  const fetchMock = createFetchMock({
    'GET /api/auth/me': () => jsonResponse(testSession),
    'GET /api/demo-supplier/checkout': () => jsonResponse(session()),
    ...handlers,
  });
  vi.stubGlobal('fetch', fetchMock);
  return { ...renderRoutes(routes, { initialEntries: [entry] }), fetchMock };
}

describe('DEMO supplier checkout page', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows the big DEMO banner, the supplier, the offer and the price — and no payment fields', async () => {
    const { container } = setup(`/demo-supplier/checkout?ref=${REF}`);
    expect(screen.getByTestId('demo-supplier-banner')).toHaveTextContent('דף ספק לדוגמה — DEMO, אין חיוב');
    expect(await screen.findByTestId('demo-supplier-name')).toHaveTextContent("דמו קידוונצ'רס");
    expect(screen.getByTestId('demo-supplier-title')).toHaveTextContent('סיור באקרופוליס');
    expect(screen.getByTestId('demo-supplier-price')).toHaveTextContent('185');
    expect(screen.getByTestId('demo-supplier-summary')).toHaveTextContent('מחיר כולל');
    expect(container.querySelectorAll('input, select, textarea, form, iframe')).toHaveLength(0);
    expect(screen.queryByTestId('demo-supplier-reference')).toBeNull();
    expect(screen.getByText(/אין בדף הזה טופס תשלום/)).toBeInTheDocument();
  });

  it('"simulate completing at supplier" POSTs the ref and shows a DEMO reference to copy, with the next step', async () => {
    const { fetchMock } = setup(`/demo-supplier/checkout?ref=${REF}`, {
      'POST /api/demo-supplier/checkout/complete': () =>
        jsonResponse(session({ status: 'COMPLETED', supplier_reference: 'DEMO-0A1B2C3D4E', can_complete: false, message: 'ההזמנה עדיין אינה מאושרת במערכת: יש לרשום את האסמכתה.' })),
    });
    await userEvent.click(await screen.findByTestId('demo-supplier-complete'));
    expect(await screen.findByTestId('demo-supplier-reference')).toHaveTextContent('DEMO-0A1B2C3D4E');
    expect(screen.getByRole('button', { name: 'העתקת האסמכתה' })).toBeInTheDocument();
    expect(screen.getByTestId('demo-supplier-next-step')).toHaveTextContent('ההזמנה עדיין אינה מאושרת במערכת');
    expect(screen.queryByTestId('demo-supplier-complete')).toBeNull();
    const post = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/checkout/complete'))!;
    expect((post[1] as RequestInit).method).toBe('POST');
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ ref: REF });

    await userEvent.click(screen.getByTestId('back-to-booking'));
    expect(await screen.findByTestId('booking-page')).toBeInTheDocument();
  });

  it('a stale session cannot be completed', async () => {
    setup(`/demo-supplier/checkout?ref=${REF}`, {
      'GET /api/demo-supplier/checkout': () => jsonResponse(session({ status: 'EXPIRED', can_complete: false, summary: [], message: 'הדף הזה כבר אינו תקף.' })),
    });
    expect(await screen.findByTestId('demo-supplier-expired')).toHaveTextContent('הדף הזה כבר אינו תקף');
    expect(screen.queryByTestId('demo-supplier-complete')).toBeNull();
  });

  it('RA-10: a session completed for old terms reads "expired" and shows no reference to record', async () => {
    setup(`/demo-supplier/checkout?ref=${REF}`, {
      'GET /api/demo-supplier/checkout': () =>
        jsonResponse(session({ status: 'EXPIRED', can_complete: false, summary: [], supplier_reference: null, message: 'פג תוקף — האסמכתה שהונפקה בדף הזה אינה בתוקף.' })),
    });
    const expired = await screen.findByTestId('demo-supplier-expired');
    expect(expired).toHaveTextContent('פג תוקף — לא בתוקף');
    expect(expired).toHaveTextContent('אינה בתוקף');
    expect(screen.queryByTestId('demo-supplier-reference')).toBeNull();
    expect(screen.queryByTestId('demo-supplier-next-step')).toBeNull();
    expect(screen.queryByTestId('demo-supplier-complete')).toBeNull();
  });

  it('shows the server refusal when completion is rejected', async () => {
    setup(`/demo-supplier/checkout?ref=${REF}`, {
      'POST /api/demo-supplier/checkout/complete': () => errorResponse(409, 'CHECKOUT_SESSION_EXPIRED', 'דף הספק לדוגמה כבר אינו תקף.'),
    });
    await userEvent.click(await screen.findByTestId('demo-supplier-complete'));
    expect(await screen.findByTestId('demo-supplier-problem')).toHaveTextContent('דף הספק כבר אינו תקף');
    expect(screen.queryByTestId('demo-supplier-reference')).toBeNull();
  });

  it('a viewer can look but gets no completion button', async () => {
    setup(`/demo-supplier/checkout?ref=${REF}`, { 'GET /api/demo-supplier/checkout': () => jsonResponse(session({ can_complete: false })) });
    expect(await screen.findByText('תצוגה לקריאה בלבד')).toBeInTheDocument();
    expect(screen.queryByTestId('demo-supplier-complete')).toBeNull();
  });

  it.each([
    '/demo-supplier/checkout',
    '/demo-supplier/checkout?ref=short',
    `/demo-supplier/checkout?ref=${REF}&next=https://evil.example`,
    `/demo-supplier/checkout?ref=${encodeURIComponent('../../../../etc/passwd')}`,
  ])('%s is not a supplier page and never calls the API with it', async (entry) => {
    const { fetchMock } = setup(entry);
    expect(await screen.findByTestId('demo-supplier-not-found')).toBeInTheDocument();
    expect(screen.getByTestId('demo-supplier-banner')).toBeInTheDocument();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/api/demo-supplier'))).toBe(false));
  });

  it('an unknown ref shows "not found"', async () => {
    setup(`/demo-supplier/checkout?ref=${REF}`, {
      'GET /api/demo-supplier/checkout': () => errorResponse(404, 'CHECKOUT_SESSION_NOT_FOUND', 'דף הספק לדוגמה לא נמצא.'),
    });
    expect(await screen.findByTestId('demo-supplier-not-found')).toBeInTheDocument();
  });
});
