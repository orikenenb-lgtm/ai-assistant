import { Check } from 'lucide-react';
import type { ReactNode } from 'react';
import { DateText, FreshnessText, MoneyText } from '@/components/ui';
import { CancellationSummary, SourceLine, baggageText, cancellationKind, compareDecimal, scoreNumber } from '@/features/offers';
import { BOARD_LABELS, CAR_CLASS_LABELS, FACTOR_LABELS, INTEREST_LABELS, TRANSMISSION_LABELS, cabinLabel, stopsLabel } from '@/features/offers/labels';
import { formatDuration } from '@/lib/format';
import type { Category } from '@/lib/schemas/common';
import type { CanonicalOffer, ConvertedAmount } from '@/lib/schemas/offers';

export interface RowCtx {
  conversions: Record<string, ConvertedAmount>;
  showFx: boolean;
}

export interface CompareRow {
  id: string;
  label: string;
  section: string;
  render: (o: CanonicalOffer, ctx: RowCtx) => ReactNode;
  /** Ids of the offers that are best in this row (ties all included). Omit for rows with no "best". */
  best?: (offers: CanonicalOffer[]) => Set<string>;
}

// ---- "best" helpers -------------------------------------------------------

export function bestBy<T>(offers: CanonicalOffer[], get: (o: CanonicalOffer) => T | null | undefined, cmp: (a: T, b: T) => number): Set<string> {
  let best: T | undefined;
  let ids: string[] = [];
  for (const o of offers) {
    const v = get(o);
    if (v === null || v === undefined) continue;
    if (best === undefined) {
      best = v;
      ids = [o.id];
      continue;
    }
    const c = cmp(v, best);
    if (c < 0) {
      best = v;
      ids = [o.id];
    } else if (c === 0) ids.push(o.id);
  }
  // Highlighting everyone is meaningless.
  return ids.length === offers.length ? new Set() : new Set(ids);
}
const lowest = (offers: CanonicalOffer[], get: (o: CanonicalOffer) => number | null | undefined) => bestBy(offers, get, (a, b) => a - b);
const highest = (offers: CanonicalOffer[], get: (o: CanonicalOffer) => number | null | undefined) => bestBy(offers, get, (a, b) => b - a);

const FLEX_RANK = { free: 3, refundable: 2, unknown: 1, nonrefundable: 0 } as const;
const BOARD_RANK: Record<string, number> = { room_only: 0, breakfast: 1, half_board: 2, full_board: 3, all_inclusive: 4 };

// ---- render helpers -------------------------------------------------------

const dash = <span className="text-fg-subtle">—</span>;
const text = (s: string | null | undefined) => (s ? <span>{s}</span> : dash);

function ScoreCell({ value }: { value: string }) {
  const v = scoreNumber(value);
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 font-semibold tabular-nums">{value}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100" aria-hidden="true">
        <div className="h-full rounded-full bg-sea-600" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function excludedList(o: CanonicalOffer): ReactNode {
  const ex = o.price.components.filter((c) => !c.included_in_total || c.status === 'excluded');
  if (ex.length === 0 && o.price.excluded_notes.length === 0) return <span className="text-fg-muted">אין</span>;
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {ex.map((c, i) => (
        <li key={i}>
          {c.label}: <MoneyText value={c.amount} estimated />
        </li>
      ))}
      {o.price.excluded_notes.map((n, i) => (
        <li key={`n${i}`} className="text-fg-muted">
          {n}
        </li>
      ))}
    </ul>
  );
}

function unit(o: CanonicalOffer): ReactNode {
  const p = o.price;
  const parts: ReactNode[] = [];
  if (p.per_night) parts.push(<div key="n"><MoneyText value={p.per_night} /> ללילה</div>);
  if (p.per_day) parts.push(<div key="d"><MoneyText value={p.per_day} /> ליום</div>);
  if (p.per_person) parts.push(<div key="p"><MoneyText value={p.per_person} /> לאדם</div>);
  return parts.length ? <>{parts}</> : dash;
}

function unitKey(o: CanonicalOffer): string | null {
  return o.price.per_night?.amount ?? o.price.per_day?.amount ?? o.price.per_person?.amount ?? null;
}

// ---- row sets -------------------------------------------------------------

const PRICE = 'מחיר';
const DETAILS = 'פרטים';
const FLEX = 'גמישות';
const SCORE = 'ציון';
const SOURCE = 'מקור ואמינות';

function commonTop(): CompareRow[] {
  return [
    {
      id: 'total',
      label: 'סה״כ ידוע',
      section: PRICE,
      render: (o) => (
        <span className="text-base font-bold">
          <MoneyText value={o.price.total} estimated={o.price.total_status === 'estimated'} />
        </span>
      ),
      best: (offers) => bestBy(offers, (o) => o.price.total.amount, compareDecimal),
    },
    {
      id: 'fx',
      label: 'המרה לתצוגה (הדגמה)',
      section: PRICE,
      render: (o, ctx) => {
        const c = ctx.conversions[o.id];
        return c ? (
          <span title={`שער ${c.rate} · ${c.rate_source}`}>
            ≈ <MoneyText value={c.converted} /> <span className="text-xs text-fg-muted">(לתצוגה בלבד)</span>
          </span>
        ) : (
          dash
        );
      },
    },
    { id: 'unit', label: 'מחיר ליחידה', section: PRICE, render: unit, best: (offers) => bestBy(offers, unitKey, compareDecimal) },
    { id: 'excluded', label: 'לא כלול בסכום', section: PRICE, render: excludedList },
  ];
}

function commonBottom(): CompareRow[] {
  const flexKey = (o: CanonicalOffer) => FLEX_RANK[cancellationKind(o.cancellation)];
  return [
    {
      id: 'cancel',
      label: 'ביטול ושינוי',
      section: FLEX,
      render: (o) => <CancellationSummary cancellation={o.cancellation} />,
      best: (offers) => highest(offers, flexKey),
    },
    {
      id: 'score-total',
      label: 'ציון כולל',
      section: SCORE,
      render: (o) => (o.score ? <ScoreCell value={o.score.total} /> : dash),
      best: (offers) => highest(offers, (o) => (o.score?.comparable ? scoreNumber(o.score.total) : null)),
    },
    ...(['cost', 'convenience', 'flexibility', 'quality'] as const).map<CompareRow>((f) => ({
      id: `score-${f}`,
      label: `${FACTOR_LABELS[f]}${''}`,
      section: SCORE,
      render: (o) => (o.score ? <ScoreCell value={o.score[f]} /> : dash),
      best: (offers) => highest(offers, (o) => (o.score ? scoreNumber(o.score[f]) : null)),
    })),
    {
      id: 'reasons',
      label: 'למה הציון',
      section: SCORE,
      render: (o) =>
        o.score && o.score.reasons.length ? (
          <ul className="flex list-disc flex-col gap-0.5 ps-4 text-xs text-fg-muted">
            {o.score.reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          dash
        ),
    },
    { id: 'source', label: 'ספק ומצב נתונים', section: SOURCE, render: (o) => <SourceLine source={o.source} minimal /> },
    {
      id: 'fresh',
      label: 'עדכניות',
      section: SOURCE,
      render: (o) => (
        <span className="text-xs text-fg-muted">
          <FreshnessText value={o.source.fetched_at} />
          {o.source.expires_at && (
            <>
              {' · '}תוקף עד <DateText value={o.source.expires_at} preset="time" />
            </>
          )}
        </span>
      ),
    },
  ];
}

const flightRows: CompareRow[] = [
  {
    id: 'duration',
    label: 'משך כולל',
    section: DETAILS,
    render: (o) => (o.details.kind === 'flight' ? formatDuration(o.details.total_duration_minutes) : dash),
    best: (offers) => lowest(offers, (o) => (o.details.kind === 'flight' ? o.details.total_duration_minutes : null)),
  },
  {
    id: 'stops',
    label: 'עצירות',
    section: DETAILS,
    render: (o) => (o.details.kind === 'flight' ? stopsLabel(o.details.max_stops) : dash),
    best: (offers) => lowest(offers, (o) => (o.details.kind === 'flight' ? o.details.max_stops : null)),
  },
  {
    id: 'times',
    label: 'שעות',
    section: DETAILS,
    render: (o) =>
      o.details.kind === 'flight' ? (
        <ul className="flex flex-col gap-0.5 text-xs">
          {o.details.slices.map((s, i) => (
            <li key={i} className="flex items-center gap-1.5" dir="ltr">
              <span className="font-mono text-fg-muted">{s.origin}→{s.destination}</span>
              <DateText value={s.departing_at} preset="time" timeZone="source" />–<DateText value={s.arriving_at} preset="time" timeZone="source" />
            </li>
          ))}
        </ul>
      ) : (
        dash
      ),
  },
  {
    id: 'carrier',
    label: 'חברת תעופה',
    section: DETAILS,
    render: (o) => text(o.details.kind === 'flight' ? [...new Set(o.details.slices.flatMap((s) => s.segments.map((g) => g.carrier_name)))].join(', ') : null),
  },
  { id: 'cabin', label: 'מחלקה', section: DETAILS, render: (o) => (o.details.kind === 'flight' ? text(`${cabinLabel(o.details.cabin)}${o.details.fare_brand ? ` · ${o.details.fare_brand}` : ''}`) : dash) },
  {
    id: 'baggage',
    label: 'כבודה',
    section: DETAILS,
    render: (o) => (o.details.kind === 'flight' ? <span className="text-xs">{baggageText(o.details.baggage).join(' · ')}</span> : dash),
    best: (offers) => highest(offers, (o) => (o.details.kind === 'flight' ? (o.details.baggage.checked_included ?? 0) : null)),
  },
];

const hotelRows: CompareRow[] = [
  {
    id: 'stars',
    label: 'כוכבים',
    section: DETAILS,
    render: (o) => (o.details.kind === 'hotel' && o.details.star_rating ? `${o.details.star_rating} כוכבים` : dash),
    best: (offers) => highest(offers, (o) => (o.details.kind === 'hotel' ? o.details.star_rating : null)),
  },
  {
    id: 'guest',
    label: 'דירוג אורחים',
    section: DETAILS,
    render: (o) => (o.details.kind === 'hotel' && o.details.guest_rating != null ? `${o.details.guest_rating.toFixed(1)}/10 (${o.details.review_count ?? 0})` : dash),
    best: (offers) => highest(offers, (o) => (o.details.kind === 'hotel' ? o.details.guest_rating : null)),
  },
  {
    id: 'board',
    label: 'ארוחות',
    section: DETAILS,
    render: (o) => (o.details.kind === 'hotel' ? BOARD_LABELS[o.details.board] : dash),
    best: (offers) => highest(offers, (o) => (o.details.kind === 'hotel' ? (BOARD_RANK[o.details.board] ?? 0) : null)),
  },
  {
    id: 'distance',
    label: 'מרחק מהמרכז',
    section: DETAILS,
    render: (o) => (o.details.kind === 'hotel' && o.details.distance_to_center_km != null ? `${o.details.distance_to_center_km.toFixed(1)} ק״מ` : dash),
    best: (offers) => lowest(offers, (o) => (o.details.kind === 'hotel' ? o.details.distance_to_center_km : null)),
  },
  { id: 'room', label: 'חדר', section: DETAILS, render: (o) => (o.details.kind === 'hotel' ? text(`${o.details.room_name} · ${o.details.nights} לילות`) : dash) },
  {
    id: 'amenities',
    label: 'שירותים',
    section: DETAILS,
    render: (o) => (o.details.kind === 'hotel' ? <span className="text-xs text-fg-muted">{o.details.amenities.slice(0, 6).join(', ') || '—'}</span> : dash),
    best: (offers) => highest(offers, (o) => (o.details.kind === 'hotel' ? o.details.amenities.length : null)),
  },
  { id: 'kosher', label: 'כשרות (לפי הספק)', section: DETAILS, render: (o) => (o.details.kind === 'hotel' ? text(o.details.kosher_info) : dash) },
];

const carRows: CompareRow[] = [
  { id: 'class', label: 'סוג', section: DETAILS, render: (o) => (o.details.kind === 'car' ? text(`${CAR_CLASS_LABELS[o.details.car_class] ?? o.details.car_class} · ${o.details.model_example}`) : dash) },
  { id: 'vendor', label: 'חברה', section: DETAILS, render: (o) => (o.details.kind === 'car' ? text(o.details.vendor) : dash) },
  { id: 'trans', label: 'תיבת הילוכים', section: DETAILS, render: (o) => (o.details.kind === 'car' ? TRANSMISSION_LABELS[o.details.transmission] : dash) },
  {
    id: 'seats',
    label: 'מקומות / מזוודות',
    section: DETAILS,
    render: (o) => (o.details.kind === 'car' ? `${o.details.seats} / ${o.details.bags}` : dash),
    best: (offers) => highest(offers, (o) => (o.details.kind === 'car' ? o.details.seats : null)),
  },
  { id: 'mileage', label: 'קילומטראז׳', section: DETAILS, render: (o) => (o.details.kind === 'car' ? text(o.details.mileage === 'unlimited' ? 'חופשי' : o.details.mileage) : dash) },
  {
    id: 'insurance',
    label: 'ביטוחים כלולים',
    section: DETAILS,
    render: (o) => (o.details.kind === 'car' ? <span className="text-xs text-fg-muted">{o.details.insurance_included.length ? `${o.details.insurance_included.length} כלולים` : 'אין'}</span> : dash),
    best: (offers) => highest(offers, (o) => (o.details.kind === 'car' ? o.details.insurance_included.length : null)),
  },
  {
    id: 'deposit',
    label: 'פיקדון',
    section: DETAILS,
    render: (o) => (o.details.kind === 'car' && o.details.deposit ? <MoneyText value={o.details.deposit} /> : dash),
    best: (offers) => bestBy(offers, (o) => (o.details.kind === 'car' ? (o.details.deposit?.amount ?? null) : null), compareDecimal),
  },
  { id: 'age', label: 'גיל נהג מינימלי', section: DETAILS, render: (o) => (o.details.kind === 'car' && o.details.driver_min_age != null ? String(o.details.driver_min_age) : dash) },
];

const activityRows: CompareRow[] = [
  {
    id: 'rating',
    label: 'דירוג',
    section: DETAILS,
    render: (o) => (o.details.kind === 'activity' && o.details.rating != null ? `${o.details.rating.toFixed(1)}/5 (${o.details.review_count ?? 0})` : dash),
    best: (offers) => highest(offers, (o) => (o.details.kind === 'activity' ? o.details.rating : null)),
  },
  { id: 'type', label: 'סוג', section: DETAILS, render: (o) => (o.details.kind === 'activity' ? INTEREST_LABELS[o.details.category] ?? o.details.category : dash) },
  { id: 'duration', label: 'משך', section: DETAILS, render: (o) => (o.details.kind === 'activity' && o.details.duration_minutes ? formatDuration(o.details.duration_minutes) : dash) },
  { id: 'langs', label: 'שפות', section: DETAILS, render: (o) => (o.details.kind === 'activity' ? text(o.details.languages.join(', ')) : dash) },
  {
    id: 'family',
    label: 'מתאים למשפחות',
    section: DETAILS,
    render: (o) => (o.details.kind === 'activity' ? (o.details.family_friendly == null ? dash : o.details.family_friendly ? 'כן' : 'לא') : dash),
  },
  { id: 'dates', label: 'תאריכים זמינים', section: DETAILS, render: (o) => (o.details.kind === 'activity' ? `${o.details.available_dates.length} תאריכים` : dash) },
];

export function rowsFor(category: Category): CompareRow[] {
  const mid = { flight: flightRows, hotel: hotelRows, car: carRows, activity: activityRows }[category];
  return [...commonTop(), ...mid, ...commonBottom()];
}

export function BestMark() {
  return (
    <span className="inline-flex items-center gap-0.5 text-2xs font-semibold text-moss-700">
      <Check className="size-3" aria-hidden="true" />
      <span>הטוב ביותר</span>
    </span>
  );
}
