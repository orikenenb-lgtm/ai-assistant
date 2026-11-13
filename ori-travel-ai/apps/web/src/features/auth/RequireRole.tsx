import { ShieldAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { ButtonLink, EmptyState } from '@/components/ui';
import type { Role, User } from '@/lib/schemas/auth';
import { hasRole } from './roles';
import { useAuth } from './useAuth';

export interface RequireRoleProps {
  /** Allowed roles (any of). */
  roles?: Role[];
  /** Extra predicate, e.g. `canBook`. */
  allow?: (user: User) => boolean;
  /** Rendered when not permitted (default: Hebrew "no permission" notice). */
  fallback?: ReactNode;
  children?: ReactNode;
}

/** UI guard (use inside RequireAuth). The server still enforces permissions. */
export function RequireRole({ roles, allow, fallback, children }: RequireRoleProps) {
  const { user } = useAuth();
  const permitted = !!user && (!roles || hasRole(user, ...roles)) && (!allow || allow(user));
  if (!permitted) {
    return (
      <>
        {fallback ?? (
          <EmptyState
            icon={<ShieldAlert />}
            title="אין לך הרשאה למסך זה"
            description="המסך זמין רק לבעלי תפקיד מתאים במשפחה. אם נדרשת לך גישה, פנו לבעלים של החשבון המשפחתי."
            action={
              <ButtonLink to="/" variant="secondary" size="sm">
                חזרה לדף הבית
              </ButtonLink>
            }
          />
        )}
      </>
    );
  }
  return <>{children ?? <Outlet />}</>;
}
