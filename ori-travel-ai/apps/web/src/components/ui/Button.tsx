import type { ComponentProps, ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-ink-900 text-white shadow-xs hover:bg-ink-800 active:bg-ink-950',
  accent: 'bg-sea-600 text-white shadow-xs hover:bg-sea-700 active:bg-sea-800',
  secondary:
    'border border-line-strong bg-surface text-fg shadow-xs hover:border-sand-400 hover:bg-sand-50 active:bg-sand-100',
  ghost: 'text-fg-muted hover:bg-ink-50 hover:text-fg active:bg-ink-100',
  danger: 'bg-coral-600 text-white shadow-xs hover:bg-coral-700 active:bg-coral-700',
  link: 'text-accent underline-offset-4 hover:underline hover:text-accent-hover',
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
    'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-md font-medium',
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
