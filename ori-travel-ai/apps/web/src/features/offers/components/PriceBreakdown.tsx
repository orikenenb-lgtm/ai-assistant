import { Info } from 'lucide-react';
import { Badge, MoneyText } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Money } from '@/lib/schemas/common';
import type { CanonicalOffer, PriceBreakdown as PriceBreakdownData, PriceComponent } from '@/lib/schemas/offers';

/** Unit prices relevant to the offer ("לילה", "לאדם", "ליום"). */
export function unitPrices(price: PriceBreakdownData): Array<{ key: string; label: string; value: Money }> {
  const out: Array<{ key: string; label: string; value: Money }> = [];
  if (price.per_night) out.push({ key: 'night', label: 'ללילה', value: price.per_night });
  if (price.per_day) out.push({ key: 'day', label: 'ליום', value: price.per_day });
  if (price.per_person) out.push({ key: 'person', label: 'לאדם', value: price.per_person });
  return out;
}

export function hasExcludedCosts(price: PriceBreakdownData): boolean {
  return price.components.some((c) => !c.included_in_total || c.status === 'excluded') || price.excluded_notes.length > 0;
}

function isExcluded(c: PriceComponent): boolean {
  return !c.included_in_total || c.status === 'excluded';
}

export interface PriceSummaryProps {
  price: PriceBreakdownData;
  className?: string;
  align?: 'start' | 'end';
}

/** Compact price block for cards: total (known/estimated), unit prices, hint when extra costs are excluded. */
export function PriceSummary({ price, className, align = 'end' }: PriceSummaryProps) {
  const units = unitPrices(price);
  const estimated = price.total_status === 'estimated';
  return (
    <div className={cn('flex flex-col gap-0.5', align === 'end' ? 'items-end text-end' : 'items-start text-start', className)}>
      <span className="text-2xl font-bold leading-tight text-fg">
        <MoneyText value={price.total} estimated={estimated} />
      </span>
      <span className="text-xs text-fg-subtle">{estimated ? 'סה״כ משוער' : 'סה״כ ידוע'}</span>
      {units.map((u) => (
        <span key={u.key} className="text-xs text-fg-muted">
          <MoneyText value={u.value} /> {u.label}
        </span>
      ))}
      {hasExcludedCosts(price) && (
        <span className="mt-0.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700">
          <Info className="size-3.5" aria-hidden="true" />
          יש עלויות שאינן כלולות בסכום
        </span>
      )}
    </div>
  );
}

function ComponentRow({ c }: { c: PriceComponent }) {
  const excluded = isExcluded(c);
  return (
    <li className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5 text-fg-muted">
        {c.label}
        {c.status === 'estimated' && (
          <Badge tone="warn" size="sm">
            משוער
          </Badge>
        )}
        {excluded && (
          <Badge tone="neutral" size="sm">
            לא כלול בסכום
          </Badge>
        )}
      </span>
      <MoneyText value={c.amount} estimated={c.status === 'estimated' || excluded} className={cn('font-medium', excluded ? 'text-fg-muted' : 'text-fg')} />
    </li>
  );
}

export interface PriceBreakdownProps {
  offer: Pick<CanonicalOffer, 'price'>;
  className?: string;
}

/**
 * Full price breakdown. The headline total is the KNOWN total for the exact bundle;
 * estimated and excluded components are listed separately and never merged into it.
 */
export function PriceBreakdown({ offer, className }: PriceBreakdownProps) {
  const { price } = offer;
  const included = price.components.filter((c) => !isExcluded(c));
  const excluded = price.components.filter(isExcluded);
  const estimated = price.total_status === 'estimated';
  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label="פירוט מחיר">
      <div className="flex items-end justify-between gap-3 rounded-lg bg-surface-sunken px-4 py-3">
        <div>
          <p className="text-xs font-medium text-fg-muted">{estimated ? 'סה״כ משוער' : 'סה״כ ידוע לחבילה'}</p>
          <p className="text-2xl font-bold text-fg">
            <MoneyText value={price.total} estimated={estimated} />
          </p>
        </div>
        <ul className="flex flex-col items-end text-xs text-fg-muted">
          {unitPrices(price).map((u) => (
            <li key={u.key}>
              <MoneyText value={u.value} /> {u.label}
            </li>
          ))}
        </ul>
      </div>

      {included.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold text-fg-muted">כלול במחיר</h4>
          <ul className="divide-y divide-line">
            {included.map((c, i) => (
              <ComponentRow key={`${c.label}-${i}`} c={c} />
            ))}
          </ul>
        </div>
      )}

      {(excluded.length > 0 || price.excluded_notes.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <h4 className="flex items-center gap-1.5 text-xs font-semibold text-amber-700">
            <Info className="size-4" aria-hidden="true" />
            לא כלול בסכום ויתווסף בנפרד
          </h4>
          {excluded.length > 0 && (
            <ul className="mt-1 divide-y divide-amber-200/70">
              {excluded.map((c, i) => (
                <ComponentRow key={`${c.label}-${i}`} c={c} />
              ))}
            </ul>
          )}
          {price.excluded_notes.length > 0 && (
            <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-xs leading-relaxed text-amber-700">
              {price.excluded_notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
