import { createContext } from 'react';
import type { SessionOut, User } from '@/lib/schemas/auth';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous' | 'error';

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  csrfToken: string | null;
  /** Error from the session check (network/server), when status === 'error'. */
  error: unknown;
  login: (email: string, password: string) => Promise<SessionOut>;
  logout: () => Promise<void>;
  /** Re-fetch /api/auth/me. */
  refresh: () => Promise<void>;
  /** Install a session returned by another endpoint (e.g. invitation accept). */
  setSession: (session: SessionOut) => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);
