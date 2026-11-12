import { TriangleAlert, Wallet } from 'lucide-react';
import { QueryState } from '@/components/QueryState';
import { Badge, Callout, Card, CardHeader, MoneyText } from '@/components/ui';
import type { Budget, BudgetCurrencyRow } from '@/lib/schemas/trips';
import { useTripBudget } from '../hooks';
import { kindLabel } from '../labels';

const isZero = (v: string) => /^-?0+(\.0+)?$/.test(v);

function CurrencyBlock({ row }: { row: BudgetCurrencyRow }) {
  return (
    <div className="rounded-lg border border-line p-3" data-testid="budget-currency" data-currency={row.currency}>
      <p className="mb-2 flex items-baseline justify-between text-sm">
        <span className="font-medium text-fg">נספר בתקציב</span>
        <MoneyText amount={row.counted} currency={row.currency} className="text-base font-semibold text-fg" />
      </p>
      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm text-fg-muted">
        <dt>ידוע</dt>
        <dd className="text-end">
          <MoneyText amount={row.known} currency={row.currency} />
        </dd>
        <dt>הערכה</dt>
        <dd className="text-end">
          <MoneyText amount={row.estimated} currency={row.currency} estimated={!isZero(row.estimated)} />
        </dd>
        <dt>לא נכלל</dt>
        <dd className="text-end">
          <MoneyText amount={row.excluded} currency={row.currency} />
        </dd>
      </dl>
    </div>
  );
}

const REASONS: Record<Budget['remaining_reason'], string> = {
  ok: '',
  no_budget: 'לא הוגדר תקציב לטיול — ערכו את הטיול כדי להוסיף תקציב ולראות כמה נשאר.',
  mixed_currencies: 'בטיול עלויות במטבעות שונים, ולכן אי אפשר לחשב יתרה אחת. הסכומים מוצגים לפי מטבע, בלי המרה.',
};

export function BudgetPanel({ tripId }: { tripId: string }) {
  const query = useTripBudget(tripId);
  return (
    <Card>
      <CardHeader title="תקציב" description="לפי מטבע — בלי המרות" icon={<Wallet />} />
      <QueryState query={query} errorTitle="לא ניתן לטעון את התקציב">
        {(b) => (
          <div className="flex flex-col gap-3">
            {b.budget && (
              <p className="flex items-baseline justify-between text-sm">
                <span className="text-fg-muted">תקציב מוגדר</span>
                <MoneyText value={b.budget} className="font-semibold text-fg" />
              </p>
            )}
            {b.totals.length === 0 ? (
              <p className="text-sm text-fg-muted">אין עדיין עלויות בטיול.</p>
            ) : (
              b.totals.map((row) => <CurrencyBlock key={row.currency} row={row} />)
            )}
            {b.remaining_reason === 'ok' && b.remaining ? (
              <p
                className={`flex items-baseline justify-between rounded-lg px-3 py-2 text-sm ${b.over_budget ? 'bg-coral-50 text-coral-700' : 'bg-moss-50 text-moss-700'}`}
                data-testid="budget-remaining"
              >
                <span className="font-medium">{b.over_budget ? 'חריגה מהתקציב' : 'נשאר בתקציב'}</span>
                <MoneyText value={b.remaining} className="font-semibold" />
              </p>
            ) : (
              <p className="text-sm text-fg-muted" data-testid="budget-remaining-reason">
                <Badge tone="muted" size="sm" className="me-2">
                  יתרה לא זמינה
                </Badge>
                {REASONS[b.remaining_reason]}
              </p>
            )}
            {b.over_budget && (
              <Callout tone="danger" icon={<TriangleAlert />} title="הטיול חורג מהתקציב">
                הסכום שנספר גבוה מהתקציב שהוגדר.
              </Callout>
            )}
            {b.warnings.length > 0 && (
              <ul className="flex flex-col gap-2" aria-label="אזהרות תקציב">
                {b.warnings.map((w, i) => (
                  <li key={`${w.code}-${i}`}>
                    <Callout tone="warn">{w.message}</Callout>
                  </li>
                ))}
              </ul>
            )}
            {b.by_kind.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer font-medium text-accent">פירוט לפי סוג</summary>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {b.by_kind.map((k) => (
                    <li key={k.kind} className="flex items-baseline justify-between gap-3">
                      <span className="text-fg-muted">
                        {kindLabel(k.kind)} ({k.item_count})
                      </span>
                      <span className="flex flex-wrap justify-end gap-x-2">
                        {k.totals.map((t) => (
                          <MoneyText key={t.currency} amount={t.counted} currency={t.currency} />
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </QueryState>
    </Card>
  );
}
