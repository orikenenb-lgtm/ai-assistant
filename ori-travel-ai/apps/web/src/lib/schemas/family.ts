/** Family members, users, invitations and traveler profiles — mirrors the family/travelers backend modules. */
import { z } from 'zod';
import { IsoDateSchema, IsoDateTimeSchema } from './common';

export const AGE_GROUPS = ['adult', 'child', 'infant'] as const;
export const AgeGroupSchema = z.enum(AGE_GROUPS);
export type AgeGroup = z.infer<typeof AgeGroupSchema>;

export const MemberSchema = z.object({
  id: z.string(),
  display_name: z.string(),
  relation: z.string().nullable().optional(),
  age_group: z.string(),
  is_minor: z.boolean(),
  has_traveler_profile: z.boolean().default(false),
  user: z
    .object({ id: z.string(), email: z.string(), role: z.string(), is_active: z.boolean() })
    .nullable()
    .optional(),
});
export type Member = z.infer<typeof MemberSchema>;
export const MemberListSchema = z.array(MemberSchema);

export const InvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  display_name: z.string(),
  role: z.string(),
  legal_adult_attested: z.boolean(),
  status: z.enum(['pending', 'accepted', 'expired', 'revoked']),
  family_member_id: z.string().nullable().optional(),
  created_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
});
export type Invitation = z.infer<typeof InvitationSchema>;
export const InvitationListSchema = z.array(InvitationSchema);
export const InvitationCreatedSchema = z.object({ invitation: InvitationSchema, invite_path: z.string() });
export type InvitationCreated = z.infer<typeof InvitationCreatedSchema>;

export const TravelerDetailSchema = z.object({
  member_id: z.string(),
  display_name: z.string(),
  has_passport: z.boolean().default(false),
  passport_masked: z.string().nullable().optional(),
  passport_expiry_month: z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  seat_preference: z.string().nullable().optional(),
  meal_preference: z.string().nullable().optional(),
  kosher_required: z.boolean().default(false),
  accessibility_needs: z.array(z.string()).default([]),
  updated_at: IsoDateTimeSchema,
  detail_level: z.enum(['full', 'masked']),
  legal_first_name: z.string().nullable().optional(),
  legal_last_name: z.string().nullable().optional(),
  date_of_birth: IsoDateSchema.nullable().optional(),
  passport_expiry: IsoDateSchema.nullable().optional(),
  has_frequent_flyer: z.boolean().default(false),
  gender: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  age_group_suggestion: z.string().nullable().optional(),
});
export type TravelerDetail = z.infer<typeof TravelerDetailSchema>;

export const PassportRevealSchema = z.object({ passport_number: z.string() });
