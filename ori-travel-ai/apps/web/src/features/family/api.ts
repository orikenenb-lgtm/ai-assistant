/** Family API (members, users, invitations) — contract §3.2. */
import { api } from '@/lib/api';
import { OkResponseSchema } from '@/lib/schemas/common';
import { UserSchema } from '@/lib/schemas/auth';
import { InvitationCreatedSchema, InvitationListSchema, MemberListSchema, MemberSchema } from '@/lib/schemas/family';
import { z } from 'zod';

export const familyKeys = {
  all: ['family'] as const,
  members: ['family', 'members'] as const,
  users: ['family', 'users'] as const,
  invitations: ['family', 'invitations'] as const,
};

export const fetchMembers = () => api.get('/api/family/members', { schema: MemberListSchema });
export const createMember = (body: Record<string, unknown>) => api.post('/api/family/members', body, { schema: MemberSchema });
export const updateMember = (id: string, body: Record<string, unknown>) =>
  api.patch(`/api/family/members/${encodeURIComponent(id)}`, body, { schema: MemberSchema });
export const deleteMember = (id: string) => api.delete(`/api/family/members/${encodeURIComponent(id)}`, { schema: OkResponseSchema });

export const fetchUsers = () => api.get('/api/family/users', { schema: z.array(UserSchema) });
export const updateUser = (id: string, body: Record<string, unknown>) =>
  api.patch(`/api/family/users/${encodeURIComponent(id)}`, body, { schema: UserSchema });

export const deleteUser = (id: string) => api.delete(`/api/family/users/${encodeURIComponent(id)}`, { schema: OkResponseSchema });

export const fetchInvitations = () => api.get('/api/family/invitations', { schema: InvitationListSchema });
export const createInvitation = (body: Record<string, unknown>) =>
  api.post('/api/family/invitations', body, { schema: InvitationCreatedSchema });
export const revokeInvitation = (id: string) =>
  api.delete(`/api/family/invitations/${encodeURIComponent(id)}`, { schema: OkResponseSchema });
