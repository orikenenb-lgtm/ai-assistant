import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createFetchMock, errorResponse, jsonResponse, renderRoutes, testSession } from '@/test/utils';
import LoginPage, { safeRedirect } from './LoginPage';

const routes = [
  { path: '/login', element: <LoginPage /> },
  { path: '/', element: <h1>לוח בקרה</h1> },
  { path: '/trips', element: <h1>טיולים</h1> },
];

function setup(loginHandler: Parameters<typeof createFetchMock>[0][string], initialEntries: Array<string> = ['/login']) {
  const fetchMock = createFetchMock({
    'GET /api/auth/me': () => errorResponse(401, 'UNAUTHORIZED', 'נדרשת התחברות'),
    'POST /api/auth/login': loginHandler,
  });
  vi.stubGlobal('fetch', fetchMock);
  const user = userEvent.setup();
  const utils = renderRoutes(routes, { initialEntries });
  return { fetchMock, user, ...utils };
}

describe('<LoginPage>', () => {
  it('validates required fields in Hebrew without calling the API', async () => {
    const { user, fetchMock } = setup(() => jsonResponse(testSession));
    await user.click(await screen.findByRole('button', { name: 'כניסה' }));
    expect(await screen.findByText('יש להזין כתובת אימייל')).toBeInTheDocument();
    expect(screen.getByText('יש להזין סיסמה')).toBeInTheDocument();
    expect(screen.getByLabelText(/אימייל/)).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText(/אימייל/)).toHaveFocus();
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/auth/login')).toBe(false);
  });

  it('rejects a malformed email', async () => {
    const { user } = setup(() => jsonResponse(testSession));
    await user.type(await screen.findByLabelText(/אימייל/), 'not-an-email');
    await user.type(screen.getByLabelText(/^סיסמה/), 'whatever-pass');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));
    expect(await screen.findByText('כתובת האימייל אינה תקינה')).toBeInTheDocument();
  });

  it('submits credentials and navigates home on success', async () => {
    const { user, fetchMock, router } = setup(() => jsonResponse(testSession));
    await user.type(await screen.findByLabelText(/אימייל/), '  Owner@Family.local ');
    await user.type(screen.getByLabelText(/^סיסמה/), 'Demo-Owner-Pass-1');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
    const call = fetchMock.mock.calls.find(([url]) => String(url) === '/api/auth/login')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      email: 'Owner@Family.local',
      password: 'Demo-Owner-Pass-1',
    });
    expect(await screen.findByRole('heading', { name: 'לוח בקרה' })).toBeInTheDocument();
  });

  it('returns to the page the user originally requested', async () => {
    const fetchMock = createFetchMock({
      'GET /api/auth/me': () => errorResponse(401, 'UNAUTHORIZED', 'נדרשת התחברות'),
      'POST /api/auth/login': () => jsonResponse(testSession),
    });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    const { router } = renderRoutes(routes, { initialEntries: ['/login'] });
    await router.navigate('/login', { state: { from: '/trips' } });
    await user.type(await screen.findByLabelText(/אימייל/), 'owner@family.local');
    await user.type(screen.getByLabelText(/^סיסמה/), 'Demo-Owner-Pass-1');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/trips'));
  });

  it('shows the API message for invalid credentials', async () => {
    const { user } = setup(() => errorResponse(401, 'INVALID_CREDENTIALS', 'האימייל או הסיסמה שגויים'));
    await user.type(await screen.findByLabelText(/אימייל/), 'owner@family.local');
    await user.type(screen.getByLabelText(/^סיסמה/), 'wrong-password-1');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('האימייל או הסיסמה שגויים');
    expect(screen.getByLabelText(/^סיסמה/)).toHaveValue('');
  });

  it('shows lockout / rate-limit messages from the API', async () => {
    const { user } = setup(() =>
      errorResponse(429, 'RATE_LIMITED', 'החשבון ננעל זמנית בעקבות ניסיונות כושלים. נסו שוב מאוחר יותר'),
    );
    await user.type(await screen.findByLabelText(/אימייל/), 'owner@family.local');
    await user.type(screen.getByLabelText(/^סיסמה/), 'wrong-password-1');
    await user.click(screen.getByRole('button', { name: 'כניסה' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('הכניסה נחסמה זמנית');
    expect(alert).toHaveTextContent('החשבון ננעל זמנית');
  });
});

describe('safeRedirect', () => {
  it('only allows in-app paths', () => {
    expect(safeRedirect('/trips/1?x=1')).toBe('/trips/1?x=1');
    expect(safeRedirect('//evil.example')).toBe('/');
    expect(safeRedirect('https://evil.example')).toBe('/');
    expect(safeRedirect('/login')).toBe('/');
    expect(safeRedirect(undefined)).toBe('/');
  });
});
