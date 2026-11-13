import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface LegendSwatchProps {
  /** Background utility for the swatch, e.g. "bg-heat-best". */
  className?: string;
  /** Text/icon drawn inside the swatch (e.g. "—", "!", a star icon) — the non-colour cue. */
  marker?: ReactNode;
  size?: 'sm' | 'md';
}

/** Small colour sample with an optional marker. Decorative: the label carries the meaning. */
export function LegendSwatch({ className, marker, size = 'md' }: LegendSwatchProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-[0.3rem] border border-line-strong font-bold leading-none text-fg [&_svg]:size-3',
        size === 'sm' ? 'size-3.5 text-[0.55rem]' : 'size-[1.125rem] text-[0.65rem]',
        className,
      )}
    >
      {marker}
    </span>
  );
}

export interface LegendItem {
  /** Stable key (default: index). */
  id?: string;
  label: ReactNode;
  /** Swatch background utility, e.g. "bg-heat-low". Omit for a marker-only item. */
  swatchClassName?: string;
  marker?: ReactNode;
  /** Short extra text after the label, e.g. a price range. */
  description?: ReactNode;
}

export interface LegendProps {
  items: ReadonlyArray<LegendItem>;
  /** Visible heading, e.g. "מקרא". Also names the list for screen readers. */
  title?: ReactNode;
  /** Accessible name when `title` is not plain text (default "מקרא"). */
  'aria-label'?: string;
  /** Trailing content on the same row (e.g. <ModeBadge mode="DEMO" />). */
  children?: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
  'data-testid'?: string;
}

/**
 * Key for colour-coded views (fare calendar, charts). Each entry = swatch + text, so the
 * meaning never depends on colour alone. Wraps on narrow screens.
 */
export function Legend({ items, title, 'aria-label': ariaLabel, children, size = 'md', className, 'data-testid': testId }: LegendProps) {
  const listLabel = ariaLabel ?? (typeof title === 'string' ? title : 'מקרא');
  return (
    <div
      data-testid={testId}
      className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-fg-muted', size === 'sm' ? 'text-2xs' : 'text-xs', className)}
    >
      {title && <span className="font-semibold text-fg">{title}</span>}
      <ul aria-label={listLabel} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {items.map((item, i) => (
          <li key={item.id ?? i} className="inline-flex items-center gap-1.5">
            <LegendSwatch className={item.swatchClassName} marker={item.marker} size={size} />
            <span>
              {item.label}
              {item.description && <span className="text-fg-subtle"> · {item.description}</span>}
            </span>
          </li>
        ))}
      </ul>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
