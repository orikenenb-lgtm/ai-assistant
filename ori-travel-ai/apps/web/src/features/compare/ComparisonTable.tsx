import { Maximize2, X } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Badge, Button, IconButton } from '@/components/ui';
import { AddToTripButton, OfferDetailDialog, SaveOfferButton, ScoreBadge } from '@/features/offers';
import { cn } from '@/lib/cn';
import type { CanonicalOffer, ComparisonGroup } from '@/lib/schemas/offers';
import { BestMark, rowsFor, type CompareRow } from './rows';

export interface ComparisonTableProps {
  group: ComparisonGroup;
  showFx: boolean;
  caption: string;
  onRemove: (offerId: string) => void;
}

/** Side-by-side table for ONE (category, currency) group; best value per row is highlighted (never by colour alone). */
export function ComparisonTable({ group, showFx, caption, onRemove }: ComparisonTableProps) {
  const [detail, setDetail] = useState<CanonicalOffer | null>(null);
  const offers = group.offers;
  const hasFx = Object.keys(group.display_conversions).length > 0;
  const rows: CompareRow[] = rowsFor(group.category).filter((r) => r.id !== 'fx' || (showFx && hasFx));
  const ctx = { conversions: group.display_conversions, showFx };
  const sections = [...new Set(rows.map((r) => r.section))];

  return (
    <div className="scrollbar-thin w-full max-w-full overflow-x-auto rounded-xl border border-line bg-surface shadow-xs">
      <table className="w-full min-w-max border-collapse text-sm" data-testid="comparison-table" data-category={group.category} data-currency={group.currency}>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky start-0 z-10 w-36 min-w-36 border-b border-line bg-sand-50 p-3 text-start text-xs font-semibold text-fg-muted">
              הצעה
            </th>
            {offers.map((o) => (
              <th key={o.id} scope="col" className="min-w-56 max-w-72 border-b border-s border-line bg-sand-50 p-3 text-start align-top font-normal">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-1.5">
                      {o.score?.rank != null && (
                        <span className="grid size-6 place-items-center rounded-md bg-ink-900 text-xs font-bold text-white" title={`מקום ${o.score.rank} בקבוצה`}>
                          <span className="sr-only">מקום </span>
                          {o.score.rank}
                        </span>
                      )}
                      {o.id === group.cheapest_offer_id && (
                        <Badge tone="success" size="sm">
                          הזול ביותר
                        </Badge>
                      )}
                    </p>
                    <p className="mt-1.5 font-semibold leading-snug text-fg">{o.title}</p>
                    {o.subtitle && <p className="text-xs text-fg-muted">{o.subtitle}</p>}
                    {o.score && <ScoreBadge score={o.score} className="mt-1.5" />}
                  </div>
                  <IconButton label={`הסרת "${o.title}" מההשוואה`} icon={<X />} size="sm" onClick={() => onRemove(o.id)} />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sections.map((section) => (
            <Fragment key={section}>
              <tr>
                <th scope="colgroup" colSpan={offers.length + 1} className="sticky start-0 border-b border-line bg-surface-sunken px-3 py-1.5 text-start text-xs font-bold text-fg">
                  {section}
                </th>
              </tr>
              {rows
                .filter((r) => r.section === section)
                .map((row) => {
                  const best = row.best?.(offers) ?? new Set<string>();
                  return (
                    <tr key={row.id} data-row={row.id}>
                      <th scope="row" className="sticky start-0 z-10 border-b border-line bg-surface p-3 text-start align-top text-xs font-semibold text-fg-muted">
                        {row.label}
                      </th>
                      {offers.map((o) => {
                        const isBest = best.has(o.id);
                        return (
                          <td
                            key={o.id}
                            data-best={isBest || undefined}
                            className={cn('border-b border-s border-line p-3 align-top text-fg', isBest && 'bg-moss-50')}
                          >
                            {isBest && <BestMark />}
                            <div>{row.render(o, ctx)}</div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
            </Fragment>
          ))}
          <tr>
            <th scope="row" className="sticky start-0 z-10 bg-surface p-3 text-start align-top text-xs font-semibold text-fg-muted">
              פעולות
            </th>
            {offers.map((o) => (
              <td key={o.id} className="border-s border-line p-3 align-top">
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="primary" leadingIcon={<Maximize2 aria-hidden="true" />} onClick={() => setDetail(o)}>
                    פרטים
                  </Button>
                  <SaveOfferButton offerId={o.id} />
                  <AddToTripButton offerId={o.id} />
                </div>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      <OfferDetailDialog offer={detail} onOpenChange={(open) => !open && setDetail(null)} />
    </div>
  );
}
