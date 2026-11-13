import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFlightOffer } from '@/features/offers/testFixtures';
import { createFetchMock, errorResponse, jsonResponse, renderWithProviders } from '@/test/utils';
import { CONVERSATION_STORAGE_KEY } from '../conversation';
import { ChatPanel } from './ChatPanel';

const XSS = '<img src=x onerror="window.__pwned=1"> **bold** <script>alert(1)</script>';

function reply(over: Record<string, unknown> = {}) {
  return {
    reply: {
      text: `מצאתי טיסה.\n${XSS}`,
      mode: 'fallback',
      cards: [makeFlightOffer({ id: 'card1', amount: '1234.00' })],
      search_ids: ['s1'],
      clarifying_question: null,
      warnings: [],
      grounding: { ok: true, removed_claims: [] },
      ...over,
    },
    tool_calls: [{ name: 'search_flights', status: 'ok' }],
  };
}

function setup(handler: () => Response | Promise<Response>) {
  const fetchMock = createFetchMock({ 'POST /api/ai/chat': handler });
  vi.stubGlobal('fetch', fetchMock);
  renderWithProviders(
    <MemoryRouter>
      <ChatPanel />
    </MemoryRouter>,
  );
  return fetchMock;
}

async function ask(text: string) {
  const box = screen.getByLabelText('הודעה לעוזר');
  await userEvent.type(box, text);
  await userEvent.keyboard('{Enter}');
}

describe('ChatPanel', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
    delete (window as unknown as Record<string, unknown>).__pwned;
  });

  it('renders offer cards from the server reply, with tool chips and the search link', async () => {
    setup(() => jsonResponse(reply()));
    await ask('טיסה לאתונה');
    const cards = await screen.findByTestId('chat-cards');
    expect(within(cards).getByTestId('offer-card')).toHaveAttribute('data-offer-id', 'card1');
    expect(within(cards).getByTestId('offer-card')).toHaveTextContent('1,234');
    expect(screen.getByTestId('tool-chip')).toHaveTextContent('חיפוש טיסות · הושלם');
    expect(screen.getByRole('link', { name: 'פתיחת החיפוש המלא' })).toHaveAttribute('href', '/search/flights?search_id=s1');
    expect(screen.getByTestId('reply-mode')).toHaveTextContent('מצב בסיסי');
  });

  it('treats assistant text as plain text (no HTML injected)', async () => {
    setup(() => jsonResponse(reply({ cards: [] })));
    await ask('היי');
    const msgEl = await screen.findByTestId('chat-assistant-message');
    expect(msgEl.querySelector('img')).toBeNull();
    expect(msgEl.querySelector('script')).toBeNull();
    expect(msgEl).toHaveTextContent('<img src=x onerror="window.__pwned=1">');
    expect(msgEl).toHaveTextContent('**bold**');
    expect((window as unknown as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('shows the clarifying question, warnings and the grounding notice', async () => {
    setup(() =>
      jsonResponse(reply({ cards: [], clarifying_question: 'לאיזה תאריך?', warnings: ['המחירים בהדגמה'], grounding: { ok: false, removed_claims: ['₪99'] } })),
    );
    await ask('טיסה');
    expect(await screen.findByTestId('clarifying-question')).toHaveTextContent('לאיזה תאריך?');
    expect(screen.getByText('המחירים בהדגמה')).toBeInTheDocument();
    expect(screen.getByTestId('grounding-notice')).toHaveTextContent('הוסרו מחירים שלא אומתו מול תוצאות החיפוש');
  });

  it('sends history as plain role/content pairs and persists the conversation in sessionStorage only', async () => {
    const fetchMock = setup(() => jsonResponse(reply({ cards: [], search_ids: [] })));
    await ask('ראשונה');
    await screen.findByTestId('chat-assistant-message');
    await ask('שנייה');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse((fetchMock.mock.calls[1]?.[1] as RequestInit).body as string);
    expect(body.message).toBe('שנייה');
    expect(body.history).toHaveLength(2);
    expect(body.history[0]).toEqual({ role: 'user', content: 'ראשונה' });
    expect(sessionStorage.getItem(CONVERSATION_STORAGE_KEY)).toContain('ראשונה');
    expect(localStorage.length).toBe(0);
  });

  it('Shift+Enter does not send; "שיחה חדשה" clears everything', async () => {
    const fetchMock = setup(() => jsonResponse(reply({ cards: [] })));
    const box = screen.getByLabelText('הודעה לעוזר');
    await userEvent.type(box, 'שורה 1{Shift>}{Enter}{/Shift}שורה 2');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(box).toHaveValue('שורה 1\nשורה 2');
    expect(screen.getByTestId('char-counter')).toHaveTextContent('/2000');
    await userEvent.keyboard('{Enter}');
    await screen.findByTestId('chat-assistant-message');
    await userEvent.click(screen.getByRole('button', { name: 'שיחה חדשה' }));
    expect(screen.queryByTestId('chat-assistant-message')).toBeNull();
    expect(sessionStorage.getItem(CONVERSATION_STORAGE_KEY)).toBeNull();
  });

  it('shows a Hebrew error and allows retry without duplicating the user message', async () => {
    let n = 0;
    setup(() => (n++ === 0 ? errorResponse(503, 'AI_UNAVAILABLE', 'העוזר אינו זמין כרגע') : jsonResponse(reply({ cards: [] }))));
    await ask('שלום');
    expect(await screen.findByRole('alert')).toHaveTextContent('העוזר אינו זמין כרגע');
    await userEvent.click(screen.getByRole('button', { name: 'ניסיון חוזר' }));
    await screen.findByTestId('chat-assistant-message');
    expect(screen.getAllByTestId('chat-user-message')).toHaveLength(1);
  });

  it('states that the assistant cannot book and conversations are not stored on the server', () => {
    setup(() => jsonResponse(reply()));
    expect(screen.getByTestId('cannot-book-note')).toHaveTextContent('אינו יכול להזמין');
    expect(screen.getByText(/אינה נשמרת בשרת/)).toBeInTheDocument();
  });
});
