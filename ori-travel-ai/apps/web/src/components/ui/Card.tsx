import type { ComponentProps, ElementType, ReactNode } from 'react';
import { cn } from '@/lib/cn';

const PADDING = { none: '', sm: 'p-4', md: 'p-5 sm:p-6', lg: 'p-6 sm:p-8' } as const;

export interface CardProps extends ComponentProps<'div'> {
  as?: ElementType;
  padding?: keyof typeof PADDING;
  /** Adds hover elevation (use when the whole card is a link). */
  interactive?: boolean;
}

export function Card({ as: Comp = 'div', padding = 'md', interactive = false, className, ...rest }: CardProps) {
  return (
    <Comp
      className={cn(
        'rounded-xl border border-line bg-surface shadow-sm',
        interactive && 'transition-shadow duration-200 hover:border-line-strong hover:shadow-md',
        PADDING[padding],
        className,
      )}
      {...rest}
    />
  );
}

export interface CardHeaderProps extends Omit<ComponentProps<'div'>, 'title'> {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  /** Heading level for the title (default h2). */
  level?: 2 | 3 | 4;
}

export function CardHeader({ title, description, icon, actions, level = 2, className, ...rest }: CardHeaderProps) {
  const Heading = `h${level}` as 'h2' | 'h3' | 'h4';
  return (
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)} {...rest}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && (
          <span
            className="grid size-9 shrink-0 place-items-center rounded-lg bg-sea-50 text-sea-700 [&_svg]:size-[1.125rem]"
            aria-hidden="true"
          >
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <Heading className="text-base font-semibold text-fg">{title}</Heading>
          {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardFooter({ className, ...rest }: ComponentProps<'div'>) {
  return <div className={cn('mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4', className)} {...rest} />;
}
