import { useId, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SegmentedOption<V extends string = string> {
  value: V;
  /** Visible text (Hebrew). With `iconOnly` it becomes the screen-reader-only name. */
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** Extra hook for tests, e.g. "view-table". */
  testId?: string;
}

export interface SegmentedProps<V extends string = string> {
  /** Accessible name of the group (required), e.g. "תצוגת תוצאות". */
  label: string;
  options: ReadonlyArray<SegmentedOption<V>>;
  /** Controlled value. */
  value?: V;
  /** Initial value when uncontrolled (default: first enabled option). */
  defaultValue?: V;
  onValueChange?: (value: V) => void;
  size?: 'sm' | 'md';
  /** Stretch to the container width; options share the space equally. */
  fullWidth?: boolean;
  /** Show only the icons; labels stay available to screen readers. */
  iconOnly?: boolean;
  disabled?: boolean;
  /** Radio group name (default: generated). */
  name?: string;
  className?: string;
  'data-testid'?: string;
}

const SIZES = {
  sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
  md: 'h-8 px-3 text-sm [&_svg]:size-4',
} as const;

/**
 * Segmented control / toggle group for one-of-few choices (list ⇄ table, month ⇄ matrix).
 * Built on native radio inputs: Tab enters the group, arrow keys move the selection
 * (browser-native, RTL aware), Space selects; the state is announced as "checked".
 * The selected segment differs by surface, weight and shadow — never by colour alone.
 */
export function Segmented<V extends string = string>({
  label,
  options,
  value,
  defaultValue,
  onValueChange,
  size = 'md',
  fullWidth = false,
  iconOnly = false,
  disabled = false,
  name,
  className,
  'data-testid': testId,
}: SegmentedProps<V>) {
  const generated = useId();
  const groupName = name ?? `seg-${generated}`;
  const [internal, setInternal] = useState<V | undefined>(
    () => defaultValue ?? options.find((o) => !o.disabled)?.value,
  );
  const current = value !== undefined ? value : internal;

  function select(next: V) {
    if (value === undefined) setInternal(next);
    onValueChange?.(next);
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      data-testid={testId}
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      {options.map((option) => {
        const checked = option.value === current;
        const isDisabled = disabled || option.disabled;
        return (
          <label
            key={option.value}
            data-testid={option.testId}
            data-state={checked ? 'checked' : 'unchecked'}
            className={cn('group touch-target flex min-w-0', fullWidth && 'flex-1', isDisabled ? 'cursor-not-allowed' : 'cursor-pointer')}
          >
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={checked}
              disabled={isDisabled}
              onChange={() => select(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors duration-150',
                'text-fg-muted group-hover:text-fg peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-focus',
                'peer-checked:bg-surface peer-checked:font-semibold peer-checked:text-fg peer-checked:shadow-xs peer-checked:ring-1 peer-checked:ring-line-strong',
                'peer-disabled:opacity-50 [&_svg]:shrink-0',
                SIZES[size],
              )}
            >
              {option.icon && <span aria-hidden="true" className="inline-flex">{option.icon}</span>}
              {iconOnly ? <span className="sr-only">{option.label}</span> : <span className="truncate">{option.label}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
