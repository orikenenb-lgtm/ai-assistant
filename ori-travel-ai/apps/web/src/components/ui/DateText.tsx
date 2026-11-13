import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { formatDate, formatDateRange, formatOffset, type DatePreset, type TimeZoneMode } from '@/lib/format';

export interface DateTextProps {
  /** ISO date ("2026-12-01") or datetime with offset ("2026-12-01T08:15:00+02:00"). */
  value: string | null | undefined;
  preset?: DatePreset;
  /**
   * "viewer" (default) converts to the viewer's zone — for system timestamps.
   * "source" keeps the wall-clock time in the string (flight/hotel local times).
   * Or an IANA zone, e.g. "Asia/Jerusalem".
   */
  timeZone?: TimeZoneMode;
  /** Append the string's UTC offset, e.g. "(UTC+02:00)". */
  showOffset?: boolean;
  fallback?: ReactNode;
  className?: string;
}

export function DateText({ value, preset = 'date', timeZone = 'viewer', showOffset = false, fallback = '—', className }: DateTextProps) {
  const formatted = value ? formatDate(value, preset, timeZone) : null;
  if (!value || !formatted) return <span className={cn('text-fg-subtle', className)}>{fallback}</span>;
  const offset = showOffset ? formatOffset(value) : null;
  const full = formatDate(value, 'datetime', timeZone) ?? undefined;
  return (
    <time dateTime={value} title={preset === 'datetime' ? undefined : full} className={cn('tabular-nums', className)}>
      {formatted}
      {offset && (
        <span className="ms-1 text-xs text-fg-subtle" dir="ltr">
          ({offset})
        </span>
      )}
    </time>
  );
}

export interface DateRangeProps {
  start: string | null | undefined;
  end: string | null | undefined;
  preset?: DatePreset;
  timeZone?: TimeZoneMode;
  fallback?: ReactNode;
  className?: string;
}

/** "1–8 בדצמ׳ 2026" — collapses shared parts via Intl.DateTimeFormat#formatRange. */
export function DateRange({ start, end, preset = 'date', timeZone = 'viewer', fallback = '—', className }: DateRangeProps) {
  if (start && !end) return <DateText value={start} preset={preset} timeZone={timeZone} className={className} />;
  const formatted = start && end ? formatDateRange(start, end, preset, timeZone) : null;
  if (!formatted) return <span className={cn('text-fg-subtle', className)}>{fallback}</span>;
  return (
    <span className={cn('tabular-nums', className)} data-start={start ?? undefined} data-end={end ?? undefined}>
      {formatted}
    </span>
  );
}
