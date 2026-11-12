import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';

/** Content for screen readers only. */
export function VisuallyHidden({ className, ...rest }: ComponentProps<'span'>) {
  return <span className={cn('sr-only', className)} {...rest} />;
}

/** Keyboard key hint, e.g. <Kbd>Esc</Kbd>. Always LTR. */
export function Kbd({ className, ...rest }: ComponentProps<'kbd'>) {
  return (
    <kbd
      dir="ltr"
      className={cn(
        'inline-flex min-w-6 items-center justify-center rounded border border-line-strong border-b-2 bg-surface px-1.5 font-mono text-xs text-fg-muted',
        className,
      )}
      {...rest}
    />
  );
}
