/** Saved offers (shortlist) — mirrors `apps/api/app/modules/saved/schemas.py`. */
import { z } from 'zod';
import { CategorySchema, IsoDateTimeSchema } from './common';
import { CanonicalOfferSchema } from './offers';

export const SavedOfferSchema = z.object({
  id: z.string(),
  offer_id: z.string(),
  category: CategorySchema,
  note: z.string().nullable().optional(),
  trip_id: z.string().nullable().optional(),
  is_expired: z.boolean().default(false),
  created_at: IsoDateTimeSchema,
  offer: CanonicalOfferSchema,
});
export type SavedOffer = z.infer<typeof SavedOfferSchema>;
export const SavedOfferListSchema = z.array(SavedOfferSchema);
