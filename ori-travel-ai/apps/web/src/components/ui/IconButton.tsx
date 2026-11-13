import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { buttonClasses, type ButtonVariant } from './Button';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';

const SIZES = { sm: 'size-8', md: 'size-10', lg: 'size-12' } as const;

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  /** Required accessible name (Hebrew). Also used as the tooltip text. */
  label: string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: keyof typeof SIZES;
  loading?: boolean;
  /** Show the label as a tooltip on hover/focus (default true). */
  showTooltip?: boolean;
}

export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  loading = false,
  showTooltip = true,
  className,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const button = (
    <button
      type={type}
      aria-label={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses({ variant, size }), 'px-0', SIZES[size], '[&_svg]:size-5', className)}
      {...rest}
    >
      {loading ? <Spinner size="sm" decorative /> : icon}
    </button>
  );
  return showTooltip ? <Tooltip content={label}>{button}</Tooltip> : button;
}
