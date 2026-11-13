import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { buttonClasses } from './Button';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  className?: string;
}

function pageWindow(current: number, last: number): Array<number | 'gap'> {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const pages = new Set([1, last, current - 1, current, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= last).sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

/** Page navigation for `Page<T>` responses (1-based pages). RTL: "previous" points right. */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const last = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <nav aria-label="דפדוף בין עמודים" className={cn('flex flex-col items-center gap-3 sm:flex-row sm:justify-between', className)}>
      <p className="text-sm text-fg-muted tabular-nums">
        מציג {formatNumber(from)}–{formatNumber(to)} מתוך {formatNumber(total)}
      </p>
      <ul className="flex items-center gap-1">
        <li>
          <button
            type="button"
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
          >
            <ChevronRight className="ltr:rotate-180" aria-hidden="true" />
            הקודם
          </button>
        </li>
        {pageWindow(page, last).map((p, i) =>
          p === 'gap' ? (
            <li key={`gap-${i}`} aria-hidden="true" className="px-1 text-fg-subtle">
              …
            </li>
          ) : (
            <li key={p} className="hidden sm:block">
              <button
                type="button"
                className={cn(
                  buttonClasses({ variant: p === page ? 'primary' : 'ghost', size: 'sm' }),
                  'min-w-8 px-2 tabular-nums',
                )}
                aria-current={p === page ? 'page' : undefined}
                aria-label={`עמוד ${p}`}
                onClick={() => onPageChange(p)}
              >
                {p}
              </button>
            </li>
          ),
        )}
        <li>
          <button
            type="button"
            className={buttonClasses({ variant: 'ghost', size: 'sm' })}
            onClick={() => onPageChange(page + 1)}
            disabled={page >= last}
          >
            הבא
            <ChevronLeft className="ltr:rotate-180" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </nav>
  );
}
