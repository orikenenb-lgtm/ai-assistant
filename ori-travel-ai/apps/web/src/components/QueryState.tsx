import type { UseQueryResult } from '@tanstack/react-query';
import { Construction } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { isApiError } from '@/lib/api';

export interface QueryStateProps<T> {
  query: UseQueryResult<T>;
  children: (data: T) => ReactNode;
  /** Loading placeholder (default: skeleton block). */
  loading?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  /** Shown when the endpoint returns 404 (feature not available on the server yet). */
  unavailable?: ReactNode;
  errorTitle?: string;
  compact?: boolean;
}

/**
 * Standard loading / error / empty / unavailable handling for a query.
 * Use it for every data widget so states look and behave the same everywhere.
 */
export function QueryState<T>({
  query,
  children,
  loading,
  isEmpty,
  empty,
  unavailable,
  errorTitle,
  compact = true,
}: QueryStateProps<T>) {
  if (query.isPending) {
    return (
      <div aria-busy="true" aria-live="polite">
        <span className="sr-only">טוען…</span>
        {loading ?? <Skeleton className="h-24 w-full" />}
      </div>
    );
  }
  if (query.isError) {
    if (isApiError(query.error) && query.error.status === 404) {
      return (
        <>
          {unavailable ?? (
            <EmptyState
              compact={compact}
              icon={<Construction />}
              title="עדיין לא זמין"
              description="השירות הזה נמצא בפיתוח בשרת ויופיע כאן כשיהיה מוכן."
            />
          )}
        </>
      );
    }
    return (
      <ErrorState
        compact={compact}
        title={errorTitle}
        error={query.error}
        onRetry={() => void query.refetch()}
        retrying={query.isFetching}
      />
    );
  }
  if (isEmpty?.(query.data) && empty) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
