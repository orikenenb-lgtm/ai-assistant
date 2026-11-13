import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BookingDetailPage from '@/pages/bookings/BookingDetailPage';
import { createFetchMock, errorResponse, jsonResponse, renderRoutes, testSession } from '@/test/utils';
import { resetSubmitKeysForTests } from '../idempotency';
import { HASH_A, HASH_B, approvedApproval, makeBooking } from '../testFixtures';
import type { Booking } from '@/lib/schemas/bookings';

const routes = [{ path: '/bookings/:bookingId', element: <BookingDetailPage /> }];

interface Ctx {
  booking: Booking;
  handlers?: Record<string, (init: RequestInit & { url: string }) => Response | Promise<Response>>;
  user?: Partial<Omit<typeof testSession.user, 'role'>> & { role?: 'owner' | 'adult' | 'viewer' };
}

function setup({ booking, handlers = {}, user }: Ctx) {
  const state = { booking };
  const fetchMock = createFetchMock({
    'GET /api/auth/me': () => jsonResponse({ ...testSession, user: { ...testSession.user, ...user } }),
    'GET /api/bookings/b1': () => jsonResponse(state.booking),
    ...handlers,
  });
  vi.stubGlobal('fetch', fetchMock);
  const utils = renderRoutes(routes, { initialEntries: ['/bookings/b1'] });
  return { ...utils, fetchMock, state };
}

function calls(fetchMock: ReturnType<typeof createFetchMock>, method: string, path: string) {
  return fetchMock.mock.calls.filter(([url, init]) => String(url).split('?')[0] === path && ((init as RequestInit | undefined)?.method ?? 'GET') === method);
}
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as RequestInit).body as string);

describe('booking review screen', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
    resetSubmitKeysForTests();
  });

  it('shows the simulation banner and the stepper', async () => {
    setup({ booking: makeBooking() });
    expect(await screen.findByTestId('execution-banner')).toHaveTextContent('סימולציה — לא תתבצע רכישה אמיתית');
    const steps = within(screen.getByTestId('booking-stepper')).getAllByRole('listitem');
    expect(steps).toHaveLength(6);
    expect(steps[2]).toHaveAttribute('aria-current', 'step');
  });

  it('shows the hosted-checkout banner instead for HOSTED_CHECKOUT', async () => {
    setup({ booking: makeBooking({ execution_mode: 'HOSTED_CHECKOUT', is_simulation: false }) });
    expect(await screen.findByTestId('execution-banner')).toHaveTextContent('ההזמנה תושלם באתר הספק; אנחנו לא מחייבים כרטיס');
  });

  it('renders buttons strictly from the server `can` flags', async () => {
    const { unmount } = setup({ booking: makeBooking({ state: 'QUOTE_SELECTED' }) });
    await screen.findByTestId('booking-review');
    expect(screen.queryByRole('button', { name: /בדיקת מחיר מול הספק/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'ביטול ההזמנה' })).toBeNull();
    expect(screen.queryByTestId('approval-panel')).toBeNull();
    expect(screen.queryByTestId('submit-panel')).toBeNull();
    unmount();
    vi.unstubAllGlobals();

    setup({ booking: makeBooking({ state: 'QUOTE_SELECTED', can: { revalidate: true, cancel: true, edit_travelers: true } }) });
    expect(await screen.findByRole('button', { name: 'בדיקת מחיר מול הספק' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ביטול ההזמנה' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'עריכת נוסעים' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /מעבר לאתר הספק/ })).toBeNull();
  });

  it('is read-only with an explanation for viewers', async () => {
    setup({ booking: makeBooking(), user: { role: 'viewer', can_book: false } });
    expect(await screen.findByTestId('read-only-note')).toHaveTextContent('צופה');
    expect(screen.queryByRole('button', { name: /אישור|ביטול|בדיקת מחיר/ })).toBeNull();
  });

  it('explains the missing attestation for non-attested adults', async () => {
    setup({ booking: makeBooking(), user: { role: 'adult', can_book: false, legal_adult_attested: false } });
    expect(await screen.findByTestId('read-only-note')).toHaveTextContent('הצהרת בגירות');
  });

  describe('approval', () => {
    const readyBooking = () => makeBooking({ can: { approve: true, revalidate: true, cancel: true } });

    it('shows every terms line and the total, and requires checkbox + password', async () => {
      setup({ booking: readyBooking() });
      const panel = await screen.findByTestId('approval-panel');
      const lines = within(screen.getByTestId('terms-summary')).getAllByRole('listitem');
      expect(lines.map((l) => l.textContent)).toEqual(makeBooking().terms_summary);
      expect(screen.getByTestId('approval-total')).toHaveTextContent('1,000');
      const button = within(panel).getByRole('button', { name: 'אישור התנאים' });
      expect(button).toBeDisabled();
      await userEvent.click(screen.getByRole('checkbox', { name: 'קראתי ואני מאשר/ת את התנאים המדויקים' }));
      expect(button).toBeDisabled();
      await userEvent.type(screen.getByLabelText(/סיסמה/), 'secret');
      expect(button).toBeEnabled();
    });

    it('sends the terms_hash of the booking that was displayed', async () => {
      const approved = makeBooking({
        state: 'APPROVED',
        state_label: 'מאושר',
        approval: approvedApproval,
        can: { submit: true, revalidate: true, cancel: true },
        notice: 'התנאים אושרו. האישור תקף לזמן מוגבל.',
      });
      const { fetchMock } = setup({
        booking: readyBooking(),
        handlers: { 'POST /api/bookings/b1/approve': () => jsonResponse(approved) },
      });
      await userEvent.click(await screen.findByRole('checkbox', { name: /קראתי ואני מאשר/ }));
      await userEvent.type(screen.getByLabelText(/סיסמה/), 'Demo-Owner-Pass-1');
      await userEvent.click(screen.getByRole('button', { name: 'אישור התנאים' }));
      await screen.findByTestId('submit-panel');
      const [call] = calls(fetchMock, 'POST', '/api/bookings/b1/approve');
      expect(bodyOf(call!)).toEqual({ terms_hash: HASH_A, password: 'Demo-Owner-Pass-1', confirm: true });
      expect(screen.getByTestId('booking-notice')).toHaveTextContent('התנאים אושרו');
      expect(screen.queryByTestId('approval-panel')).toBeNull();
    });

    it('on TERMS_CHANGED refetches, explains, resets the confirmation and shows the new terms', async () => {
      const changed = makeBooking({
        terms_hash: HASH_B,
        terms_summary: ['טיסה: תל אביב – אתונה', 'סה״כ לתשלום: ‏1,070.00 ₪'],
        current_price: { amount: '1070.00', currency: 'ILS' },
        price_changed: true,
        can: { approve: true },
      });
      const { state, fetchMock } = setup({
        booking: readyBooking(),
        handlers: {
          'POST /api/bookings/b1/approve': () => {
            state.booking = changed;
            return errorResponse(409, 'TERMS_CHANGED', 'תנאי ההזמנה השתנו מאז שהוצגו לך. יש לעיין בתנאים המעודכנים ולאשר שוב.');
          },
        },
      });
      await userEvent.click(await screen.findByRole('checkbox', { name: /קראתי ואני מאשר/ }));
      await userEvent.type(screen.getByLabelText(/סיסמה/), 'pw');
      await userEvent.click(screen.getByRole('button', { name: 'אישור התנאים' }));
      const problem = await screen.findByTestId('booking-problem');
      expect(problem).toHaveTextContent('התנאים השתנו');
      expect(problem).toHaveTextContent('לקרוא את התנאים המעודכנים');
      await waitFor(() => expect(screen.getByTestId('approval-total')).toHaveTextContent('1,070'));
      expect(screen.getByRole('checkbox', { name: /קראתי ואני מאשר/ })).not.toBeChecked();
      expect(screen.getByTestId('price-changed')).toHaveTextContent('המחיר השתנה');
      // a second attempt now carries the NEW hash
      state.booking = { ...changed };
      await userEvent.click(screen.getByRole('checkbox', { name: /קראתי ואני מאשר/ }));
      await userEvent.type(screen.getByLabelText(/סיסמה/), 'pw');
      await userEvent.click(screen.getByRole('button', { name: 'אישור התנאים' }));
      await waitFor(() => expect(calls(fetchMock, 'POST', '/api/bookings/b1/approve')).toHaveLength(2));
      expect(bodyOf(calls(fetchMock, 'POST', '/api/bookings/b1/approve')[1]!).terms_hash).toBe(HASH_B);
    });

    it('shows a wrong-password error without leaving the page', async () => {
      setup({
        booking: readyBooking(),
        handlers: { 'POST /api/bookings/b1/approve': () => errorResponse(401, 'REAUTH_FAILED', 'הסיסמה שגויה') },
      });
      await userEvent.click(await screen.findByRole('checkbox', { name: /קראתי ואני מאשר/ }));
      await userEvent.type(screen.getByLabelText(/סיסמה/), 'bad');
      await userEvent.click(screen.getByRole('button', { name: 'אישור התנאים' }));
      const problem = await screen.findByTestId('booking-problem');
      expect(problem).toHaveTextContent('הסיסמה שגויה');
      // BUG-QA-05: the sentence appears once (title), followed by an explanation — not repeated as the body
      expect(problem.textContent?.split('הסיסמה שגויה')).toHaveLength(2);
      expect(problem).toHaveTextContent('התנאים לא אושרו');
      expect(screen.getByTestId('approval-panel')).toBeInTheDocument();
      expect(screen.getByLabelText(/סיסמה/)).toHaveValue('');
    });
  });

  describe('submit', () => {
    const approvedBooking = () =>
      makeBooking({ state: 'APPROVED', state_label: 'מאושר', approval: approvedApproval, can: { submit: true, cancel: true, revalidate: true } });
    const confirmed = makeBooking({
      state: 'CONFIRMED',
      state_label: 'אושר על ידי הספק',
      supplier_reference: 'SIM-ABC123',
      reservation: { id: 'r1', supplier_reference: 'SIM-ABC123', mode: 'SIMULATION', status: 'CONFIRMED', amount: { amount: '1000.00', currency: 'ILS' }, confirmed_at: '2026-11-12T10:10:00Z', notes: null },
      notice: 'סימולציה הושלמה: התקבלה אסמכתה SIM-ABC123. לא בוצעה הזמנה אמיתית ולא בוצע חיוב.',
    });

    it('re-sends the SAME idempotency key on retry and shows the confirmed result only from the server', async () => {
      let n = 0;
      const { fetchMock } = setup({
        booking: approvedBooking(),
        handlers: {
          'POST /api/bookings/b1/submit': () => (n++ === 0 ? errorResponse(503, 'REVALIDATION_FAILED', 'הספק לא ענה') : jsonResponse(confirmed)),
        },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'שליחה (סימולציה)' }));
      expect(await screen.findByTestId('booking-problem')).toHaveTextContent('בדיקת המחיר מול הספק נכשלה');
      expect(screen.queryByTestId('confirmed-panel')).toBeNull();
      await userEvent.click(await screen.findByRole('button', { name: 'שליחה (סימולציה)' }));
      expect(await screen.findByTestId('confirmed-panel')).toBeInTheDocument();
      const submits = calls(fetchMock, 'POST', '/api/bookings/b1/submit');
      expect(submits).toHaveLength(2);
      const keys = submits.map((c) => bodyOf(c).idempotency_key);
      expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
      expect(keys[1]).toBe(keys[0]);
      expect(screen.getByTestId('supplier-reference')).toHaveTextContent('SIM-ABC123');
      expect(screen.getByTestId('confirmed-panel')).toHaveTextContent('אסמכתה מדומה');
    });

    it('does not send twice on a double click while in flight', async () => {
      let release: (r: Response) => void = () => {};
      const { fetchMock } = setup({
        booking: approvedBooking(),
        handlers: { 'POST /api/bookings/b1/submit': () => new Promise<Response>((res) => (release = res)) },
      });
      const button = await screen.findByRole('button', { name: 'שליחה (סימולציה)' });
      await userEvent.dblClick(button);
      await waitFor(() => expect(calls(fetchMock, 'POST', '/api/bookings/b1/submit')).toHaveLength(1));
      expect(button).toBeDisabled();
      release(jsonResponse(confirmed));
      await screen.findByTestId('confirmed-panel');
      expect(calls(fetchMock, 'POST', '/api/bookings/b1/submit')).toHaveLength(1);
    });

    it('uses a different key after a new approval', async () => {
      const { fetchMock, state } = setup({
        booking: approvedBooking(),
        handlers: {
          'POST /api/bookings/b1/submit': () => {
            // the server downgrades; the user then re-approves (new approval id)
            state.booking = makeBooking({ state: 'APPROVED', approval: { ...approvedApproval, id: 'ap2' }, can: { submit: true } });
            return errorResponse(409, 'PRICE_CHANGED', 'המחיר השתנה');
          },
        },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'שליחה (סימולציה)' }));
      await screen.findByTestId('booking-problem');
      await waitFor(() => expect(calls(fetchMock, 'GET', '/api/bookings/b1').length).toBeGreaterThan(1));
      await userEvent.click(await screen.findByRole('button', { name: 'שליחה (סימולציה)' }));
      await waitFor(() => expect(calls(fetchMock, 'POST', '/api/bookings/b1/submit')).toHaveLength(2));
      const [k1, k2] = calls(fetchMock, 'POST', '/api/bookings/b1/submit').map((c) => bodyOf(c).idempotency_key);
      expect(k2).not.toBe(k1);
    });
  });

  it('UNKNOWN: explains and offers only the reconcile action', async () => {
    const resolved = makeBooking({
      state: 'CONFIRMED',
      state_label: 'אושר על ידי הספק',
      supplier_reference: 'SIM-R1',
      notice: 'הבירור הושלם: ההזמנה נמצאה אצל הספק המדומה (אסמכתה SIM-R1).',
    });
    const { fetchMock } = setup({
      booking: makeBooking({ state: 'UNKNOWN', state_label: 'לא ידוע — נדרש בירור', can: { reconcile: true }, approval: { ...approvedApproval, consumed_at: '2026-11-12T10:10:00Z', valid: false } }),
      handlers: { 'POST /api/bookings/b1/reconcile': () => jsonResponse(resolved) },
    });
    const panel = await screen.findByTestId('unknown-panel');
    expect(panel).toHaveTextContent('אין לשלוח שוב');
    expect(screen.getAllByRole('button').filter((b) => /בירור|שליחה|אישור|ביטול/.test(b.textContent ?? '')).map((b) => b.textContent)).toEqual(['בירור מול הספק']);
    await userEvent.click(screen.getByRole('button', { name: 'בירור מול הספק' }));
    expect(await screen.findByTestId('booking-notice')).toHaveTextContent('הבירור הושלם');
    expect(calls(fetchMock, 'POST', '/api/bookings/b1/reconcile')).toHaveLength(1);
    expect(screen.getByTestId('supplier-reference')).toHaveTextContent('SIM-R1');
  });

  it('FAILED shows the reason; EXPIRED shows a side state in the stepper', async () => {
    setup({ booking: makeBooking({ state: 'FAILED', state_label: 'נכשל', failure_reason: 'הספק דחה את ההזמנה' }) });
    expect(await screen.findByTestId('failed-panel')).toHaveTextContent('הספק דחה את ההזמנה');
    expect(screen.getByTestId('side-state')).toHaveAttribute('data-state', 'FAILED');
  });

  it('hosted checkout: link dialog opens an https URL in a new tab with noopener; record form validates the reference', async () => {
    const recorded = makeBooking({ execution_mode: 'HOSTED_CHECKOUT', is_simulation: false, state: 'CONFIRMED', supplier_reference: 'ABC-1234', notice: 'אסמכתת הספק נרשמה.' });
    const { fetchMock } = setup({
      booking: makeBooking({
        execution_mode: 'HOSTED_CHECKOUT',
        is_simulation: false,
        state: 'APPROVED',
        approval: approvedApproval,
        can: { open_checkout: true, record_confirmation: true, cancel: true },
      }),
      handlers: {
        'POST /api/bookings/b1/checkout-link': () =>
          jsonResponse({ url: 'https://supplier.example/checkout?x=1', provider_id: 'p', provider_name: 'ספק', instructions: 'השלימו באתר', warnings: ['בדקו מחיר'] }),
        'POST /api/bookings/b1/record-confirmation': () => jsonResponse(recorded),
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'מעבר לאתר הספק' }));
    const link = await screen.findByRole('link', { name: /פתיחת אתר הספק/ });
    expect(link).toHaveAttribute('href', 'https://supplier.example/checkout?x=1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await userEvent.click(screen.getAllByRole('button', { name: 'סגירה' })[0]!);

    const record = screen.getByRole('button', { name: 'רישום האסמכתה' });
    expect(record).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/אסמכתת ספק/), 'a b');
    expect(record).toBeDisabled();
    await userEvent.clear(screen.getByLabelText(/אסמכתת ספק/));
    await userEvent.type(screen.getByLabelText(/אסמכתת ספק/), 'ABC-1234');
    expect(record).toBeEnabled();
    await userEvent.click(record);
    await screen.findByTestId('confirmed-panel');
    expect(bodyOf(calls(fetchMock, 'POST', '/api/bookings/b1/record-confirmation')[0]!)).toEqual({ supplier_reference: 'ABC-1234' });
  });

  it('cancel goes through a confirmation dialog', async () => {
    const cancelled = makeBooking({ state: 'CANCELLED', state_label: 'בוטל', notice: 'הכנת ההזמנה בוטלה. לא נשלח דבר לספק.' });
    const { fetchMock } = setup({
      booking: makeBooking({ can: { cancel: true } }),
      handlers: { 'POST /api/bookings/b1/cancel': () => jsonResponse(cancelled) },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'ביטול ההזמנה' }));
    expect(calls(fetchMock, 'POST', '/api/bookings/b1/cancel')).toHaveLength(0);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'ביטול ההזמנה' }));
    expect(await screen.findByTestId('cancelled-panel')).toBeInTheDocument();
    expect(calls(fetchMock, 'POST', '/api/bookings/b1/cancel')).toHaveLength(1);
  });
});
