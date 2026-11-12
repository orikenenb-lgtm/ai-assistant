import type { Key, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Skeleton } from './Skeleton';

export interface DataTableColumn<T> {
  id: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
  /** Hide on small screens (below sm). */
  hideOnMobile?: boolean;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T) => Key;
  /** Required table caption for screen readers (visually hidden unless captionVisible). */
  caption: string;
  captionVisible?: boolean;
  loading?: boolean;
  loadingRows?: number;
  /** Rendered instead of the table body when there are no rows. */
  empty?: ReactNode;
  dense?: boolean;
  className?: string;
}

const ALIGN = { start: 'text-start', center: 'text-center', end: 'text-end' } as const;

/**
 * Simple semantic table. Scrolls horizontally inside its own container on narrow screens.
 * The container is `relative` so absolutely positioned descendants (the sr-only caption,
 * sr-only cell text) are contained by it and cannot widen the page.
 */
export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  caption,
  captionVisible = false,
  loading = false,
  loadingRows = 4,
  empty,
  dense = false,
  className,
}: DataTableProps<T>) {
  const cellPad = dense ? 'px-3 py-2' : 'px-4 py-3';
  if (!loading && rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={cn('scrollbar-thin relative overflow-x-auto rounded-xl border border-line bg-surface shadow-xs', className)}>
      <table className="w-full border-collapse text-sm tabular-nums" aria-busy={loading || undefined}>
        <caption className={cn(captionVisible ? 'px-4 pt-3 text-start text-sm font-semibold text-fg' : 'sr-only')}>
          {caption}
        </caption>
        <thead>
          <tr className="bg-surface-sunken">
            {columns.map((col) => (
              <th
                key={col.id}
                scope="col"
                className={cn(
                  cellPad,
                  'whitespace-nowrap border-b border-line text-xs font-semibold text-fg-muted',
                  ALIGN[col.align ?? 'start'],
                  col.hideOnMobile && 'hidden sm:table-cell',
                  col.className,
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading
            ? Array.from({ length: loadingRows }, (_, i) => (
                <tr key={`sk-${i}`} className="border-t border-line first:border-t-0">
                  {columns.map((col) => (
                    <td key={col.id} className={cn(cellPad, col.hideOnMobile && 'hidden sm:table-cell')}>
                      <Skeleton className="h-4 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row) => (
                <tr key={getRowKey(row)} className="border-t border-line transition-colors first:border-t-0 hover:bg-surface-hover">
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        cellPad,
                        'text-fg',
                        ALIGN[col.align ?? 'start'],
                        col.hideOnMobile && 'hidden sm:table-cell',
                        col.className,
                      )}
                    >
                      {col.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
        </tbody>
      </table>
    </div>
  );
}
