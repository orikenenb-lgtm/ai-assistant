import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { createFetchMock, jsonResponse, renderWithProviders } from '@/test/utils';
import { useReauth } from './useReauth';

afterEach(() => vi.unstubAllGlobals());

function Harness({ action }: { action: () => Promise<string> }) {
  const { withReauth, dialog } = useReauth();
  const [out, setOut] = useState('');
  return (
    <>
      <button onClick={() => void withReauth(action).then(setOut)}>go</button>
      <output>{out}</output>
      {dialog}
    </>
  );
}

describe('useReauth', () => {
  it('prompts for the password on REAUTH_REQUIRED, reauths, and retries the action', async () => {
    const fetchMock = createFetchMock({ 'POST /api/auth/reauth': () => jsonResponse({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    const action = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new ApiError({ status: 403, code: 'REAUTH_REQUIRED', message: 'x' }))
      .mockResolvedValueOnce('done');
    renderWithProviders(<Harness action={action} />);
    await userEvent.click(screen.getByText('go'));
    await userEvent.type(await screen.findByLabelText(/הסיסמה שלך/), 'pw');
    await userEvent.click(screen.getByRole('button', { name: 'אימות והמשך' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('done'));
    expect(action).toHaveBeenCalledTimes(2);
  });
});
