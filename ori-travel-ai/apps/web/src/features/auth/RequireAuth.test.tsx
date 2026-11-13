import { screen, waitFor } from '@testing-library/react';
import { useLocation } from 'react-router';
import { createFetchMock, errorResponse, jsonResponse, renderRoutes, testSession } from '@/test/utils';
import { RequireAuth } from './RequireAuth';
import { RequireRole } from './RequireRole';

function LoginProbe() {
  const location = useLocation();
  return <p>login page, from={(location.state as { from?: string } | null)?.from}</p>;
}

const routes = [
  { path: '/login', element: <LoginProbe /> },
  {
    element: <RequireAuth />,
    children: [
      { path: '/trips/:id', element: <h1>פרטי טיול</h1> },
      {
        element: <RequireRole roles={['owner']} />,
        children: [{ path: '/providers', element: <h1>ספקים</h1> }],
      },
    ],
  },
];

describe('<RequireAuth>', () => {
  it('redirects anonymous users to /login and remembers where they were going', async () => {
    vi.stubGlobal('fetch', createFetchMock({ 'GET /api/auth/me': () => errorResponse(401, 'UNAUTHORIZED', 'נדרשת התחברות') }));
    const { router } = renderRoutes(routes, { initialEntries: ['/trips/42?tab=budget'] });
    expect(await screen.findByText('login page, from=/trips/42?tab=budget')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/login');
  });

  it('shows a loading state while the session is being checked', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    renderRoutes(routes, { initialEntries: ['/trips/1'] });
    expect(screen.getByText('טוען את Ori Travel AI…')).toBeInTheDocument();
  });

  it('renders protected content for signed-in users', async () => {
    vi.stubGlobal('fetch', createFetchMock({ 'GET /api/auth/me': () => jsonResponse(testSession) }));
    renderRoutes(routes, { initialEntries: ['/trips/1'] });
    expect(await screen.findByRole('heading', { name: 'פרטי טיול' })).toBeInTheDocument();
  });

  it('shows a Hebrew error with retry when the server is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    renderRoutes(routes, { initialEntries: ['/trips/1'] });
    // network errors are retried by default; the test query client disables retries
    expect(await screen.findByText('אין חיבור לשרת')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'נסו שוב' })).toBeInTheDocument();
  });
});

describe('<RequireRole>', () => {
  it('blocks users without the required role', async () => {
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        'GET /api/auth/me': () => jsonResponse({ ...testSession, user: { ...testSession.user, role: 'viewer', can_book: false } }),
      }),
    );
    renderRoutes(routes, { initialEntries: ['/providers'] });
    expect(await screen.findByText('אין לך הרשאה למסך זה')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'ספקים' })).not.toBeInTheDocument());
  });

  it('allows the owner', async () => {
    vi.stubGlobal('fetch', createFetchMock({ 'GET /api/auth/me': () => jsonResponse(testSession) }));
    renderRoutes(routes, { initialEntries: ['/providers'] });
    expect(await screen.findByRole('heading', { name: 'ספקים' })).toBeInTheDocument();
  });
});
