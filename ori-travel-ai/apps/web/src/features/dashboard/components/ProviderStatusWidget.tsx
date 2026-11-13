import { PlugZap } from 'lucide-react';
import { Link } from 'react-router';
import { QueryState } from '@/components/QueryState';
import { Card, CardHeader, EmptyState, ModeBadge, Skeleton } from '@/components/ui';
import { useProviders } from '@/features/providers/hooks';
import { CATEGORY_LABELS } from '@/lib/labels';
import { providerCategories, providerDisplayName, providerMode, type ProviderStatus } from '@/lib/schemas/providers';

const MAX_SHOWN = 6;
const STATUS_ORDER = { OK: 0, DEGRADED: 1, FAILED: 2, NOT_CONFIGURED: 3, DISABLED: 4 } as const;

/** A provider contributes results only when enabled + configured. */
function isActive(p: ProviderStatus): boolean {
  return p.enabled && p.configured && p.status !== 'DISABLED' && p.status !== 'NOT_CONFIGURED';
}

export function ProviderStatusWidget() {
  const query = useProviders();
  return (
    <Card>
      <CardHeader
        title="מצב ספקים"
        description="מאיפה מגיעים הנתונים בחיפושים"
        icon={<PlugZap />}
        actions={
          <Link to="/providers" className="text-sm font-medium text-accent hover:underline">
            ספקים ואבחון
          </Link>
        }
      />
      <QueryState
        query={query}
        loading={
          <div className="grid gap-3 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        }
        isEmpty={(d) => d.length === 0}
        empty={<EmptyState compact icon={<PlugZap />} title="לא הוגדרו ספקים" />}
      >
        {(providers) => {
          const healthy = providers.filter((p) => isActive(p) && p.status === 'OK').length;
          const sorted = [...providers].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
          const shown = sorted.slice(0, MAX_SHOWN);
          const hidden = providers.length - shown.length;
          return (
            <>
              <p className="mb-3 text-sm text-fg-muted">
                {healthy} מתוך {providers.length} ספקים פעילים ותקינים
              </p>
              <ul className="grid gap-2.5 sm:grid-cols-2">
                {shown.map((p) => {
                  const mode = providerMode(p);
                  const cats = providerCategories(p);
                  const kind = mode === 'LIVE' ? 'ספק רשמי' : mode === 'DEMO' ? 'ספק הדגמה' : null;
                  return (
                    <li key={p.provider_id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-fg">{providerDisplayName(p)}</span>
                        <span className="block truncate text-xs text-fg-subtle">
                          {[kind, ...cats.map((c) => CATEGORY_LABELS[c])].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        {/* Data-mode badge only when the provider actually supplies results */}
                        {mode && isActive(p) && <ModeBadge mode={mode} size="sm" />}
                        <ModeBadge mode={p.status} size="sm" />
                      </span>
                    </li>
                  );
                })}
              </ul>
              {hidden > 0 && (
                <p className="mt-3 text-sm text-fg-muted">
                  ועוד {hidden} ספקים —{' '}
                  <Link to="/providers" className="font-medium text-accent hover:underline">
                    לרשימה המלאה
                  </Link>
                </p>
              )}
            </>
          );
        }}
      </QueryState>
    </Card>
  );
}
