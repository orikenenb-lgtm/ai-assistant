import { Clock } from 'lucide-react';
import { Badge, DateText, FreshnessText, ModeBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { SourceInfo } from '@/lib/schemas/offers';

export function isExpired(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  if (!expiresAt) return false;
  const t = new Date(expiresAt).getTime();
  return Number.isFinite(t) && t <= now;
}

export interface SourceLineProps {
  source: SourceInfo;
  className?: string;
  /** Show only provider + mode (dense tables). */
  minimal?: boolean;
}

/** "דמו סקייליין · [הדגמה] · עודכן לפני 5 דק׳ · בתוקף עד 13:02" — every offer shows its source honestly. */
export function SourceLine({ source, className, minimal = false }: SourceLineProps) {
  const expired = isExpired(source.expires_at);
  return (
    <p className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted', className)} data-testid="source-line">
      <span className="font-medium text-fg">{source.provider_name}</span>
      <ModeBadge mode={source.mode} size="sm" />
      {!minimal && (
        <>
          <FreshnessText value={source.fetched_at} className="text-fg-subtle" />
          {source.expires_at &&
            (expired ? (
              <Badge tone="warn" size="sm">
                <Clock aria-hidden="true" />
                פג תוקף — חפשו מחדש
              </Badge>
            ) : (
              <span className="inline-flex items-center gap-1 text-fg-subtle">
                <Clock className="size-3" aria-hidden="true" />
                בתוקף עד <DateText value={source.expires_at} preset="time" />
              </span>
            ))}
        </>
      )}
    </p>
  );
}
