import { useMutation, useQuery } from '@tanstack/react-query';
import { assistantKeys, fetchAiStatus, requestPlan, sendChat } from './api';

export function useAiStatus() {
  return useQuery({ queryKey: assistantKeys.status, queryFn: fetchAiStatus, staleTime: 60_000 });
}

export function useSendChat() {
  return useMutation({ mutationFn: sendChat });
}

export function usePlanTrip() {
  return useMutation({ mutationFn: requestPlan });
}
