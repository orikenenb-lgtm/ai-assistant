import { CloudOff, RotateCw, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { isApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from './Button';

export interface ErrorStateProps {
  /** The thrown error (ApiError aware). */
  error?: unknown;
  title?: ReactNode;
  /** Overrides the error's message. */
  message?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}

/** Hebrew error message + request id (for support) + retry. */
export function ErrorState({ error, title, message, onRetry, retrying, compact = false, className }: ErrorStateProps) {
  const apiError = isApiError(error) ? error : null;
  const Icon = apiError?.isNetworkError ? CloudOff : apiError?.status === 403 ? ShieldAlert : TriangleAlert;
  const resolvedTitle =
    title ?? (apiError?.isNetworkError ? 'אין חיבור לשרת' : apiError?.status === 403 ? 'אין הרשאה' : 'משהו השתבש');
  const resolvedMessage = message ?? apiError?.message ?? 'אירעה שגיאה בלתי צפויה. נסו שוב.';

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-coral-200 bg-coral-50/60 text-center',
        compact ? 'gap-2 px-4 py-5' : 'gap-3 px-6 py-10',
        className,
      )}
    >
      <span
        className={cn(
          'grid place-items-center rounded-full bg-coral-100 text-coral-700',
          compact ? 'size-9 [&_svg]:size-5' : 'size-12 [&_svg]:size-6',
        )}
        aria-hidden="true"
      >
        <Icon />
      </span>
      <p className={cn('font-semibold text-coral-700', compact ? 'text-sm' : 'text-base')}>{resolvedTitle}</p>
      <p className="max-w-md text-sm leading-relaxed text-fg-muted">{resolvedMessage}</p>
      {apiError?.requestId && (
        <p className="text-xs text-fg-subtle">
          מזהה בקשה לתמיכה:{' '}
          <code dir="ltr" className="select-all rounded bg-surface px-1.5 py-0.5 font-mono text-[0.7rem] text-fg-muted">
            {apiError.requestId}
          </code>
        </p>
      )}
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          loading={retrying}
          leadingIcon={<RotateCw aria-hidden="true" />}
          className="mt-1"
        >
          נסו שוב
        </Button>
      )}
    </div>
  );
}
