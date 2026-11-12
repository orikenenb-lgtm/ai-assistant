import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFetchMock, errorResponse, jsonResponse, renderWithProviders } from '@/test/utils';
import { PassportReveal } from './components/PassportReveal';

afterEach(() => vi.unstubAllGlobals());

describe('PassportReveal', () => {
  it('asks for the password on REAUTH_REQUIRED, then reveals', async () => {
    let revealCalls = 0;
    const fetchMock = createFetchMock({
      'POST /api/travelers/m1/passport/reveal': () => {
        revealCalls += 1;
        return revealCalls === 1 ? errorResponse(403, 'REAUTH_REQUIRED', 'נדרש אימות') : jsonResponse({ passport_number: 'X1234567' });
      },
      'POST /api/auth/reauth': () => jsonResponse({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithProviders(<PassportReveal memberId="m1" masked="•••567" />);
    expect(screen.getByTestId('passport-value')).toHaveTextContent('•••567');
    await userEvent.click(screen.getByRole('button', { name: 'הצג מספר דרכון' }));
    await userEvent.type(await screen.findByLabelText(/הסיסמה שלך/), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'אימות והצגה' }));
    await waitFor(() => expect(screen.getByTestId('passport-value')).toHaveTextContent('X1234567'));
    await userEvent.click(screen.getByRole('button', { name: 'הסתרה' }));
    expect(screen.getByTestId('passport-value')).toHaveTextContent('•••567');
  });

  it('explains missing encryption key (503)', async () => {
    vi.stubGlobal('fetch', createFetchMock({ 'POST /api/travelers/m1/passport/reveal': () => errorResponse(503, 'ENCRYPTION_UNAVAILABLE', 'x') }));
    renderWithProviders(<PassportReveal memberId="m1" masked={null} />);
    await userEvent.click(screen.getByRole('button', { name: 'הצג מספר דרכון' }));
    expect(await screen.findByText(/ORI_DATA_KEY/)).toBeInTheDocument();
  });
});
