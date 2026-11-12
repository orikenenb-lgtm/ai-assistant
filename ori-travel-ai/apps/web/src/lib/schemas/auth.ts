/** Mirrors `apps/api/app/modules/auth/schemas.py`. */
import { z } from 'zod';
import { IsoDateTimeSchema } from './common';

export const ROLES = ['owner', 'adult', 'viewer'] as const;
export const RoleSchema = z.enum(ROLES);
export type Role = z.infer<typeof RoleSchema>;

export const UserSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  role: RoleSchema,
  is_active: z.boolean(),
  legal_adult_attested: z.boolean(),
  can_book: z.boolean(),
  last_login_at: IsoDateTimeSchema.nullable().optional(),
  created_at: IsoDateTimeSchema,
});
export type User = z.infer<typeof UserSchema>;

export const SessionOutSchema = z.object({
  user: UserSchema,
  csrf_token: z.string().min(1),
});
export type SessionOut = z.infer<typeof SessionOutSchema>;

export const InvitationPreviewSchema = z.object({
  email: z.string(),
  display_name: z.string(),
  role: RoleSchema,
  expires_at: IsoDateTimeSchema,
});
export type InvitationPreview = z.infer<typeof InvitationPreviewSchema>;
