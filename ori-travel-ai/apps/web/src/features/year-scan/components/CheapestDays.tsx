import { Search } from 'lucide-react';
import { useId } from 'react';
import { Button, ModeBadge, MoneyText } from '@/components/ui';
import type { FareCell } from '@/lib/schemas/calendar';
import { weekdayDayMonth } from '../model';

export interface CheapestDaysProps {
  days: FareCell[];
  onPick: (cell: FareCell) => void;
  /** Depart date whose search is currently being opened. */
  pendingDate: string | null;
}

/** The cheapest days of the year as a keyboard / screen-reader friendly list (the heatmap's text alternative). */
export function CheapestDays({ days, onPick, pendingDate }: CheapestDaysProps) {
  const headingId = useId();
  if (days.length === 0) return null;
  return (
    <section aria-labelledby={headingId} data-testid="cheapest-days" className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-bold text-fg">
        {days.length} הימים הזולים בשנה
      </h2>
      <ol className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {days.map((cell, i) => (
          <li key={cell.depart_date} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
            <span className="w-6 text-sm font-bold tabular-nums text-fg-subtle">{i + 1}</span>
            <span className="min-w-36 flex-1 font-semibold text-fg">
              {weekdayDayMonth(cell.depart_date)}
              {cell.return_date && (
                <span className="font-normal text-fg-muted"> עד {weekdayDayMonth(cell.return_date)}</span>
              )}
            </span>
            <span className="text-lg font-bold text-fg">
              <MoneyText value={cell.min_total} />
            </span>
            <ModeBadge mode={cell.mode ?? 'DEMO'} size="sm" />
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Search />}
              loading={pendingDate === cell.depart_date}
              disabled={pendingDate !== null && pendingDate !== cell.depart_date}
              onClick={() => onPick(cell)}
              aria-label={`חיפוש טיסות ליום ${weekdayDayMonth(cell.depart_date)}`}
            >
              חיפוש
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}
