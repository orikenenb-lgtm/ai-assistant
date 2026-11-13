import {
  Accessibility,
  Baby,
  BedDouble,
  Briefcase,
  Calendar,
  Car,
  Cog,
  Fuel,
  Gauge,
  Languages,
  Luggage,
  MapPin,
  Plane,
  Armchair,
  Star,
  Ticket,
  Timer,
  Users,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { MoneyText } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDuration, formatMoneyValue, formatNumber } from '@/lib/format';
import { isOfferKind, type Baggage, type CanonicalOffer } from '@/lib/schemas/offers';
import { BOARD_LABELS, CAR_CLASS_LABELS, INTEREST_LABELS, PASSENGER_LABELS, PASSENGER_SINGULAR, TRANSMISSION_LABELS, cabinLabel, countLabel } from '../labels';

export interface Fact {
  key: string;
  icon: LucideIcon;
  label: string;
  value: ReactNode;
  /** Plain-text version (used by comparison table / tests). */
  text: string;
}

export function baggageText(b: Baggage): string[] {
  const out: string[] = [];
  if (b.personal_item) out.push('תיק אישי');
  if (b.carry_on_included === null || b.carry_on_included === undefined) out.push('טרולי: לא ידוע');
  else out.push(b.carry_on_included > 0 ? (b.carry_on_included === 1 ? 'טרולי' : `${b.carry_on_included} טרולים`) : 'ללא טרולי');
  if (b.checked_included === null || b.checked_included === undefined) out.push('מזוודה לבטן: לא ידוע');
  else if (b.checked_included > 0) {
    out.push(
      `${b.checked_included === 1 ? 'מזוודה לבטן' : `${b.checked_included} מזוודות לבטן`}${b.checked_bag_weight_kg ? ` (עד ${b.checked_bag_weight_kg} ק״ג)` : ''}`,
    );
  } else out.push('ללא מזוודה לבטן');
  return out;
}

export function passengersText(p: Record<string, number>): string {
  return Object.entries(p)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => (n === 1 && PASSENGER_SINGULAR[k] ? PASSENGER_SINGULAR[k] : `${n} ${PASSENGER_LABELS[k] ?? k}`))
    .join(', ');
}

export function starsText(stars: number | null | undefined): string | null {
  if (stars === null || stars === undefined || stars <= 0) return null;
  return `${stars} כוכבים`;
}

/** Key facts per offer kind (cards, comparison, detail header). */
export function offerFacts(offer: CanonicalOffer): Fact[] {
  const d = offer.details;
  const facts: Fact[] = [];
  const add = (key: string, icon: LucideIcon, label: string, text: string, value?: ReactNode) =>
    facts.push({ key, icon, label, text, value: value ?? text });

  switch (d.kind) {
    case 'flight': {
      const carriers = [...new Set(d.slices.flatMap((s) => s.segments.map((g) => g.carrier_name)))];
      if (carriers.length) add('carrier', Plane, 'חברת תעופה', carriers.join(' · '));
      add('cabin', Armchair, 'מחלקה', `${cabinLabel(d.cabin)}${d.fare_brand ? ` · ${d.fare_brand}` : ''}`);
      add('baggage', Luggage, 'כבודה', baggageText(d.baggage).join(' · '));
      const pax = passengersText(d.passengers);
      if (pax) add('pax', Users, 'נוסעים', pax);
      break;
    }
    case 'hotel': {
      const stars = starsText(d.star_rating);
      if (stars) add('stars', Star, 'דירוג כוכבים', stars);
      if (d.guest_rating !== null && d.guest_rating !== undefined) {
        add(
          'rating',
          Star,
          'דירוג אורחים',
          `${d.guest_rating.toFixed(1)}/10${d.review_count ? ` (${d.review_count === 1 ? 'ביקורת אחת' : `${formatNumber(d.review_count)} ביקורות`})` : ''}`,
        );
      }
      add('board', Utensils, 'ארוחות', BOARD_LABELS[d.board] ?? d.board);
      add('room', BedDouble, 'חדר', `${d.room_name}${d.rooms > 1 ? ` ×${d.rooms}` : ''}`);
      if (d.distance_to_center_km !== null && d.distance_to_center_km !== undefined) {
        add('distance', MapPin, 'מרחק מהמרכז', `${d.distance_to_center_km.toFixed(1)} ק״מ מהמרכז`);
      }
      add('stay', Calendar, 'שהייה', `${countLabel(d.nights, 'לילה אחד', 'לילות')} · ${countLabel(d.adults, 'מבוגר אחד', 'מבוגרים')}${d.children ? ` + ${countLabel(d.children, 'ילד אחד', 'ילדים')}` : ''}`);
      if (d.kosher_info) add('kosher', Utensils, 'כשרות', d.kosher_info);
      if (d.accessibility_features.length) add('access', Accessibility, 'נגישות', d.accessibility_features.join(', '));
      break;
    }
    case 'car': {
      add('class', Car, 'סוג רכב', `${CAR_CLASS_LABELS[d.car_class] ?? d.car_class} · ${d.model_example}`);
      add('vendor', Briefcase, 'חברה', d.vendor);
      add('trans', Cog, 'תיבת הילוכים', TRANSMISSION_LABELS[d.transmission] ?? d.transmission);
      add('seats', Users, 'מקומות ומזוודות', `${countLabel(d.seats, 'מקום אחד', 'מקומות')} · ${countLabel(d.bags, 'מזוודה אחת', 'מזוודות')}${d.air_conditioning ? ' · מיזוג' : ''}`);
      if (d.mileage) add('mileage', Gauge, 'קילומטראז׳', d.mileage === 'unlimited' ? 'ק״מ חופשי' : d.mileage);
      if (d.fuel_policy) add('fuel', Fuel, 'מדיניות דלק', d.fuel_policy);
      if (d.deposit) {
        add('deposit', Wallet, 'פיקדון', `פיקדון ${formatMoneyValue(d.deposit) ?? ''}`.trim(), (
          <span>
            פיקדון <MoneyText value={d.deposit} />
          </span>
        ));
      }
      add('days', Calendar, 'ימי השכרה', countLabel(d.rental_days, 'יום אחד', 'ימים'));
      break;
    }
    case 'activity': {
      add('cat', Ticket, 'סוג', INTEREST_LABELS[d.category] ?? d.category);
      if (d.duration_minutes) add('duration', Timer, 'משך', formatDuration(d.duration_minutes));
      if (d.rating !== null && d.rating !== undefined) {
        add('rating', Star, 'דירוג', `${d.rating.toFixed(1)}/5${d.review_count ? ` (${formatNumber(d.review_count)})` : ''}`);
      }
      if (d.languages.length) add('lang', Languages, 'שפות', d.languages.join(', '));
      if (d.family_friendly) add('family', Baby, 'מתאים למשפחות', d.min_age ? `מתאים למשפחות · מגיל ${d.min_age}` : 'מתאים למשפחות');
      else if (d.min_age) add('minage', Baby, 'גיל מינימום', `מגיל ${d.min_age}`);
      if (d.accessibility_features.length) add('access', Accessibility, 'נגישות', d.accessibility_features.join(', '));
      break;
    }
  }
  return facts;
}


export function OfferKeyFacts({ offer, max = 6, className }: { offer: CanonicalOffer; max?: number; className?: string }) {
  const facts = offerFacts(offer).slice(0, max);
  return (
    <ul className={cn('grid gap-x-5 gap-y-1.5 text-sm sm:grid-cols-2', className)}>
      {facts.map(({ key, icon: Icon, label, value }) => (
        <li key={key} className="flex min-w-0 items-start gap-2 text-fg-muted">
          <Icon className="mt-0.5 size-4 shrink-0 text-sea-600" aria-hidden="true" />
          <span className="sr-only">{label}: </span>
          <span className="min-w-0 break-words">{value}</span>
        </li>
      ))}
    </ul>
  );
}

/** One-line headline for a card: flight times, hotel name etc. is already in title/subtitle; add kind specifics. */
export function offerHighlights(offer: CanonicalOffer): string[] {
  const out: string[] = [];
  if (isOfferKind(offer, 'hotel') && offer.details.amenities.length) out.push(...offer.details.amenities.slice(0, 4));
  if (isOfferKind(offer, 'car') && offer.details.insurance_included.length) out.push(`${offer.details.insurance_included.length} ביטוחים כלולים`);
  if (isOfferKind(offer, 'activity') && offer.details.start_times.length) out.push(`שעות: ${offer.details.start_times.join(', ')}`);
  return out;
}
