import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge, Callout, DateText, Dialog, MoneyText } from '@/components/ui';
import { formatDuration, formatNumber } from '@/lib/format';
import { CATEGORY_SINGULAR } from '@/lib/labels';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import { BOARD_LABELS, CAR_CLASS_LABELS, INTEREST_LABELS, TRANSMISSION_LABELS, countLabel } from '../labels';
import { safeExternalUrl } from '@/lib/safeUrl';
import { StartBookingButton } from '@/features/bookings/components/StartBookingButton';
import { AddToTripButton } from './AddToTripButton';
import { AlsoOfferedBy } from './AlsoOfferedBy';
import { baggageText, passengersText } from './OfferFacts';
import { CancellationSummary } from './CancellationSummary';
import { CompareToggle } from './CompareToggle';
import { FlightItinerary } from './FlightItinerary';
import { PriceBreakdown } from './PriceBreakdown';
import { SaveOfferButton } from './SaveOfferButton';
import { ScoreExplanation } from './ScoreExplanation';
import { SourceLine } from './SourceLine';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="text-sm font-bold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function Spec({ rows }: { rows: Array<[string, ReactNode]> }) {
  const visible = rows.filter(([, v]) => v !== null && v !== undefined && v !== false && v !== '');
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {visible.map(([k, v]) => (
        <div key={k} className="flex flex-col">
          <dt className="text-xs text-fg-subtle">{k}</dt>
          <dd className="text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <li key={it}>
          <Badge tone="neutral">{it}</Badge>
        </li>
      ))}
    </ul>
  );
}

/** Kind-specific full details (no price/source — those have their own sections). */
export function OfferDetailsView({ offer }: { offer: CanonicalOffer }) {
  const d = offer.details;
  switch (d.kind) {
    case 'flight':
      return (
        <div className="flex flex-col gap-4">
          <FlightItinerary details={d} />
          <Spec
            rows={[
              ['תעריף', d.fare_brand],
              ['נוסעים', passengersText(d.passengers)],
              ['כבודה', baggageText(d.baggage).join(' · ')],
              ['הערת כבודה', d.baggage.notes],
              ['משך כולל', formatDuration(d.total_duration_minutes)],
              ['חברה מנפיקה', d.validating_carrier],
            ]}
          />
        </div>
      );
    case 'hotel':
      return (
        <div className="flex flex-col gap-3">
          <Spec
            rows={[
              ['כתובת', d.address],
              ['עיר', d.city],
              ['חדר', d.room_name],
              ['ארוחות', BOARD_LABELS[d.board] ?? d.board],
              [
                'תאריכים',
                <span key="dates">
                  <DateText value={d.check_in} /> – <DateText value={d.check_out} /> ({countLabel(d.nights, 'לילה אחד', 'לילות')})
                </span>,
              ],
              ['אורחים', `${countLabel(d.rooms, 'חדר אחד', 'חדרים')} · ${countLabel(d.adults, 'מבוגר אחד', 'מבוגרים')}${d.children ? ` · ${countLabel(d.children, 'ילד אחד', 'ילדים')}` : ''}`],
              ['דירוג כוכבים', d.star_rating ? `${d.star_rating} כוכבים` : null],
              [
                'דירוג אורחים',
                d.guest_rating !== null && d.guest_rating !== undefined
                  ? `${d.guest_rating.toFixed(1)}/10${d.review_count ? ` · ${d.review_count === 1 ? 'ביקורת אחת' : `${formatNumber(d.review_count)} ביקורות`}` : ''}`
                  : null,
              ],
              ['מרחק מהמרכז', d.distance_to_center_km != null ? `${d.distance_to_center_km.toFixed(1)} ק״מ` : null],
              ['כשרות (לפי הספק)', d.kosher_info],
            ]}
          />
          {d.amenities.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-fg-muted">שירותים</h4>
              <Chips items={d.amenities} />
            </div>
          )}
          {d.accessibility_features.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-fg-muted">נגישות</h4>
              <Chips items={d.accessibility_features} />
            </div>
          )}
        </div>
      );
    case 'car':
      return (
        <div className="flex flex-col gap-3">
          <Spec
            rows={[
              ['חברה', d.vendor],
              ['סוג', `${CAR_CLASS_LABELS[d.car_class] ?? d.car_class} · ${d.model_example}`],
              ['תיבת הילוכים', TRANSMISSION_LABELS[d.transmission] ?? d.transmission],
              ['מקומות / מזוודות', `${d.seats} / ${d.bags}`],
              ['מיזוג', d.air_conditioning ? 'כן' : 'לא'],
              ['מדיניות דלק', d.fuel_policy],
              ['קילומטראז׳', d.mileage === 'unlimited' ? 'חופשי' : d.mileage],
              ['איסוף', d.pickup_location],
              ['איסוף בתאריך', <DateText key="p" value={d.pickup_at} preset="datetime" timeZone="source" />],
              ['החזרה', d.dropoff_location],
              ['החזרה בתאריך', <DateText key="r" value={d.dropoff_at} preset="datetime" timeZone="source" />],
              ['ימי השכרה', countLabel(d.rental_days, 'יום אחד', 'ימים')],
              ['גיל נהג מינימלי', d.driver_min_age != null ? String(d.driver_min_age) : null],
              ['תוספת נהג צעיר', d.young_driver_fee_applies == null ? null : d.young_driver_fee_applies ? 'חלה תוספת' : 'לא חלה'],
              ['פיקדון', d.deposit ? <MoneyText key="dep" value={d.deposit} /> : null],
            ]}
          />
          {d.insurance_included.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-fg-muted">ביטוחים כלולים</h4>
              <Chips items={d.insurance_included} />
            </div>
          )}
        </div>
      );
    case 'activity':
      return (
        <div className="flex flex-col gap-3">
          {d.description && <p className="text-sm leading-relaxed text-fg-muted">{d.description}</p>}
          <Spec
            rows={[
              ['סוג', INTEREST_LABELS[d.category] ?? d.category],
              ['עיר', d.city],
              ['משך', d.duration_minutes ? formatDuration(d.duration_minutes) : null],
              ['דירוג', d.rating != null ? `${d.rating.toFixed(1)}/5${d.review_count ? ` · ${d.review_count === 1 ? 'ביקורת אחת' : `${formatNumber(d.review_count)} ביקורות`}` : ''}` : null],
              ['שפות', d.languages.join(', ')],
              ['שעות התחלה', d.start_times.join(', ')],
              ['נקודת מפגש', d.meeting_point],
              ['משתתפים', passengersText(d.participants)],
              ['מתאים למשפחות', d.family_friendly == null ? null : d.family_friendly ? 'כן' : 'לא'],
              ['גיל מינימלי', d.min_age != null ? String(d.min_age) : null],
            ]}
          />
          {d.available_dates.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-fg-muted">תאריכים זמינים</h4>
              <ul className="flex flex-wrap gap-1.5">
                {d.available_dates.map((day) => (
                  <li key={day}>
                    <Badge tone="neutral">
                      <DateText value={day} preset="weekday-date" />
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {d.accessibility_features.length > 0 && (
            <div>
              <h4 className="mb-1.5 text-xs font-semibold text-fg-muted">נגישות</h4>
              <Chips items={d.accessibility_features} />
            </div>
          )}
        </div>
      );
  }
}

export interface OfferDetailDialogProps {
  offer: CanonicalOffer | null;
  onOpenChange: (open: boolean) => void;
}

const safeHref = safeExternalUrl;

/** Full offer details: itinerary/specs, price breakdown, cancellation, score, source. */
export function OfferDetailDialog({ offer, onOpenChange }: OfferDetailDialogProps) {
  if (!offer) return null;
  const href = safeHref(offer.source.deep_link);
  return (
    <Dialog
      open
      onOpenChange={onOpenChange}
      size="xl"
      title={offer.title}
      description={
        <span>
          {CATEGORY_SINGULAR[offer.category]}
          {offer.subtitle ? ` · ${offer.subtitle}` : ''}
        </span>
      }
      footer={
        <div className="flex w-full flex-wrap items-center gap-2">
          <CompareToggle offerId={offer.id} size="md" />
          <SaveOfferButton offerId={offer.id} size="md" />
          <AddToTripButton offerId={offer.id} size="md" />
          <StartBookingButton offerId={offer.id} size="md" />
        </div>
      }
    >
      <div className="flex flex-col gap-6" data-testid="offer-detail">
        {offer.warnings.length > 0 && (
          <Callout tone="warn" title="שימו לב">
            <ul className="list-disc ps-5">
              {offer.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Callout>
        )}
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Section title="פרטי ההצעה">
              <OfferDetailsView offer={offer} />
            </Section>
            <Section title="ביטול ושינוי">
              <CancellationSummary cancellation={offer.cancellation} detailed />
            </Section>
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            <Section title="מחיר">
              <PriceBreakdown offer={offer} />
            </Section>
          </div>
        </div>
        {offer.score && (
          <Section title="איך חושב הציון">
            <ScoreExplanation score={offer.score} />
          </Section>
        )}
        <Section title="מקור">
          <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken p-3">
            <SourceLine source={offer.source} />
            {offer.source.note && <p className="text-xs leading-relaxed text-fg-muted">{offer.source.note}</p>}
            <AlsoOfferedBy names={offer.also_offered_by} />
            <p className="text-xs text-fg-subtle">
              מזהה אצל הספק: <code dir="ltr">{offer.source.supplier_offer_id}</code>
            </p>
            {href ? (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
              >
                מעבר לאתר הספק <ExternalLink className="size-3.5" aria-hidden="true" />
                <span className="sr-only">(נפתח בלשונית חדשה)</span>
              </a>
            ) : (
              <p className="text-xs text-fg-subtle">אין קישור ישיר לספק להצעה זו (הצעות הדגמה אינן ניתנות להזמנה).</p>
            )}
          </div>
        </Section>
      </div>
    </Dialog>
  );
}
