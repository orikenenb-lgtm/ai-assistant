import { Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { STATUS_CLASSES, STATUS_GLYPH, TIER_CLASSES } from './FareCellButton';

const ITEMS: Array<{ key: string; label: string; swatch: string; glyph?: string; star?: boolean; ring?: boolean }> = [
  { key: 'best', label: 'המחיר הנמוך בלוח', swatch: TIER_CLASSES.best, star: true },
  { key: 'low', label: 'נמוך', swatch: TIER_CLASSES.low },
  { key: 'mid', label: 'בינוני', swatch: TIER_CLASSES.mid },
  { key: 'high', label: 'גבוה', swatch: TIER_CLASSES.high },
  { key: 'no_offers', label: 'אין טיסות', swatch: STATUS_CLASSES.no_offers, glyph: STATUS_GLYPH.no_offers },
  { key: 'not_searched', label: 'לא נבדק', swatch: STATUS_CLASSES.not_searched, glyph: STATUS_GLYPH.not_searched },
  { key: 'error', label: 'שגיאה בבדיקה', swatch: STATUS_CLASSES.error, glyph: STATUS_GLYPH.error },
  { key: 'selected', label: 'החיפוש הנוכחי', swatch: 'bg-surface border-line', ring: true },
];

/** Legend for every cell state; each swatch also shows the cell's glyph/marker so the legend is not colour-only. */
export function CalendarLegend({ id, note, className }: { id?: string; note?: string | null; className?: string }) {
  return (
    <div id={id} className={cn('flex flex-col gap-1.5', className)} data-testid="fare-legend">
      <h3 className="sr-only">מקרא לוח המחירים</h3>
      <ul className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-xs text-fg-muted">
        {ITEMS.map((it) => (
          <li key={it.key} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={cn(
                'relative grid size-4 place-items-center rounded border text-[0.5625rem] font-bold text-ink-800',
                it.swatch,
                it.ring && 'ring-2 ring-ink-900 ring-offset-1',
              )}
            >
              {it.glyph}
              {it.star && <Star className="size-2.5 fill-current text-tangerine-800" />}
            </span>
            {it.label}
          </li>
        ))}
      </ul>
      {note && <p className="text-xs leading-relaxed text-fg-subtle">{note}</p>}
    </div>
  );
}
