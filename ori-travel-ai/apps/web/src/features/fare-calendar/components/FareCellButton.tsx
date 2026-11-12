import { Star } from 'lucide-react';
import type { KeyboardEvent } from 'react';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { FareCell, FareTier } from '@/lib/schemas/calendar';
import { cellAriaLabel, cellPriceText, WEEKDAY_SHORT, weekday } from '../model';

export const TIER_CLASSES: Record<FareTier, string> = {
  best: 'bg-heat-best border-tangerine-400',
  low: 'bg-heat-low border-sky-200',
  mid: 'bg-heat-mid border-amber-200',
  high: 'bg-heat-high border-tangerine-200',
};

export const STATUS_CLASSES = {
  priced: 'bg-surface border-line',
  no_offers: 'bg-heat-none border-ink-200 text-fg-muted',
  not_searched: 'bg-heat-unknown border-dashed border-ink-300 text-fg-subtle',
  error: 'bg-coral-50 border-coral-200 text-coral-700',
  out_of_range: 'bg-transparent border-transparent text-ink-300',
} as const;

/** Text glyphs for non-priced states (never colour alone). */
export const STATUS_GLYPH = { no_offers: '∅', not_searched: '—', error: '!' } as const;
export const STATUS_SHORT = { no_offers: 'אין טיסות', not_searched: 'לא נבדק', error: 'שגיאה' } as const;

export type CellVariant = 'grid' | 'strip' | 'matrix';

export interface FareCellButtonProps {
  depart: string;
  nights: number | null;
  cell: FareCell | undefined;
  variant: CellVariant;
  selected: boolean;
  pending: boolean;
  outOfRange: boolean;
  active: boolean;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  onFocus: () => void;
  onHover: (hovering: boolean) => void;
  buttonRef: (el: HTMLButtonElement | null) => void;
}

function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10));
}

/** One calendar cell: rounded price + tier colour + best marker, or a text/glyph state. Full details in aria-label. */
export function FareCellButton({
  depart,
  nights,
  cell,
  variant,
  selected,
  pending,
  outOfRange,
  active,
  onSelect,
  onKeyDown,
  onFocus,
  onHover,
  buttonRef,
}: FareCellButtonProps) {
  const status = outOfRange ? 'out_of_range' : (cell?.status ?? 'not_searched');
  const price = status === 'priced' ? cellPriceText(cell?.min_total) : null;
  const best = status === 'priced' && cell?.tier === 'best';
  const tone = status === 'priced' ? (cell?.tier ? TIER_CLASSES[cell.tier] : STATUS_CLASSES.priced) : STATUS_CLASSES[status];
  const label = cellAriaLabel({ depart, nights, cell, selected, outOfRange });

  return (
    <button
      ref={buttonRef}
      type="button"
      tabIndex={active ? 0 : -1}
      aria-label={label}
      aria-current={selected ? 'date' : undefined}
      aria-disabled={outOfRange || undefined}
      aria-busy={pending || undefined}
      data-testid="fare-cell"
      data-status={status}
      data-date={depart}
      data-nights={nights ?? ''}
      data-tier={cell?.tier ?? ''}
      data-selected={selected || undefined}
      onClick={() => {
        if (!outOfRange) onSelect();
      }}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      className={cn(
        'relative flex w-full rounded-lg border text-ink-900 transition-[box-shadow,transform] duration-150',
        'focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus',
        !outOfRange && 'cursor-pointer hover:-translate-y-px hover:shadow-md motion-reduce:hover:translate-y-0',
        outOfRange && 'cursor-not-allowed',
        tone,
        selected && 'ring-2 ring-ink-900 ring-offset-1 ring-offset-surface',
        variant === 'grid' && 'h-16 flex-col justify-between p-1.5 text-start sm:h-[4.25rem] sm:p-2',
        variant === 'strip' && 'h-[5.25rem] flex-col items-center justify-center gap-0.5 px-1',
        variant === 'matrix' && 'h-12 min-w-[4.5rem] flex-col items-center justify-center px-1',
      )}
    >
      {variant === 'grid' && (
        <span className="flex w-full items-start justify-between gap-1">
          <span className={cn('text-xs font-semibold tabular-nums', outOfRange ? 'text-ink-300' : 'text-ink-700')}>{dayOfMonth(depart)}</span>
          {best && (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-white/80 px-1 text-2xs font-semibold text-tangerine-800">
              <Star className="size-2.5 fill-current" aria-hidden="true" />
              <span className="hidden lg:inline">הזול</span>
            </span>
          )}
        </span>
      )}
      {variant === 'strip' && (
        <>
          <span className="text-2xs font-medium text-ink-600">{WEEKDAY_SHORT[weekday(depart)]}</span>
          <span className="text-xs font-semibold tabular-nums">
            {dayOfMonth(depart)}.{Number(depart.slice(5, 7))}
          </span>
        </>
      )}
      {best && variant !== 'grid' && <Star className="absolute end-1 top-1 size-2.5 fill-current text-tangerine-800" aria-hidden="true" />}
      {status === 'priced' ? (
        <span className={cn('font-bold tabular-nums leading-tight', variant === 'grid' ? 'text-sm' : 'text-[0.8125rem]')}>{price ?? '—'}</span>
      ) : status === 'out_of_range' ? (
        variant !== 'grid' && <span className="text-xs">·</span>
      ) : (
        <span className={cn('flex items-center leading-tight text-2xs', variant === 'strip' ? 'flex-col gap-0' : 'gap-1')}>
          <span
            aria-hidden="true"
            className={cn(
              'grid size-3.5 shrink-0 place-items-center text-[0.625rem] font-bold',
              status === 'error' && 'rounded-full bg-coral-600 text-white',
            )}
          >
            {STATUS_GLYPH[status]}
          </span>
          <span className={cn(variant === 'matrix' && 'sr-only sm:not-sr-only')}>{STATUS_SHORT[status]}</span>
        </span>
      )}
      {pending && (
        <span className="absolute inset-0 grid place-items-center rounded-lg bg-white/70">
          <Spinner size="sm" decorative />
        </span>
      )}
    </button>
  );
}
