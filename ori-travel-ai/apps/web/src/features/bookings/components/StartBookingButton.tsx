import { ClipboardCheck } from 'lucide-react';
import { useContext } from 'react';
import { ButtonLink, type ButtonLinkProps } from '@/components/ui';
import { canBook } from '@/features/auth';
import { AuthContext } from '@/features/auth/context';

export interface StartBookingButtonProps extends Pick<ButtonLinkProps, 'size' | 'variant' | 'className'> {
  offerId: string;
}

/**
 * "הכנת הזמנה": navigates to /bookings?offer_id=… where the start dialog opens.
 * Nothing is created by clicking it. Hidden for users who may not prepare bookings (the server enforces anyway).
 */
export function StartBookingButton({ offerId, size = 'sm', variant = 'secondary', className }: StartBookingButtonProps) {
  const user = useContext(AuthContext)?.user ?? null;
  if (!canBook(user)) return null;
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
