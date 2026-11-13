import { useEffect, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDate, formatRelative } from '@/lib/format';

function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export interface FreshnessTextProps {
  value: string | null | undefined;
  /** Text before the relative time (default "עודכן"). Use "" for none. */
  prefix?: string;
  refreshMs?: number;
  fallback?: ReactNode;
  className?: string;
}

/** "עודכן לפני 5 דק׳" — re-renders periodically; full timestamp in the title. */
export function FreshnessText({ value, prefix = 'עודכן', refreshMs = 30_000, fallback = '—', className }: FreshnessTextProps) {
  const now = useNow(refreshMs);
  const relative = value ? formatRelative(value, now) : null;
  if (!value || !relative) return <span className={cn('text-fg-subtle', className)}>{fallback}</span>;
  return (
    <time dateTime={value} title={formatDate(value, 'datetime') ?? undefined} className={className}>
      {prefix ? `${prefix} ${relative}` : relative}
    </time>
  );
}
