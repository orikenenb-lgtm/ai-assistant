import { ClipboardCheck } from 'lucide-react';
import { useContext } from 'react';
import { ButtonLink, type ButtonLinkProps } from '@/components/ui';
import { canBook } from '@/features/auth';
import { AuthContext } from '@/features/auth/context';
import type { DataMode } from '@/lib/schemas/common';

export interface StartBookingButtonProps extends Pick<ButtonLinkProps, 'size' | 'variant' | 'className'> {
  offerId: string;
  /** The offer's data mode: SANDBOX (supplier test data) can never be booked, so no button is shown. */
  mode?: DataMode;
}

/**
 * "הכנת הזמנה": navigates to /bookings?offer_id=… where the start dialog opens.
 * Nothing is created by clicking it. Hidden for users who may not prepare bookings (the server enforces anyway).
 */
export function StartBookingButton({ offerId, mode, size = 'sm', variant = 'secondary', className }: StartBookingButtonProps) {
  const user = useContext(AuthContext)?.user ?? null;
  if (!canBook(user)) return null;
  if (mode === 'SANDBOX') {
    return (
      <p className="text-xs font-medium text-fg-muted" data-testid="sandbox-no-booking">
        הצעת בדיקה (Sandbox) — לא ניתנת להזמנה
      </p>
    );
  }
  return (
    <ButtonLink
      to={`/bookings?offer_id=${encodeURIComponent(offerId)}`}
      size={size}
      variant={variant}
      className={className}
      leadingIcon={<ClipboardCheck aria-hidden="true" />}
    >
      הכנת הזמנה
    </ButtonLink>
  );
}
