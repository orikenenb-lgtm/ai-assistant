import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { FullPageStatus } from '@/components/layout/FullPageStatus';
import { useAuth } from './useAuth';

/** Route guard: renders children/<Outlet/> only for signed-in users; otherwise redirects to /login. */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <FullPageStatus kind="loading" />;
  if (auth.status === 'error') {
    return <FullPageStatus kind="error" error={auth.error} onRetry={() => void auth.refresh()} />;
  }
  if (auth.status === 'anonymous') {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }
  return <>{children ?? <Outlet />}</>;
}
