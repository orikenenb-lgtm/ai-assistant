import { Pencil } from 'lucide-react';
import { Button, Card, FreshnessText } from '@/components/ui';
import { describeSearchParams } from '../describe';
import type { SearchResponse } from '@/lib/schemas/search';

function travellers(params: Record<string, unknown>): string | null {
  const rooms = Array.isArray(params.rooms) ? params.rooms : null;
  const adults = rooms
    ? rooms.reduce<number>((a, r) => a + (typeof (r as { adults?: unknown })?.adults === 'number' ? (r as { adults: number }).adults : 0), 0)
    : typeof params.adults === 'number'
      ? params.adults
      : null;
  const kids = rooms
    ? rooms.reduce<number>((a, r) => a + (Array.isArray((r as { children_ages?: unknown })?.children_ages) ? (r as { children_ages: unknown[] }).children_ages.length : 0), 0)
    : Array.isArray(params.children_ages)
      ? params.children_ages.length
      : 0;
  if (adults === null) return null;
  return `${adults} מבוגרים${kids ? ` + ${kids} ילדים` : ''}`;
}

/** Collapsed form: one line summarising the current search, with an edit button. */
export function SearchSummaryBar({ data, onEdit }: { data: SearchResponse; onEdit: () => void }) {
  const t = travellers(data.params);
  return (
    <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3" data-testid="search-summary">
      <div className="min-w-0">
        <p className="truncate text-base font-semibold text-fg">
          <span className="sr-only">החיפוש הנוכחי: </span>
          {describeSearchParams(data.category, data.params)}
        </p>
        <p className="text-xs text-fg-muted">
          {t && <>{t} · </>}
          <FreshnessText value={data.created_at} prefix="בוצע" />
        </p>
      </div>
      <Button variant="secondary" leadingIcon={<Pencil aria-hidden="true" />} onClick={onEdit}>
        עריכת החיפוש
      </Button>
    </Card>
  );
}
