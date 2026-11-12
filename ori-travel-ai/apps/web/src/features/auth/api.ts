/** Auth API (contract §3.1). */
import { api, isApiError, setCsrfToken } from '@/lib/api';
import { OkResponseSchema } from '@/lib/schemas/common';
import { InvitationPreviewSchema, SessionOutSchema, type SessionOut } from '@/lib/schemas/auth';

export const authKeys = {
  all: ['auth'] as const,
  me: ['auth', 'me'] as const,
  invitation: (token: string) => ['auth', 'invitation', token] as const,
};

/** Current session, or null when not signed in (401). */
export async function fetchSession(): Promise<SessionOut | null> {
  try {
    const session = await api.get('/api/auth/me', { schema: SessionOutSchema });
    setCsrfToken(session.csrf_token);
    return session;
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(input: LoginInput): Promise<SessionOut> {
  const session = await api.post('/api/auth/login', input, { schema: SessionOutSchema });
  setCsrfToken(session.csrf_token);
  return session;
}

export async function logout(): Promise<void> {
  await api.post('/api/auth/logout', undefined, { schema: OkResponseSchema });
}

/** The token travels in the request body — never in a URL (URLs end up in server/proxy logs). */
export function previewInvitation(token: string) {
  return api.post('/api/auth/invitations/preview', { token }, { schema: InvitationPreviewSchema });
}

export async function acceptInvitation(input: { token: string; password: string }): Promise<SessionOut> {
  const session = await api.post('/api/auth/invitations/accept', input, { schema: SessionOutSchema });
  setCsrfToken(session.csrf_token);
  return session;
}
