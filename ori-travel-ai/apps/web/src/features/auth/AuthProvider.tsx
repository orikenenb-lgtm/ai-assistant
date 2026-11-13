import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { onSessionExpired, setCsrfToken } from '@/lib/api';
import type { SessionOut } from '@/lib/schemas/auth';
import { authKeys, fetchSession, login as loginRequest, logout as logoutRequest } from './api';
import { AuthContext, type AuthContextValue, type AuthStatus } from './context';

/** Removes every cached query except the auth session (used on logout / expiry). */
function purgeUserData(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== authKeys.all[0] });
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const me = useQuery({
    queryKey: authKeys.me,
    queryFn: fetchSession,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
  });

  // A 401 UNAUTHORIZED from any request means the session is gone.
  useEffect(
    () =>
      onSessionExpired(() => {
        setCsrfToken(null);
        queryClient.setQueryData<SessionOut | null>(authKeys.me, null);
        purgeUserData(queryClient);
      }),
    [queryClient],
  );

  const loginMutation = useMutation({
    mutationFn: loginRequest,
    onSuccess: (session) => {
      purgeUserData(queryClient);
      queryClient.setQueryData(authKeys.me, session);
    },
  });

  const setSession = useCallback(
    (session: SessionOut) => {
      setCsrfToken(session.csrf_token);
      purgeUserData(queryClient);
      queryClient.setQueryData(authKeys.me, session);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await logoutRequest();
    } catch {
      // Even if the server call fails (e.g. already expired), clear local state.
    } finally {
      setCsrfToken(null);
      queryClient.setQueryData<SessionOut | null>(authKeys.me, null);
      purgeUserData(queryClient);
    }
  }, [queryClient]);

  const { mutateAsync } = loginMutation;
  const login = useCallback((email: string, password: string) => mutateAsync({ email, password }), [mutateAsync]);

  const { refetch } = me;
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const value = useMemo<AuthContextValue>(() => {
    let status: AuthStatus;
    if (me.data !== undefined) status = me.data ? 'authenticated' : 'anonymous';
    else if (me.isError) status = 'error';
    else status = 'loading';
    return {
      status,
      user: me.data?.user ?? null,
      csrfToken: me.data?.csrf_token ?? null,
      error: me.error,
      login,
      logout,
      refresh,
      setSession,
    };
  }, [me.data, me.isError, me.error, login, logout, refresh, setSession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
