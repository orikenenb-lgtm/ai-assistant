import { z } from 'zod';
import { createFetchMock, callHeaders, errorResponse, jsonResponse } from '@/test/utils';
import {
  ApiError,
  api,
  buildUrl,
  CSRF_HEADER,
  NETWORK_ERROR_MESSAGE,
  onSessionExpired,
  setCsrfToken,
} from './api';

describe('api client — error parsing', () => {
  it('parses the error envelope into a typed ApiError', async () => {
    const fetchMock = createFetchMock({
      'GET /api/things': () =>
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_ERROR',
              message: 'חלק מהשדות אינם תקינים',
              details: [{ field: 'email', message: 'כתובת אימייל אינה תקינה', type: 'value_error' }],
              request_id: 'abc12345',
            },
          },
          { status: 422 },
        ),
    });
    vi.stubGlobal('fetch', fetchMock);

    const err = await api.get('/api/things').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(422);
    expect(apiErr.code).toBe('VALIDATION_ERROR');
    expect(apiErr.message).toBe('חלק מהשדות אינם תקינים');
    expect(apiErr.requestId).toBe('abc12345');
    expect(apiErr.fieldErrors()).toEqual({ email: 'כתובת אימייל אינה תקינה' });
    expect(apiErr.isClientError).toBe(true);
  });

  it('falls back to a Hebrew message and the X-Request-ID header for non-JSON errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'X-Request-ID': 'hdr98765' } })),
    );
    const err = (await api.get('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(502);
    expect(err.code).toBe('BAD_GATEWAY');
    expect(err.message).toMatch(/השרת אינו זמין/);
    expect(err.requestId).toBe('hdr98765');
  });

  it('maps network failures to a Hebrew NETWORK_ERROR', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = (await api.get('/api/x').catch((e: unknown) => e)) as ApiError;
    expect(err.status).toBe(0);
    expect(err.code).toBe('NETWORK_ERROR');
    expect(err.isNetworkError).toBe(true);
    expect(err.message).toBe(NETWORK_ERROR_MESSAGE);
  });

  it('rejects responses that fail schema validation with INVALID_RESPONSE', async () => {
    vi.stubGlobal('fetch', createFetchMock({ 'GET /api/count': () => jsonResponse({ count: 'many' }) }));
    const err = (await api.get('/api/count', { schema: z.object({ count: z.number() }) }).catch((e: unknown) => e)) as ApiError;
    expect(err.code).toBe('INVALID_RESPONSE');
  });

  it('returns parsed data when the schema matches', async () => {
    vi.stubGlobal('fetch', createFetchMock({ 'GET /api/count': () => jsonResponse({ count: 3, extra: true }) }));
    const data = await api.get('/api/count', { schema: z.object({ count: z.number() }) });
    expect(data).toEqual({ count: 3 });
  });

  it('notifies session-expiry listeners only for 401 UNAUTHORIZED', async () => {
    const listener = vi.fn();
    const off = onSessionExpired(listener);
    vi.stubGlobal(
      'fetch',
      createFetchMock({
        'GET /api/a': () => errorResponse(401, 'UNAUTHORIZED', 'נדרשת התחברות'),
        'POST /api/auth/reauth': () => errorResponse(401, 'REAUTH_FAILED', 'הסיסמה שגויה'),
      }),
    );
    await api.post('/api/auth/reauth', { password: 'x' }).catch(() => undefined);
    expect(listener).not.toHaveBeenCalled();
    await api.get('/api/a').catch(() => undefined);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('rejects paths outside /api/', () => {
    expect(() => buildUrl('/auth/me')).toThrow();
    expect(buildUrl('/api/x', { page: 2, page_size: 20, empty: '', none: null, ids: ['a', 'b'] })).toBe(
      '/api/x?page=2&page_size=20&ids=a&ids=b',
    );
  });
});

describe('api client — CSRF', () => {
  it('sends X-CSRF-Token from the in-memory token on unsafe methods only', async () => {
    const fetchMock = createFetchMock({
      'GET /api/x': () => jsonResponse({ ok: true }),
      'POST /api/x': () => jsonResponse({ ok: true }),
      'DELETE /api/x': () => new Response(null, { status: 204 }),
    });
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('memory-token');

    await api.get('/api/x');
    await api.post('/api/x', { a: 1 });
    await api.delete('/api/x');

    expect(callHeaders(fetchMock, 0)[CSRF_HEADER]).toBeUndefined();
    expect(callHeaders(fetchMock, 1)[CSRF_HEADER]).toBe('memory-token');
    expect(callHeaders(fetchMock, 1)['Content-Type']).toBe('application/json');
    expect((fetchMock.mock.calls[1][1] as RequestInit).body).toBe('{"a":1}');
    expect((fetchMock.mock.calls[1][1] as RequestInit).credentials).toBe('same-origin');
    expect(callHeaders(fetchMock, 2)[CSRF_HEADER]).toBe('memory-token');
  });

  it('falls back to the readable ori_csrf cookie', async () => {
    const fetchMock = createFetchMock({ 'PUT /api/x': () => jsonResponse({ ok: true }) });
    vi.stubGlobal('fetch', fetchMock);
    document.cookie = 'ori_csrf=cookie-token; path=/';
    await api.put('/api/x', {});
    expect(callHeaders(fetchMock, 0)[CSRF_HEADER]).toBe('cookie-token');
  });

  it('refreshes the token via /api/auth/me and retries once on CSRF_FAILED', async () => {
    let attempts = 0;
    const fetchMock = createFetchMock({
      'POST /api/x': (init) => {
        attempts += 1;
        const token = (init.headers as Record<string, string>)[CSRF_HEADER];
        return token === 'fresh-token'
          ? jsonResponse({ ok: true })
          : errorResponse(403, 'CSRF_FAILED', 'אסימון CSRF חסר או שגוי');
      },
      'GET /api/auth/me': () => jsonResponse({ user: {}, csrf_token: 'fresh-token' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    setCsrfToken('stale-token');
    await expect(api.post('/api/x', {})).resolves.toEqual({ ok: true });
    expect(attempts).toBe(2);
  });
});
