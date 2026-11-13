/**
 * Role helpers — UI hints only. The server enforces every permission;
 * never rely on these for security.
 *   owner > adult > viewer
 */
import type { Role, User } from '@/lib/schemas/auth';

type MaybeUser = Pick<User, 'role' | 'can_book' | 'legal_adult_attested' | 'is_active'> | null | undefined;

export function hasRole(user: MaybeUser, ...roles: Role[]): boolean {
  return !!user && user.is_active && roles.includes(user.role);
}

/** Family administration, providers, server settings, audit. */
export function isOwner(user: MaybeUser): boolean {
  return hasRole(user, 'owner');
}

/** Create/modify family content (trips, members, alerts): owner or adult. */
export function canEdit(user: MaybeUser): boolean {
  return hasRole(user, 'owner', 'adult');
}

/** Prepare bookings: owner/adult AND attested legal adult (server-computed `can_book`). */
export function canBook(user: MaybeUser): boolean {
  return !!user && user.is_active && user.can_book && hasRole(user, 'owner', 'adult') && user.legal_adult_attested;
}
