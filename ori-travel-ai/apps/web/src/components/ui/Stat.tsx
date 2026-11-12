import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'default' | 'accent' | 'warn' | 'danger';
  className?: string;
}

const TONE_ICON: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'bg-ink-50 text-ink-700',
  accent: 'bg-sea-50 text-sea-700',
  warn: 'bg-amber-50 text-amber-700',
  danger: 'bg-coral-50 text-coral-700',
};

/** Key figure with label. Use a <dl>-friendly structure. */
export function Stat({ label, value, hint, icon, tone = 'default', className }: StatProps) {
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-xs', className)}>
      {icon && (
        <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg [&_svg]:size-5', TONE_ICON[tone])} aria-hidden="true">
          {icon}
        </span>
      )}
      <dl className="min-w-0">
        <dt className="text-xs font-medium text-fg-muted">{label}</dt>
        <dd className="mt-0.5 text-xl font-bold text-fg tabular-nums">{value}</dd>
        {hint && <dd className="mt-0.5 text-xs text-fg-subtle">{hint}</dd>}
      </dl>
    </div>
  );
}
