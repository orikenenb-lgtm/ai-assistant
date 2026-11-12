/** Trips API (contract §3.4, owner B3). Trip screens are added by later agents. */
import { api } from '@/lib/api';
import { TripSummaryListSchema } from '@/lib/schemas/trips';

export const tripKeys = {
  all: ['trips'] as const,
  list: ['trips', 'list'] as const,
  detail: (id: string) => ['trips', 'detail', id] as const,
};

export function fetchTrips() {
  return api.get('/api/trips', { schema: TripSummaryListSchema });
}
