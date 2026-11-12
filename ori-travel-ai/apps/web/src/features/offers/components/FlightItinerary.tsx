import { ArrowLeft, Plane, Timer } from 'lucide-react';
import { Badge, DateText } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDuration, parseIso } from '@/lib/format';
import type { FlightDetails, FlightSegment, FlightSlice } from '@/lib/schemas/offers';
import { cabinLabel, stopsLabel } from '../labels';

/** Calendar-day difference between two ISO strings using the wall clock written in each (local times). */
export function dayOffset(from: string, to: string): number {
  const a = parseIso(from);
  const b = parseIso(to);
  if (!a || !b) return 0;
  const da = Date.UTC(a.wallClock.getUTCFullYear(), a.wallClock.getUTCMonth(), a.wallClock.getUTCDate());
  const db = Date.UTC(b.wallClock.getUTCFullYear(), b.wallClock.getUTCMonth(), b.wallClock.getUTCDate());
  return Math.round((db - da) / 86_400_000);
}

export function sliceTitle(index: number, total: number): string {
  if (total === 2) return index === 0 ? 'הלוך' : 'חזור';
  if (total === 1) return 'טיסה';
  return `קטע ${index + 1}`;
}

function TimeRange({ from, to, className }: { from: string; to: string; className?: string }) {
  const offset = dayOffset(from, to);
  return (
    <span className={cn('inline-flex items-baseline gap-1.5 font-semibold tabular-nums text-fg', className)} dir="ltr">
      <DateText value={from} preset="time" timeZone="source" />
      <span className="text-fg-subtle" aria-hidden="true">
        →
      </span>
      <DateText value={to} preset="time" timeZone="source" />
      {offset > 0 && (
        <sup className="text-2xs font-medium text-amber-700" title={`נחיתה ${offset === 1 ? 'למחרת' : `${offset} ימים אחרי`}`}>
          +{offset}
        </sup>
      )}
    </span>
  );
}

function SegmentRow({ seg }: { seg: FlightSegment }) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-sm">
      <span className="mt-1 grid size-6 place-items-center rounded-full bg-sea-50 text-sea-700" aria-hidden="true">
        <Plane className="size-3.5 -scale-x-100" />
      </span>
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <TimeRange from={seg.departing_at} to={seg.arriving_at} />
          <span className="text-xs text-fg-muted">{formatDuration(seg.duration_minutes)}</span>
        </p>
        <p className="text-xs text-fg-muted">
          <span dir="ltr">{seg.origin}</span> {seg.origin_name ? `· ${seg.origin_name}` : ''}
          <ArrowLeft className="mx-1 inline size-3 ltr:rotate-180" aria-hidden="true" />
          <span dir="ltr">{seg.destination}</span> {seg.destination_name ? `· ${seg.destination_name}` : ''}
        </p>
        <p className="text-xs text-fg-subtle">
          {seg.carrier_name} <span dir="ltr">{seg.carrier_code}{seg.flight_number}</span>
          {seg.operating_carrier_name && seg.operating_carrier_name !== seg.carrier_name && ` · מופעלת ע״י ${seg.operating_carrier_name}`}
          {seg.aircraft && <> · {seg.aircraft}</>} · {cabinLabel(seg.cabin)}
        </p>
      </div>
    </li>
  );
}

export interface SliceProps {
  slice: FlightSlice;
  title: string;
  /** Hide per-segment details (cards). */
  compact?: boolean;
}

export function FlightSliceView({ slice, title, compact = false }: SliceProps) {
  return (
    <section className="flex flex-col gap-2" aria-label={title}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h4 className="text-sm font-semibold text-fg">{title}</h4>
        <span className="text-xs text-fg-muted">
          <DateText value={slice.departing_at} preset="weekday-date" timeZone="source" />
        </span>
        <TimeRange from={slice.departing_at} to={slice.arriving_at} className="text-sm" />
        <span className="text-xs text-fg-muted">
          <span dir="ltr">
            {slice.origin} – {slice.destination}
          </span>
        </span>
        <Badge tone={slice.stops === 0 ? 'success' : 'neutral'} size="sm">
          {stopsLabel(slice.stops)}
        </Badge>
        <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
          <Timer className="size-3.5" aria-hidden="true" />
          {formatDuration(slice.duration_minutes)}
        </span>
      </header>
      {!compact && (
        <ol className="flex flex-col gap-1.5 ps-1">
          {slice.segments.map((seg, i) => (
            <li key={`${seg.flight_number}-${i}`} className="flex flex-col gap-1.5">
              <ul>
                <SegmentRow seg={seg} />
              </ul>
              {i < slice.segments.length - 1 && (
                <p className="ms-9 rounded-md bg-amber-50 px-2.5 py-1 text-xs text-amber-700">
                  המתנה של {formatDuration(slice.layovers_minutes[i] ?? 0)} ב-<span dir="ltr">{seg.destination}</span>
                  {seg.destination_name ? ` (${seg.destination_name})` : ''}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export interface FlightItineraryProps {
  details: FlightDetails;
  compact?: boolean;
  className?: string;
}

/** All slices (outbound / return / multi-city) of a flight offer. Times are the supplier's local wall clock. */
export function FlightItinerary({ details, compact = false, className }: FlightItineraryProps) {
  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {details.slices.map((s, i) => (
        <FlightSliceView key={`${s.origin}-${s.destination}-${i}`} slice={s} title={sliceTitle(i, details.slices.length)} compact={compact} />
      ))}
      {!compact && <p className="text-xs text-fg-subtle">כל השעות הן שעות מקומיות בשדה התעופה הרלוונטי.</p>}
    </div>
  );
}
