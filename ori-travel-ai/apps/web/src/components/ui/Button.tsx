import type { ComponentProps, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'link' | 'deal';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Hierarchy: primary (solid accent — one per view) > accent (tonal accent) > secondary
 * (outline) > ghost. `deal` is reserved for the featured/best-deal panel (tangerine).
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-fg shadow-xs hover:bg-accent-hover active:bg-sea-800',
  accent:
    'border border-accent-line bg-accent-soft text-accent-strong hover:border-sea-300 hover:bg-sea-100 active:bg-sea-100',
  secondary:
    'border border-line-strong bg-surface text-fg shadow-xs hover:border-ink-300 hover:bg-surface-hover active:bg-surface-sunken',
  ghost: 'text-fg-muted hover:bg-surface-hover hover:text-fg active:bg-surface-sunken',
  danger: 'bg-coral-600 text-white shadow-xs hover:bg-coral-700 active:bg-coral-700',
  link: 'text-accent underline-offset-4 hover:underline hover:text-accent-hover',
  deal: 'bg-deal-strong text-white shadow-xs hover:bg-deal active:bg-tangerine-800',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-sm',
  md: 'h-10 gap-2 px-4 text-sm',
  lg: 'h-12 gap-2 px-6 text-base',
};

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Class string for button-looking elements (links, Radix triggers). */
export function buttonClasses({ variant = 'primary', size = 'md', fullWidth, className }: ButtonStyleOptions = {}) {
  return cn(
    'touch-target inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium',
    'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55',
    '[&_svg]:size-4 [&_svg]:shrink-0',
    VARIANTS[variant],
    variant === 'link' ? 'h-auto px-0 text-sm' : SIZES[size],
    fullWidth && 'w-full',
    className,
  );
}

export interface ButtonProps extends ComponentProps<'button'>, Omit<ButtonStyleOptions, 'className'> {
  loading?: boolean;
  /** Text announced/visible while loading (defaults to children). */
  loadingText?: ReactNode;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

export function Button({
  variant,
  size,
  fullWidth,
  loading = false,
  loadingText,
  leadingIcon,
  trailingIcon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={buttonClasses({ variant, size, fullWidth, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size="sm" decorative /> : leadingIcon}
      {loading && loadingText ? loadingText : children}
      {!loading && trailingIcon}
    </button>
  );
}

export interface ButtonLinkProps extends LinkProps, Omit<ButtonStyleOptions, 'className'> {
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

/** A react-router Link styled as a button (for navigation, not actions). */
export function ButtonLink({
  variant,
  size,
  fullWidth,
  leadingIcon,
  trailingIcon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClasses({ variant, size, fullWidth, className: className as string | undefined })} {...rest}>
      {leadingIcon}
      {children}
      {trailingIcon}
    </Link>
  );
}
