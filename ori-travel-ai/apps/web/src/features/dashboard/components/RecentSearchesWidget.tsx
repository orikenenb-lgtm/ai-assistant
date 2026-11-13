import { BedDouble, Car, History, Plane, Search, Ticket, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { QueryState } from '@/components/QueryState';
import { Badge, Card, CardHeader, EmptyState, FreshnessText, Skeleton } from '@/components/ui';
import { describeSearchParams } from '@/features/search/describe';
import { useSearchHistory } from '@/features/search/hooks';
import { CATEGORY_SEARCH_PATH, CATEGORY_SINGULAR } from '@/lib/labels';
import type { Category } from '@/lib/schemas/common';

const ICONS: Record<Category, LucideIcon> = { flight: Plane, hotel: BedDouble, car: Car, activity: Ticket };

const STATUS: Record<string, { label: string; tone: 'success' | 'warn' | 'danger' | 'neutral' }> = {
  completed: { label: 'הושלם', tone: 'success' },
  partial: { label: 'חלקי', tone: 'warn' },
  failed: { label: 'נכשל', tone: 'danger' },
};

export function RecentSearchesWidget() {
  const query = useSearchHistory(1, 5);
  return (
    <Card className="flex flex-col">
      <CardHeader title="חיפושים אחרונים" description="החיפושים האחרונים שלך" icon={<History />} />
      <QueryState
        query={query}
        loading={
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        }
        isEmpty={(d) => d.items.length === 0}
        empty={
          <EmptyState
            compact
            icon={<Search />}
            title="עדיין לא חיפשתם"
            description="חיפושים שתבצעו יופיעו כאן כדי שתוכלו לחזור אליהם."
          />
        }
      >
        {(data) => (
          <ul className="-mx-2 flex flex-col">
            {data.items.map((item) => {
              const Icon = ICONS[item.category];
              const status = STATUS[item.status] ?? { label: item.status, tone: 'neutral' as const };
              return (
                <li key={item.search_id}>
                  <Link
                    to={`${CATEGORY_SEARCH_PATH[item.category]}?search_id=${encodeURIComponent(item.search_id)}`}
                    className="flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors hover:bg-sand-50"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-ink-50 text-ink-600" aria-hidden="true">
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-fg">
                        <span className="sr-only">{CATEGORY_SINGULAR[item.category]}: </span>
                        {describeSearchParams(item.category, item.params)}
                      </span>
                      <span className="flex items-center gap-2 text-xs text-fg-subtle">
                        <FreshnessText value={item.created_at} prefix="" />
                        {typeof item.result_count === 'number' && <span>· {item.result_count} תוצאות</span>}
                      </span>
                    </span>
                    <Badge tone={status.tone} size="sm">
                      {status.label}
                    </Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>
    </Card>
  );
}
