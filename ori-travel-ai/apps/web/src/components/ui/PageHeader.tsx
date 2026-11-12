import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { useDocumentTitle } from '@/lib/useDocumentTitle';

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Small label above the title (e.g. section name). */
  eyebrow?: ReactNode;
  icon?: ReactNode;
  /** Buttons/links aligned to the end. */
  actions?: ReactNode;
  /** Extra content below (badges, tabs). */
  children?: ReactNode;
  /** Sets document.title (default: title). Pass null to skip. */
  documentTitle?: string | null;
  className?: string;
}

/** The page's single <h1>. Every page should render exactly one PageHeader. */
export function PageHeader({
  title,
  description,
  eyebrow,
  icon,
  actions,
  children,
  documentTitle,
  className,
}: PageHeaderProps) {
  useDocumentTitle(documentTitle === undefined ? title : documentTitle);
  return (
    <header className={cn('mb-6 flex flex-col gap-4 sm:mb-8', className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          {icon && (
            <span
              className="mt-0.5 grid size-11 shrink-0 place-items-center rounded-xl border border-accent-line bg-accent-soft text-accent-strong [&_svg]:size-5"
              aria-hidden="true"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            {eyebrow && <p className="mb-1 text-xs font-semibold text-accent-strong">{eyebrow}</p>}
            <h1 className="text-2xl font-bold tracking-tight text-fg sm:text-[1.75rem]">{title}</h1>
            {description && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-fg-muted sm:text-base">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}
