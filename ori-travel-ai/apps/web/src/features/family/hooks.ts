import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createInvitation,
  createMember,
  deleteMember,
  familyKeys,
  fetchInvitations,
  fetchMembers,
  fetchUsers,
  revokeInvitation,
  updateMember,
  updateUser,
} from './api';
import { travelerKeys } from '@/features/travelers/api';

export function useMembers() {
  return useQuery({ queryKey: familyKeys.members, queryFn: fetchMembers });
}

/** Owner only (403 for others) — pass `enabled` so non-owners never call it. */
export function useFamilyUsers(enabled: boolean) {
  return useQuery({ queryKey: familyKeys.users, queryFn: fetchUsers, enabled });
}

export function useInvitations(enabled: boolean) {
  return useQuery({ queryKey: familyKeys.invitations, queryFn: fetchInvitations, enabled });
}

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => createMember(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyKeys.members }),
  });
}

export function useUpdateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => updateMember(id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyKeys.members }),
  });
}

export function useDeleteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteMember(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: familyKeys.members });
      void qc.invalidateQueries({ queryKey: travelerKeys.all });
      void qc.invalidateQueries({ queryKey: ['trips'] });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) => updateUser(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: familyKeys.users });
      void qc.invalidateQueries({ queryKey: familyKeys.members });
    },
  });
}

export function useCreateInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => createInvitation(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyKeys.invitations }),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: familyKeys.invitations }),
  });
}
