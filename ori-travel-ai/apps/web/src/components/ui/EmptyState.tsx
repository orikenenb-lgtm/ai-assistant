import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}

export function EmptyState({ title, description, icon, action, compact = false, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface text-center',
        compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12',
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            'grid place-items-center rounded-full bg-accent-soft text-accent-strong',
            compact ? 'size-10 [&_svg]:size-5' : 'size-14 [&_svg]:size-7',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      )}
      <p className={cn('font-semibold text-fg', compact ? 'text-sm' : 'text-base')}>{title}</p>
      {description && <div className="max-w-md text-sm leading-relaxed text-fg-muted">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
