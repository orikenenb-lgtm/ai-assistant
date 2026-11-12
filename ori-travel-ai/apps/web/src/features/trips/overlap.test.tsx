import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock, jsonResponse, renderWithProviders } from '@/test/utils';
import { TripDetailSchema, TripItemSchema } from '@/lib/schemas/trips';
import { ItemFormDialog } from './components/ItemFormDialog';
import { BudgetPanel } from './components/BudgetPanel';
import { ItemRow } from './components/ItemRow';
import { overlapConflict, overlapPrompt } from './formUtils';

const NOW = '2026-12-01T08:00:00Z';
const overlap = {
  item_id: 'i1',
  other_item_id: 'i2',
  kind_pair: 'flight-flight',
  message: 'טיסה "א" חופפת בזמן לטיסה "ב"',
};

function item(over: Record<string, unknown> = {}) {
  return TripItemSchema.parse({
    id: 'i1',
    trip_id: 't1',
    kind: 'flight',
    title: 'טיסה א',
    cost_status: 'estimate',
    sort_order: 0,
    created_at: NOW,
    updated_at: NOW,
    ...over,
  });
}

const trip = TripDetailSchema.parse({ id: 't1', title: 'רומא', timezone: 'Europe/Rome' });

describe('overlap badges', () => {
  it('shows a badge and the Hebrew message on an overlapping item', () => {
    renderWithProviders(
      <ul>
        <ItemRow
          item={item({ overlaps: [overlap] })}
          trip={trip}
          editable
          canMoveUp={false}
          canMoveDown={false}
          onMove={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </ul>,
    );
    expect(screen.getByTestId('overlap-badge')).toHaveTextContent('חפיפה בזמנים');
    expect(screen.getByTestId('overlap-messages')).toHaveTextContent(overlap.message);
  });

  it('shows nothing when there is no overlap', () => {
    renderWithProviders(
      <ul>
        <ItemRow
          item={item()}
          trip={trip}
          editable={false}
          canMoveUp={false}
          canMoveDown={false}
          onMove={() => {}}
          onEdit={() => {}}
          onDelete={() => {}}
        />
      </ul>,
    );
    expect(screen.queryByTestId('overlap-badge')).not.toBeInTheDocument();
  });
});

describe('ITEM_OVERLAP confirm and retry', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('parses the conflict and builds the prompt', () => {
    expect(overlapPrompt('טיסה ב')).toBe('הפריט חופף ל-"טיסה ב" — להוסיף בכל זאת?');
    expect(overlapConflict(new Error('x'))).toBeNull();
  });

  it('asks for confirmation on 409 and retries with allow_overlap', async () => {
    let calls = 0;
    const bodies: Record<string, unknown>[] = [];
    const fetchMock = createFetchMock({
      'POST /api/trips/t1/items': (init) => {
        bodies.push(JSON.parse(String(init.body)));
        calls += 1;
        if (calls === 1) {
          return jsonResponse(
            {
              error: {
                code: 'ITEM_OVERLAP',
                message: 'הפריט חופף',
                details: [{ ...overlap, conflicts_with_title: 'טיסה ב' }],
                request_id: 'r1',
              },
            },
            { status: 409 },
          );
        }
        return jsonResponse(item({ id: 'new', overlaps: [overlap] }), { status: 201 });
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    const onOpenChange = vi.fn();
    renderWithProviders(<ItemFormDialog open onOpenChange={onOpenChange} trip={trip} />);
    await userEvent.type(screen.getByRole('textbox', { name: /כותרת/ }), 'טיסה חדשה');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה' }));

    expect(await screen.findByText('הפריט חופף ל-"טיסה ב" — להוסיף בכל זאת?')).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('allow_overlap');

    await userEvent.click(screen.getByRole('button', { name: 'הוספה בכל זאת' }));
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]).toMatchObject({ title: 'טיסה חדשה', allow_overlap: true });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('does not retry when the user cancels', async () => {
    const fetchMock = createFetchMock({
      'POST /api/trips/t1/items': () =>
        jsonResponse({ error: { code: 'ITEM_OVERLAP', message: 'הפריט חופף', details: [{ ...overlap }], request_id: 'r1' } }, { status: 409 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<ItemFormDialog open onOpenChange={() => {}} trip={trip} />);
    await userEvent.type(screen.getByRole('textbox', { name: /כותרת/ }), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'הוספה' }));
    expect(await screen.findByText('הפריט חופף ל-פריט אחר בטיול — להוסיף בכל זאת?')).toBeInTheDocument();
    const cancels = screen.getAllByRole('button', { name: 'ביטול' });
    await userEvent.click(cancels[cancels.length - 1]!);
    expect(fetchMock.mock.calls.filter((c) => (c[1] as RequestInit)?.method === 'POST')).toHaveLength(1);
  });
});

describe('budget panel', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('shows per-traveler and the overlap warning', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        'GET /api/trips/t1/budget': () =>
          jsonResponse({
            trip_id: 't1',
            budget: { amount: '1000.00', currency: 'ILS' },
            totals: [{ currency: 'ILS', known: '300.00', estimated: '0.00', excluded: '0.00', counted: '300.00' }],
            by_kind: [],
            remaining: { amount: '700.00', currency: 'ILS' },
            remaining_reason: 'ok',
            over_budget: false,
            per_traveler: { amount: '150.00', currency: 'ILS' },
            per_traveler_reason: 'ok',
            traveler_count: 2,
            warnings: [{ code: 'OVERLAPS', message: 'נמצאו 1 חפיפות בזמנים בין פריטים בטיול.', item_ids: ['i1', 'i2'] }],
          }),
      }),
    );
    renderWithProviders(<BudgetPanel tripId="t1" />);
    expect(await screen.findByTestId('budget-per-traveler')).toHaveTextContent('150');
    expect(screen.getByText(/חפיפות בזמנים/)).toBeInTheDocument();
  });
});
