/**
 * Typed fetch wrapper for the Ori Travel AI API.
 *
 * - Same-origin cookies (httpOnly `ori_session`), JSON in/out.
 * - Unsafe methods (POST/PUT/PATCH/DELETE) carry `X-CSRF-Token`, taken from the
 *   in-memory token (set from /auth/login, /auth/me) or the readable `ori_csrf` cookie.
 * - Errors are normalized into `ApiError {status, code, message, details, requestId}`
 *   with Hebrew, user-safe messages (from the API envelope when present).
 * - A 401 `UNAUTHORIZED` (session missing/expired) notifies `onSessionExpired`
 *   listeners so the auth layer can clear state. Other 401 codes
 *   (INVALID_CREDENTIALS, REAUTH_FAILED) are ordinary errors.
 * - Pass a Zod `schema` to validate/parse responses; feature API modules must do so.
 */
import type { z } from 'zod';
import { ApiErrorEnvelopeSchema, ValidationDetailSchema } from './schemas/common';

export const API_BASE = '/api';
export const CSRF_COOKIE = 'ori_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const NETWORK_ERROR_MESSAGE = 'לא ניתן להתחבר לשרת. בדקו את החיבור לרשת ונסו שוב.';
export const INVALID_RESPONSE_MESSAGE = 'התקבלה תשובה לא צפויה מהשרת. נסו לרענן את הדף.';

const STATUS_FALLBACK: Record<number, [code: string, message: string]> = {
  400: ['BAD_REQUEST', 'הבקשה אינה תקינה'],
  401: ['UNAUTHORIZED', 'נדרשת התחברות'],
  403: ['FORBIDDEN', 'אין לך הרשאה לפעולה זו'],
  404: ['NOT_FOUND', 'הנתיב או הפריט לא נמצאו'],
  405: ['METHOD_NOT_ALLOWED', 'שיטת הבקשה אינה נתמכת'],
  409: ['CONFLICT', 'הפעולה מתנגשת במצב הנוכחי'],
  413: ['PAYLOAD_TOO_LARGE', 'הבקשה גדולה מדי'],
  415: ['UNSUPPORTED_MEDIA_TYPE', 'סוג התוכן אינו נתמך'],
  422: ['VALIDATION_ERROR', 'חלק מהשדות אינם תקינים'],
  429: ['RATE_LIMITED', 'יותר מדי בקשות. נסו שוב בעוד מספר דקות'],
  500: ['INTERNAL_ERROR', 'אירעה שגיאה פנימית בשרת'],
  502: ['BAD_GATEWAY', 'השרת אינו זמין כרגע. נסו שוב בעוד רגע'],
  503: ['SERVICE_UNAVAILABLE', 'השירות אינו זמין כרגע'],
  504: ['GATEWAY_TIMEOUT', 'השרת לא הגיב בזמן. נסו שוב'],
};

export interface ApiErrorInit {
  status: number;
  code: string;
  message: string;
  details?: unknown;
  requestId?: string | null;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.details = init.details ?? null;
    this.requestId = init.requestId ?? null;
  }

  /** No response at all (offline, DNS, CORS, server down). */
  get isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isClientError(): boolean {
    return this.status >= 400 && this.status < 500;
  }

  /** Field → Hebrew message map for 422 VALIDATION_ERROR (and similar) responses. */
  fieldErrors(): Record<string, string> {
    const out: Record<string, string> = {};
    if (!Array.isArray(this.details)) return out;
    for (const item of this.details) {
      const parsed = ValidationDetailSchema.safeParse(item);
      if (parsed.success && parsed.data.field && !(parsed.data.field in out)) {
        out[parsed.data.field] = parsed.data.message;
      }
    }
    return out;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/** Hebrew, user-safe message for any thrown value. */
export function errorMessage(error: unknown, fallback = 'אירעה שגיאה בלתי צפויה'): string {
  if (isApiError(error)) return error.message;
  return fallback;
}

// ---------------------------------------------------------------------------
// CSRF token
// ---------------------------------------------------------------------------

let memoryCsrfToken: string | null = null;

export function setCsrfToken(token: string | null): void {
  memoryCsrfToken = token;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  for (const part of document.cookie.split(';')) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === name) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        return rest.join('=');
      }
    }
  }
  return null;
}

export function getCsrfToken(): string | null {
  return memoryCsrfToken ?? readCookie(CSRF_COOKIE);
}

// ---------------------------------------------------------------------------
// Session-expiry notifications (401 UNAUTHORIZED)
// ---------------------------------------------------------------------------

type SessionExpiredListener = (error: ApiError) => void;
const sessionExpiredListeners = new Set<SessionExpiredListener>();

export function onSessionExpired(listener: SessionExpiredListener): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export type QueryValue = string | number | boolean | null | undefined | ReadonlyArray<string | number>;

export interface RequestOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Record<string, QueryValue>;
  body?: unknown;
  /** Zod schema used to validate + parse the JSON response. */
  schema?: z.ZodType<T>;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** How to read a successful body. Defaults to JSON (empty body → undefined). */
  parseAs?: 'json' | 'text' | 'blob';
  /** Internal: prevents infinite CSRF refresh loops. */
  _csrfRetried?: boolean;
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  if (!path.startsWith(`${API_BASE}/`)) {
    throw new Error(`API paths must start with ${API_BASE}/ (got "${path}")`);
  }
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

async function toApiError(response: Response): Promise<ApiError> {
  const headerRequestId = response.headers.get('X-Request-ID');
  const [fallbackCode, fallbackMessage] = STATUS_FALLBACK[response.status] ?? [
    'HTTP_ERROR',
    response.status >= 500 ? 'אירעה שגיאה בשרת' : 'הבקשה נכשלה',
  ];
  let payload: unknown;
  try {
    const text = await response.text();
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const envelope = ApiErrorEnvelopeSchema.safeParse(payload);
  if (envelope.success) {
    const e = envelope.data.error;
    return new ApiError({
      status: response.status,
      code: e.code || fallbackCode,
      message: e.message || fallbackMessage,
      details: e.details ?? null,
      requestId: e.request_id ?? headerRequestId,
    });
  }
  return new ApiError({
    status: response.status,
    code: fallbackCode,
    message: fallbackMessage,
    details: null,
    requestId: headerRequestId,
  });
}

async function refreshCsrfToken(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/auth/me`, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return false;
    const data: unknown = await res.json();
    if (data && typeof data === 'object' && 'csrf_token' in data && typeof data.csrf_token === 'string') {
      setCsrfToken(data.csrf_token);
      return true;
    }
  } catch {
    // ignore — the original error is surfaced to the caller
  }
  return false;
}

export async function apiRequest<T = unknown>(path: string, options: RequestOptions<T> = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: BodyInit | undefined;

  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (UNSAFE_METHODS.has(method)) {
    const token = getCsrfToken();
    if (token) headers[CSRF_HEADER] = token;
  }

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'same-origin',
      signal: options.signal,
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === 'AbortError') throw cause;
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });
  }

  if (!response.ok) {
    const error = await toApiError(response);
    if (error.status === 401 && error.code === 'UNAUTHORIZED') {
      setCsrfToken(null);
      for (const listener of sessionExpiredListeners) listener(error);
    }
    if (error.status === 403 && error.code === 'CSRF_FAILED' && !options._csrfRetried) {
      if (await refreshCsrfToken()) {
        return apiRequest<T>(path, { ...options, _csrfRetried: true });
      }
    }
    throw error;
  }

  const requestId = response.headers.get('X-Request-ID');
  const parseAs = options.parseAs ?? 'json';
  if (parseAs === 'text') return (await response.text()) as T;
  if (parseAs === 'blob') return (await response.blob()) as T;

  let data: unknown = undefined;
  if (response.status !== 204) {
    const text = await response.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new ApiError({ status: response.status, code: 'INVALID_RESPONSE', message: INVALID_RESPONSE_MESSAGE, requestId });
      }
    }
  }

  if (options.schema) {
    const parsed = options.schema.safeParse(data);
    if (!parsed.success) {
      if (import.meta.env.DEV) {
        console.error(`[api] response for ${method} ${path} failed schema validation`, parsed.error.issues);
      }
      throw new ApiError({
        status: response.status,
        code: 'INVALID_RESPONSE',
        message: INVALID_RESPONSE_MESSAGE,
        details: parsed.error.issues.slice(0, 10).map((i) => ({ field: i.path.join('.'), message: i.message })),
        requestId,
      });
    }
    return parsed.data;
  }
  return data as T;
}

type BodylessOptions<T> = Omit<RequestOptions<T>, 'method' | 'body'>;

/** Convenience verbs. Always pass `schema` from feature API modules. */
export const api = {
  get: <T = unknown>(path: string, options?: BodylessOptions<T>) => apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T = unknown>(path: string, body?: unknown, options?: BodylessOptions<T>) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T = unknown>(path: string, body?: unknown, options?: BodylessOptions<T>) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T = unknown>(path: string, body?: unknown, options?: BodylessOptions<T>) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T = unknown>(path: string, options?: BodylessOptions<T>) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
};
