import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock, jsonResponse, renderRoutes, testSession } from '@/test/utils';
import { AddToTripButton } from './AddToTripButton';

const trip = {
  id: 't1',
  title: 'רומא בדצמבר',
  destination: 'רומא',
  start_date: '2026-12-01',
  end_date: '2026-12-08',
  status: 'planning',
  item_count: 2,
  traveler_count: 2,
  created_at: '2026-11-01T10:00:00Z',
  updated_at: '2026-11-01T10:00:00Z',
};

const overlapError = {
  error: {
    code: 'ITEM_OVERLAP',
    message: 'הטיסה חופפת לטיסה אחרת בטיול',
    details: [
      {
        item_id: 'new',
        other_item_id: 'i9',
        kind_pair: 'flight×flight',
        message: 'חפיפה בין טיסות',
        conflicts_with_item_id: 'i9',
        conflicts_with_title: 'טיסה לרומא',
      },
    ],
    request_id: 'req-overlap',
  },
};

function stub() {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchMock = createFetchMock({
    'GET /api/auth/me': () => jsonResponse(testSession),
    'GET /api/trips': () => jsonResponse([trip]),
    'POST /api/trips/t1/items/from-offer': (init) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      bodies.push(body);
      return body.allow_overlap ? jsonResponse({ item: { id: 'i10' } }, { status: 201 }) : jsonResponse(overlapError, { status: 409 });
    },
  });
  vi.stubGlobal('fetch', fetchMock);
  return bodies;
}

async function openAndSubmit(user: ReturnType<typeof userEvent.setup>) {
  renderRoutes([{ path: '/', element: <AddToTripButton offerId="o1" /> }]);
  await user.click(await screen.findByRole('button', { name: 'הוספה לטיול' }));
  const picker = await screen.findByRole('dialog', { name: 'הוספה לטיול' });
  await user.click(await within(picker).findByRole('radio', { name: /רומא בדצמבר/ }));
  await user.click(within(picker).getByRole('button', { name: 'הוספה' }));
  return picker;
}

describe('AddToTripButton — ITEM_OVERLAP', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('asks for confirmation on 409 ITEM_OVERLAP and retries with allow_overlap: true', async () => {
    const bodies = stub();
    const user = userEvent.setup();
    await openAndSubmit(user);

    const confirm = await screen.findByRole('dialog', { name: 'חפיפה עם פריט אחר בטיול' });
    expect(confirm).toHaveTextContent('הפריט חופף ל-"טיסה לרומא" — להוסיף בכל זאת?');
    expect(bodies).toEqual([{ offer_id: 'o1' }]);

    await user.click(within(confirm).getByRole('button', { name: 'הוספה בכל זאת' }));
    await waitFor(() => expect(bodies).toEqual([{ offer_id: 'o1' }, { offer_id: 'o1', allow_overlap: true }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByText('ההצעה נוספה לטיול')).toBeInTheDocument();
  });

  it('cancel sends nothing more and keeps the trip picker open', async () => {
    const bodies = stub();
    const user = userEvent.setup();
    const picker = await openAndSubmit(user);

    const confirm = await screen.findByRole('dialog', { name: 'חפיפה עם פריט אחר בטיול' });
    await user.click(within(confirm).getByRole('button', { name: 'ביטול' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'חפיפה עם פריט אחר בטיול' })).not.toBeInTheDocument());
    expect(bodies).toEqual([{ offer_id: 'o1' }]);
    expect(picker).toBeInTheDocument();
    // No error toast for the overlap itself (the confirmation handled it).
    expect(screen.queryByText('לא ניתן להוסיף לטיול')).not.toBeInTheDocument();
  });
});
