import { ChevronDown, Maximize2, TriangleAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge, Button, Card } from '@/components/ui';
import { cn } from '@/lib/cn';
import { CATEGORY_SINGULAR } from '@/lib/labels';
import { isOfferKind, type CanonicalOffer } from '@/lib/schemas/offers';
import { AddToTripButton } from './AddToTripButton';
import { AlsoOfferedBy } from './AlsoOfferedBy';
import { CancellationSummary } from './CancellationSummary';
import { CompareToggle } from './CompareToggle';
import { FlightItinerary } from './FlightItinerary';
import { OfferKeyFacts } from './OfferFacts';
import { PriceSummary } from './PriceBreakdown';
import { SaveOfferButton } from './SaveOfferButton';
import { ScoreBadge, ScoreExplanation } from './ScoreExplanation';
import { SourceLine } from './SourceLine';

export interface OfferCardProps {
  offer: CanonicalOffer;
  /** Overrides `offer.score.rank`. Pass `null` to hide the rank. */
  rank?: number | null;
  /** Opens the detail view (e.g. <OfferDetailDialog>). The button is hidden when omitted. */
  onOpenDetails?: (offer: CanonicalOffer) => void;
  showCompare?: boolean;
  showSave?: boolean;
  showAddToTrip?: boolean;
  /** Start with the score explanation expanded. */
  scoreOpen?: boolean;
  /** Extra buttons appended to the action row (e.g. "remove" in saved lists). */
  extraActions?: React.ReactNode;
  className?: string;
}

/**
 * The shared offer card for all four kinds (flight / hotel / car / activity).
 * Always shows total price (known vs estimated vs excluded), source + mode badge,
 * cancellation summary, and a transparent score explanation on demand.
 */
export function OfferCard({
  offer,
  rank,
  onOpenDetails,
  showCompare = true,
  showSave = true,
  showAddToTrip = true,
  scoreOpen = false,
  extraActions,
  className,
}: OfferCardProps) {
  const [open, setOpen] = useState(scoreOpen);
  const panelId = useId();
  const shownRank = rank === undefined ? offer.score?.rank : rank;
  const isFlight = isOfferKind(offer, 'flight');

  return (
    <Card
      as="article"
      padding="none"
      aria-label={offer.title}
      data-testid="offer-card"
      data-offer-id={offer.id}
      data-category={offer.category}
      className={cn('overflow-hidden', className)}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {shownRank !== null && shownRank !== undefined && (
              <span
                className={cn(
                  'mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold tabular-nums',
                  shownRank === 1 ? 'bg-sun-400 text-ink-950' : 'bg-ink-50 text-ink-700',
                )}
                title={`מקום ${shownRank} בדירוג`}
              >
                <span className="sr-only">מקום</span>
                {shownRank}
              </span>
            )}
            <div className="min-w-0">
              <h3 className="text-base font-semibold leading-snug text-fg sm:text-lg">
                <span className="sr-only">{CATEGORY_SINGULAR[offer.category]}: </span>
                {offer.title}
              </h3>
              {offer.subtitle && <p className="mt-0.5 text-sm text-fg-muted">{offer.subtitle}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {offer.score && <ScoreBadge score={offer.score} />}
                {shownRank === 1 && offer.score?.comparable && (
                  <Badge tone="accent" size="sm">
                    הציון הגבוה ביותר
                  </Badge>
                )}
              </div>
            </div>
          </div>
          <PriceSummary price={offer.price} className="shrink-0" />
        </div>

        {isFlight && offer.details.kind === 'flight' && <FlightItinerary details={offer.details} compact />}
        <OfferKeyFacts offer={offer} max={isFlight ? 3 : 6} />

        {offer.warnings.length > 0 && (
          <ul className="flex flex-col gap-1">
            {offer.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs leading-relaxed text-amber-700">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {w}
              </li>
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2 border-t border-line pt-3">
          <CancellationSummary cancellation={offer.cancellation} />
          <SourceLine source={offer.source} />
          <AlsoOfferedBy names={offer.also_offered_by} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onOpenDetails && (
            <Button size="sm" variant="primary" leadingIcon={<Maximize2 aria-hidden="true" />} onClick={() => onOpenDetails(offer)}>
              פרטים
            </Button>
          )}
          {showCompare && <CompareToggle offerId={offer.id} />}
          {showSave && <SaveOfferButton offerId={offer.id} />}
          {showAddToTrip && <AddToTripButton offerId={offer.id} />}
          {extraActions}
          {offer.score && (
            <Button
              size="sm"
              variant="ghost"
              className="ms-auto"
              aria-expanded={open}
              aria-controls={panelId}
              trailingIcon={<ChevronDown className={cn('transition-transform', open && 'rotate-180')} aria-hidden="true" />}
              onClick={() => setOpen((v) => !v)}
            >
              למה הציון הזה?
            </Button>
          )}
        </div>
      </div>
      {offer.score && open && (
        <div id={panelId} className="border-t border-line bg-sand-50 p-4 sm:p-5">
          <ScoreExplanation score={offer.score} />
        </div>
      )}
    </Card>
  );
}
