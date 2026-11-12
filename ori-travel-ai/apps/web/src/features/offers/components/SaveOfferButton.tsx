import { Bookmark, BookmarkCheck } from 'lucide-react';
import { useState } from 'react';
import { Button, type ButtonProps } from '@/components/ui';
import { useSaveOffer, wasSavedThisSession } from '../hooks';

export interface SaveOfferButtonProps extends Pick<ButtonProps, 'size' | 'variant' | 'className'> {
  offerId: string;
  /** Icon-only label for tight layouts. */
  iconOnly?: boolean;
}

/** POST /api/saved-offers. Handles 409 ALREADY_SAVED and a not-yet-available backend (404) with toasts. */
export function SaveOfferButton({ offerId, size = 'sm', variant = 'secondary', className }: SaveOfferButtonProps) {
  const save = useSaveOffer();
  const [saved, setSaved] = useState(() => wasSavedThisSession(offerId));
  const isSaved = saved || wasSavedThisSession(offerId);
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      loading={save.isPending}
      disabled={isSaved}
      leadingIcon={isSaved ? <BookmarkCheck aria-hidden="true" /> : <Bookmark aria-hidden="true" />}
      onClick={() =>
        save.mutate(
          { offerId },
          {
            onSuccess: () => setSaved(true),
          },
        )
      }
    >
      {isSaved ? 'נשמרה' : 'שמירה'}
    </Button>
  );
}
