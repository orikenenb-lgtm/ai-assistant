import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

export type BadgeTone =
  | 'neutral'
  | 'muted'
  | 'accent'
  | 'success'
  | 'info'
  | 'warn'
  | 'danger'
  | 'demo'
  | 'dark'
  | 'deal'
  | 'low';

/** Every tone pairs a tinted background with its 700/800 text step (≥ 6:1 in both themes). */
export const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-ink-200 bg-ink-50 text-ink-700',
  muted: 'border-ink-200 bg-surface text-ink-600',
  accent: 'border-sea-200 bg-sea-50 text-sea-700',
  success: 'border-moss-200 bg-moss-50 text-moss-700',
  info: 'border-harbor-200 bg-harbor-50 text-harbor-700',
  warn: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-coral-200 bg-coral-50 text-coral-700',
  /** DEMO data: dashed outline = "not real". Calm but always visible. */
  demo: 'border-dashed border-sand-500 bg-sand-100 font-semibold text-sand-800',
  dark: 'border-ink-900 bg-ink-900 text-white',
  /** Best / featured deal (tangerine) — reserve for the single best offer. */
  deal: 'border-tangerine-200 bg-tangerine-50 font-semibold text-tangerine-800',
  /** Low price (sky). */
  low: 'border-sky-200 bg-sky-50 text-sky-800',
};

const SIZES = {
  sm: 'gap-1 px-2 py-0.5 text-2xs [&_svg]:size-3',
  md: 'gap-1.5 px-2.5 py-0.5 text-xs [&_svg]:size-3.5',
} as const;

export interface BadgeProps extends ComponentProps<'span'> {
  tone?: BadgeTone;
  size?: keyof typeof SIZES;
}

export function Badge({ tone = 'neutral', size = 'md', className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border font-medium leading-5 [&_svg]:shrink-0',
        BADGE_TONES[tone],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}
