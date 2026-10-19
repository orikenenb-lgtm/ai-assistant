/** Pure layout helpers for the calendar views (shared by server and client). */
import { addDays, dateKey, diffDays, minutesIntoDay, startOfDay } from "./tz";

export type Span = { start: Date; end: Date; allDay: boolean };

/** Calendar days (tenant zone) an item covers. End is exclusive. */
export function daysCovered(span: Span, tz: string): string[] {
  const first = dateKey(span.start, tz);
  const lastInstant = span.end.getTime() > span.start.getTime() ? new Date(span.end.getTime() - 1) : span.start;
  const last = dateKey(lastInstant, tz);
  const n = Math.max(0, Math.min(62, diffDays(first, last)));
  return Array.from({ length: n + 1 }, (_, i) => addDays(first, i));
}

/** Timed events that last less than a day are drawn in the time grid; others in the all-day lane. */
export function isAllDayLike(span: Span): boolean {
  return span.allDay || span.end.getTime() - span.start.getTime() >= 24 * 3_600_000;
}

export type Positioned<T> = { item: T; top: number; height: number; column: number; columns: number };

/**
 * Positions timed items inside one day column (minutes from local midnight),
 * splitting overlapping items into side-by-side columns.
 */
export function layoutDay<T extends Span>(items: T[], day: string, tz: string, minHeight = 20): Positioned<T>[] {
  const dayStart = startOfDay(day, tz).getTime();
  const dayEnd = startOfDay(addDays(day, 1), tz).getTime();
  const placed = items
    .filter((it) => it.start.getTime() < dayEnd && it.end.getTime() > dayStart)
    .map((item) => {
      const top = item.start.getTime() <= dayStart ? 0 : minutesIntoDay(item.start, tz);
      const endMin = item.end.getTime() >= dayEnd ? 24 * 60 : minutesIntoDay(item.end, tz) || 24 * 60;
      return { item, top, height: Math.max(minHeight, endMin - top), column: 0, columns: 1 };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  // Greedy column assignment within clusters of overlapping items.
  let cluster: typeof placed = [];
  let clusterEnd = -1;
  const columnEnds: number[] = [];
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((p) => p.column + 1));
    for (const p of cluster) p.columns = cols;
    cluster = [];
    columnEnds.length = 0;
  };
  for (const p of placed) {
    if (cluster.length && p.top >= clusterEnd) flush();
    let col = columnEnds.findIndex((end) => end <= p.top);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(0);
    }
    columnEnds[col] = p.top + p.height;
    p.column = col;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.top + p.height);
  }
  if (cluster.length) flush();
  return placed;
}
