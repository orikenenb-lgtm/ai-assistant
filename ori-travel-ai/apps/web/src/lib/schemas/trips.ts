/**
 * Trip summary (GET /api/trips, contract §3.4). Being implemented by B3 —
 * only the fields the dashboard needs are required; extend in features/trips.
 */
import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema, MoneySchema, listOrPageSchema } from './common';

export const TripSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  destination: z.string().nullable().optional(),
  start_date: IsoDateSchema.nullable().optional(),
  end_date: IsoDateSchema.nullable().optional(),
  timezone: z.string().nullable().optional(),
  budget: MoneySchema.nullable().optional(),
  traveler_count: z.number().int().nullable().optional(),
  item_count: z.number().int().nullable().optional(),
  updated_at: IsoDateTimeSchema.nullable().optional(),
});
export type TripSummary = z.infer<typeof TripSummarySchema>;
export const TripSummaryListSchema = listOrPageSchema(TripSummarySchema);
