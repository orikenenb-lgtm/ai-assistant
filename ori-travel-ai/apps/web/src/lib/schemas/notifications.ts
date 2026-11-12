/** Notifications (contract §3.2). */
import { z } from 'zod';
import { IsoDateTimeSchema, pageSchema } from './common';

export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  body: z.string().nullable().optional(),
  link: z.string().nullable().optional(),
  read_at: IsoDateTimeSchema.nullable().optional(),
  created_at: IsoDateTimeSchema,
});
export type Notification = z.infer<typeof NotificationSchema>;
export const NotificationPageSchema = pageSchema(NotificationSchema);
export const UnreadCountSchema = z.object({ count: z.number().int().nonnegative() });
