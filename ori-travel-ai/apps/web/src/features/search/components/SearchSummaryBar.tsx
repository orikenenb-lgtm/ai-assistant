import { ArrowLeft, Pencil } from 'lucide-react';
import { Button, Card, FreshnessText } from '@/components/ui';
import { cabinLabel, countLabel } from '@/features/offers/labels';
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
  return `${countLabel(adults, 'מבוגר אחד', 'מבוגרים')}${kids ? ` + ${countLabel(kids, 'ילד אחד', 'ילדים')}` : ''}`;
}

/** Flight-only facts that change the fare: cabin, checked bags, date flexibility, budget. */
function flightChips(p: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof p.cabin === 'string') out.push(cabinLabel(p.cabin));
  if (typeof p.checked_bags === 'number' && p.checked_bags > 0) out.push(`${p.checked_bags === 1 ? 'מזוודה לבטן' : `${p.checked_bags} מזוודות לבטן`} לנוסע`);
  if (typeof p.flex_days === 'number' && p.flex_days > 0) out.push(`גמישות ±${p.flex_days === 1 ? 'יום' : `${p.flex_days} ימים`}`);
  if (typeof p.max_stops === 'number') out.push(p.max_stops === 0 ? 'ישירות בלבד' : `עד ${p.max_stops === 1 ? 'עצירה אחת' : `${p.max_stops} עצירות`}`);
  if ((typeof p.max_price === 'string' || typeof p.max_price === 'number') && String(p.max_price).trim())
    out.push(`תקציב עד ${String(p.max_price).replace(/\.0+$/, '')} ${typeof p.currency === 'string' ? p.currency : ''}`.trim());
  return out;
}

export interface SearchSummaryBarProps {
  data: SearchResponse;
  onEdit: () => void;
  /** Hebrew city name for an IATA code (flights). */
  placeName?: (code: string) => string | undefined;
}

/** Collapsed search header: one light line summarising the current search, with an edit button. */
export function SearchSummaryBar({ data, onEdit, placeName }: SearchSummaryBarProps) {
  const t = travellers(data.params);
  const flight = data.category === 'flight';
  const origin = typeof data.params.origin === 'string' ? data.params.origin : null;
  const destination = typeof data.params.destination === 'string' ? data.params.destination : null;
  const chips = flight ? flightChips(data.params) : [];
  return (
    <Card padding="sm" className="flex flex-wrap items-center justify-between gap-3" data-testid="search-summary">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-base font-semibold text-fg">
          <span className="sr-only">החיפוש הנוכחי: </span>
          {flight && origin && destination && placeName && (
            <span className="inline-flex items-center gap-1">
              {placeName(origin) ?? origin}
              <ArrowLeft className="size-4 text-fg-subtle ltr:rotate-180" aria-hidden="true" />
              <span className="sr-only">אל</span>
              {placeName(destination) ?? destination}
            </span>
          )}
          <span className={flight && placeName ? 'text-sm font-medium text-fg-muted' : undefined}>{describeSearchParams(data.category, data.params)}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-fg-muted">
          {t && <span>{t}</span>}
          {chips.map((c) => (
            <span key={c} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true">·</span>
              {c}
            </span>
          ))}
          <span aria-hidden="true">·</span>
          <FreshnessText value={data.created_at} prefix="בוצע" />
        </p>
      </div>
      <Button variant="secondary" leadingIcon={<Pencil aria-hidden="true" />} onClick={onEdit}>
        עריכת החיפוש
      </Button>
    </Card>
  );
}
