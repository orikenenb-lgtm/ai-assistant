/** Fare calendar API (contract V6 §1, backend owner BE-CAL). */
import { api } from '@/lib/api';
import { FareCalendarResponseSchema, type FareCalendarRequest } from '@/lib/schemas/calendar';

export const fareCalendarKeys = {
  all: ['fare-calendar'] as const,
  calendar: (req: FareCalendarRequest) => ['fare-calendar', req] as const,
};

/** POST /api/search/flight/calendar — read-only (cells are not persisted), rate limited per user. */
export function fetchFareCalendar(req: FareCalendarRequest, signal?: AbortSignal) {
  return api.post('/api/search/flight/calendar', req, { schema: FareCalendarResponseSchema, signal });
}
