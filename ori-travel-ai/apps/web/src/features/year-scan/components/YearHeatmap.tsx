import { Star } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type MouseEvent } from 'react';
import { formatMoney } from '@/lib/format';
import type { FareCalendarResponse, FareCell } from '@/lib/schemas/calendar';
import { prefersReducedMotion } from '@/features/search/useMediaQuery';
import { cellAmount, heatColor, HEAT_STEPS, longDate, monthRows, rankFractions } from '../model';

export interface YearHeatmapProps {
  scan: FareCalendarResponse;
  /** Depart date of the cheapest day (highlighted). */
  bestDate: string | null;
  /** Mouse shortcut: clicking a priced day runs the normal search for it (keyboard users use the cheapest-days list). */
  onPickDay: (cell: FareCell) => void;
  disabled?: boolean;
}

const REVEAL_MS = 1600;
const DAY_NUMBERS = Array.from({ length: 31 }, (_, i) => i + 1);

function cellTitle(cell: FareCell, currency: string): string {
  const date = longDate(cell.depart_date);
  if (cell.status === 'priced' && cell.min_total) {
    const price = formatMoney(cell.min_total.amount, cell.min_total.currency) ?? '';
    return `${date}: ${price} (${cell.mode === 'DEMO' ? 'הדגמה' : 'מחיר שמור'})`;
  }
  return `${date}: ${cell.message ?? (cell.status === 'no_offers' ? 'אין טיסות' : 'לא נבדק')} · ${currency}`;
}

/**
 * Year heatmap: one row per month, one column per day of month, colour = price (cheap sky → expensive red).
 * Cells are revealed progressively ("scanning") unless the user prefers reduced motion; the counter shows how many
 * days were actually checked. The grid is a picture for sighted users — the same data is available as text in the
 * summary below it and in the cheapest-days list.
 */
export function YearHeatmap({ scan, bestDate, onPickDay, disabled = false }: YearHeatmapProps) {
  const headingId = useId();
  const rows = useMemo(() => monthRows(scan.cells), [scan.cells]);
  const order = useMemo(() => new Map(scan.cells.map((c, i) => [c.depart_date, i])), [scan.cells]);
  const ranks = useMemo(
    () => rankFractions(scan.cells.map(cellAmount).filter((a): a is number => a !== null)),
    [scan.cells],
  );
  const total = scan.cells.length;
  const checked = scan.cells.filter((c) => c.status === 'priced' || c.status === 'no_offers').length;

  const [revealed, setRevealed] = useState(() => (prefersReducedMotion() ? total : 0));
  // Remounted per scan (the parent keys it), so the reveal starts from 0 for every new result.
  useEffect(() => {
    if (prefersReducedMotion()) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const n = Math.min(total, Math.ceil(((now - start) / REVEAL_MS) * total));
      setRevealed(n);
      if (n < total) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [total]);

  const byDate = useMemo(() => new Map(scan.cells.map((c) => [c.depart_date, c])), [scan.cells]);
  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const date = (e.target as HTMLElement).closest<HTMLElement>('[data-date]')?.dataset.date;
    const cell = date ? byDate.get(date) : undefined;
    if (!disabled && cell && cellAmount(cell) !== null) onPickDay(cell);
  };

  const done = revealed >= total;
  const shownChecked = done ? checked : Math.round((revealed / Math.max(total, 1)) * checked);

  return (
    <section aria-labelledby={headingId} data-testid="year-heatmap" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id={headingId} className="text-lg font-bold text-fg">
            כל השנה במבט אחד
          </h2>
          <p className="text-sm text-fg-muted">כל משבצת היא יום יציאה. הצבע מראה את המחיר הזול שנמצא לאותו יום.</p>
        </div>
        <p
          className="flex items-baseline gap-2 text-sm text-fg-muted"
          aria-live="polite"
          data-testid="year-scan-counter"
        >
          <span className="text-2xl font-extrabold tabular-nums text-deal">{shownChecked}</span>
          ימים נסרקו
          {!done && <span className="sr-only">סורקים…</span>}
        </p>
      </div>

      {/* Mouse shortcut only (delegated click): the accessible path is the cheapest-days list. */}
      <div className="overflow-x-auto" onClick={pick}>
        <div
          role="img"
          aria-label={`מפת חום של ${checked} ימי יציאה בשנה הקרובה. המחיר הנמוך: ${scan.stats.min ? formatMoney(scan.stats.min.amount, scan.stats.min.currency) : 'לא נמצא'}, הגבוה: ${scan.stats.max ? formatMoney(scan.stats.max.amount, scan.stats.max.currency) : 'לא נמצא'}. רשימת הימים הזולים מופיעה בהמשך.`}
          className="grid min-w-[22rem] items-center gap-[3px]"
          style={{
            gridTemplateColumns: 'minmax(4.5rem, auto) repeat(31, minmax(0, 1fr))',
          }}
        >
          <span aria-hidden="true" />
          {DAY_NUMBERS.map((d) => (
            <span
              key={d}
              aria-hidden="true"
              className="text-center text-[0.6rem] leading-none text-fg-subtle tabular-nums"
            >
              {d % 5 === 0 || d === 1 ? d : ''}
            </span>
          ))}
          {rows.map((row) => (
            <div key={row.key} className="contents">
              <span aria-hidden="true" className="truncate pe-2 text-xs font-medium text-fg-muted">
                {row.label}
              </span>
              {row.days.map((cell, i) => {
                if (!cell) return <span key={i} aria-hidden="true" className="aspect-square" />;
                const shown = (order.get(cell.depart_date) ?? 0) < revealed;
                const amount = cellAmount(cell);
                const best = cell.depart_date === bestDate;
                const priced = amount !== null;
                return (
                  <span
                    key={i}
                    title={cellTitle(cell, scan.currency)}
                    data-date={cell.depart_date}
                    data-status={cell.status}
                    data-best={best || undefined}
                    className={[
                      'relative aspect-square rounded-[3px] transition-[transform,opacity] duration-200',
                      priced && !disabled ? 'cursor-pointer hover:z-10 hover:scale-125' : 'cursor-default',
                      !shown && 'scale-75 opacity-0',
                      !priced && 'border border-dashed border-ink-300 bg-surface',
                      best && 'z-10 ring-2 ring-fg ring-offset-1 ring-offset-surface',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={priced ? { backgroundColor: heatColor(ranks.get(amount) ?? 0) } : undefined}
                  >
                    {best && shown && (
                      <Star className="absolute inset-0 m-auto size-[70%] fill-white text-white" aria-hidden="true" />
                    )}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-fg-muted" data-testid="year-legend">
        <span className="flex items-center gap-2">
          <span>זול</span>
          <span aria-hidden="true" className="flex gap-0.5">
            {HEAT_STEPS.map((c) => (
              <span key={c} className="size-3 rounded-[3px]" style={{ backgroundColor: c }} />
            ))}
          </span>
          <span>יקר</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden="true" className="size-3 rounded-[3px] border border-dashed border-ink-300 bg-surface" />
          לא נבדק / אין טיסות
        </span>
        <span className="flex items-center gap-1.5">
          <Star className="size-3.5 fill-current" aria-hidden="true" />
          היום הזול ביותר
        </span>
        <span>מעבר עם העכבר על יום מציג את המחיר, ולחיצה פותחת חיפוש לתאריך הזה.</span>
      </div>
    </section>
  );
}
