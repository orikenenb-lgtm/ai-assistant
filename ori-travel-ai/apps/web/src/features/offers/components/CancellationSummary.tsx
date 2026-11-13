import { CircleCheck, CircleHelp, CircleX, RefreshCw } from 'lucide-react';
import { DateText, MoneyText } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { CancellationPolicy } from '@/lib/schemas/offers';

export type CancellationKind = 'free' | 'refundable' | 'nonrefundable' | 'unknown';

export function cancellationKind(c: CancellationPolicy): CancellationKind {
  if (c.refundable === true) return c.free_cancellation_until ? 'free' : 'refundable';
  if (c.refundable === false) return 'nonrefundable';
  return 'unknown';
}

export interface CancellationSummaryProps {
  cancellation: CancellationPolicy;
  /** Show the full policy text as well. */
  detailed?: boolean;
  className?: string;
}

export function CancellationSummary({ cancellation, detailed = false, className }: CancellationSummaryProps) {
  const kind = cancellationKind(cancellation);
  const tone =
    kind === 'free' || kind === 'refundable' ? 'text-moss-700' : kind === 'nonrefundable' ? 'text-coral-700' : 'text-fg-muted';
  const Icon = kind === 'free' || kind === 'refundable' ? CircleCheck : kind === 'nonrefundable' ? CircleX : CircleHelp;
  return (
    <div className={cn('flex flex-col gap-1 text-sm', className)} data-testid="cancellation-summary" data-kind={kind}>
      <p className={cn('flex flex-wrap items-center gap-x-1.5 font-medium', tone)}>
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {kind === 'free' && (
          <span>
            ביטול חינם עד <DateText value={cancellation.free_cancellation_until} preset="datetime" timeZone="source" />
          </span>
        )}
        {kind === 'refundable' && <span>ניתן להחזר כספי</span>}
        {kind === 'nonrefundable' && <span>ללא החזר כספי</span>}
        {kind === 'unknown' && <span>מדיניות ביטול לא ידועה — בדקו אצל הספק</span>}
      </p>
      {cancellation.changeable !== null && cancellation.changeable !== undefined && (
        <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-fg-muted">
          <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
          {cancellation.changeable ? (
            <span>
              שינוי אפשרי
              {cancellation.change_fee && (
                <>
                  {' '}
                  (דמי שינוי <MoneyText value={cancellation.change_fee} />)
                </>
              )}
            </span>
          ) : (
            <span>שינוי אינו אפשרי</span>
          )}
        </p>
      )}
      {detailed && cancellation.policy_text && (
        <p className="mt-1 rounded-md bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-fg-muted">{cancellation.policy_text}</p>
      )}
    </div>
  );
}
