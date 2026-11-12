import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/ui';
import { overlapConflict } from '@/features/trips/formUtils';
import { isApiError } from '@/lib/api';
import { addOfferToTrip, fetchOffer, offerKeys, saveOffer } from './api';

export function useOffer(offerId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: offerKeys.detail(offerId ?? ''),
    queryFn: () => fetchOffer(offerId as string),
    enabled: enabled && !!offerId,
    staleTime: 60_000,
  });
}

/** Offer ids saved in this browsing session (so the button stays "saved" across re-renders). */
const savedThisSession = new Set<string>();
export function wasSavedThisSession(id: string): boolean {
  return savedThisSession.has(id);
}

export type SaveOutcome = 'saved' | 'already';

export function useSaveOffer() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation<SaveOutcome, unknown, { offerId: string; title?: string }>({
    mutationFn: async ({ offerId }) => {
      try {
        await saveOffer({ offerId });
        return 'saved';
      } catch (e) {
        if (isApiError(e) && e.status === 409) return 'already';
        throw e;
      }
    },
    onSuccess: (outcome, { offerId }) => {
      savedThisSession.add(offerId);
      void qc.invalidateQueries({ queryKey: offerKeys.saved });
      toast(
        outcome === 'saved'
          ? { title: 'ההצעה נשמרה', description: 'תמצאו אותה ברשימת ההצעות השמורות.', tone: 'success' }
          : { title: 'ההצעה כבר שמורה', description: 'היא כבר ברשימת ההצעות השמורות שלכם.', tone: 'info' },
      );
    },
    onError: (e) => {
      if (isApiError(e) && e.status === 404) {
        toast({ title: 'שמירת הצעות עדיין לא זמינה', description: 'השירות בפיתוח בשרת. נסו שוב בהמשך.', tone: 'warn' });
      } else if (isApiError(e) && e.status === 403) {
        toast({ title: 'אין הרשאה לשמור הצעות', description: e.message, tone: 'danger' });
      } else {
        toast({ title: 'לא ניתן לשמור את ההצעה', description: isApiError(e) ? e.message : 'נסו שוב.', tone: 'danger' });
      }
    },
  });
}

export interface AddOfferToTripVars {
  tripId: string;
  offerId: string;
  tripTitle?: string;
  /** Resend after the user confirmed an ITEM_OVERLAP warning. */
  allowOverlap?: boolean;
}

/**
 * Adds an offer to a trip. A 409 `ITEM_OVERLAP` is re-thrown WITHOUT a toast so the caller can ask the user and
 * retry with `allowOverlap: true` (see AddToTripButton); any other 409 means the offer is already in the trip.
 */
export function useAddOfferToTrip() {
  const { toast } = useToast();
  const qc = useQueryClient();
  return useMutation<'added' | 'already', unknown, AddOfferToTripVars>({
    mutationFn: async ({ tripId, offerId, allowOverlap }) => {
      try {
        await addOfferToTrip({ tripId, offerId, allowOverlap });
        return 'added';
      } catch (e) {
        if (isApiError(e) && e.status === 409 && !overlapConflict(e)) return 'already';
        throw e;
      }
    },
    onSuccess: (outcome, { tripId, tripTitle }) => {
      void qc.invalidateQueries({ queryKey: ['trips', 'detail', tripId] });
      void qc.invalidateQueries({ queryKey: ['trips', 'list'] });
      const where = tripTitle ? `לטיול "${tripTitle}"` : 'לטיול';
      toast(
        outcome === 'added'
          ? { title: 'ההצעה נוספה לטיול', description: `ההצעה נוספה ${where}.`, tone: 'success' }
          : { title: 'ההצעה כבר בטיול', description: 'היא כבר מופיעה בטיול שנבחר.', tone: 'info' },
      );
    },
    onError: (e, vars) => {
      // Overlap → handled by the caller's confirm dialog; a failed confirmed retry is shown inside that dialog.
      if (overlapConflict(e) || vars.allowOverlap) return;
      if (isApiError(e) && e.status === 404) {
        toast({ title: 'הוספה לטיול עדיין לא זמינה', description: 'הטיול או השירות לא נמצאו בשרת.', tone: 'warn' });
      } else {
        toast({ title: 'לא ניתן להוסיף לטיול', description: isApiError(e) ? e.message : 'נסו שוב.', tone: 'danger' });
      }
    },
  });
}
