import { vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router';
import { ToastProvider } from '@/components/ui';
import { AuthProvider } from '@/features/auth';

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
}

/** JSON Response helper for fetch mocks. */
export function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

export function errorResponse(status: number, code: string, message: string, requestId = 'req123abc') {
  return jsonResponse({ error: { code, message, details: null, request_id: requestId } }, { status });
}

export const testUser = {
  id: 'u1',
  email: 'owner@family.local',
  display_name: 'אורי כהן',
  role: 'owner' as const,
  is_active: true,
  legal_adult_attested: true,
  can_book: true,
  last_login_at: null,
  created_at: '2026-01-01T10:00:00Z',
};

export const testSession = { user: testUser, csrf_token: 'csrf-test-token' };

/** Render routes inside all app providers with an in-memory router. */
export function renderRoutes(routes: RouteObject[], { initialEntries = ['/'] }: { initialEntries?: string[] } = {}) {
  const queryClient = createTestQueryClient();
  const router = createMemoryRouter(routes, { initialEntries });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, queryClient };
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  const queryClient = createTestQueryClient();
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
  return { ...render(ui, { wrapper: Wrapper, ...options }), queryClient };
}

type Handler = (init: RequestInit & { url: string }) => Response | Promise<Response>;

/**
 * fetch mock that dispatches on "METHOD /path" (query string ignored).
 * Unknown routes return the API's 404 envelope. Inspect calls via `.mock.calls`.
 */
export function createFetchMock(handlers: Record<string, Handler>) {
  return vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = (init.method ?? 'GET').toUpperCase();
    const path = url.split('?')[0];
    const handler = handlers[`${method} ${path}`];
    if (!handler) return errorResponse(404, 'NOT_FOUND', 'הנתיב לא נמצא');
    return handler({ ...init, url });
  });
}

/** Headers of the n-th fetch call as a plain object. */
export function callHeaders(mock: ReturnType<typeof createFetchMock>, n: number): Record<string, string> {
  const init = mock.mock.calls[n]?.[1] as RequestInit | undefined;
  return (init?.headers ?? {}) as Record<string, string>;
}
