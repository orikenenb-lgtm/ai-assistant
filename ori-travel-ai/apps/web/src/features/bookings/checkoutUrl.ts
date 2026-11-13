import { safeExternalUrl } from '@/lib/safeUrl';
import { DEMO_CHECKOUT_URL_PATTERN, type CheckoutLink } from '@/lib/schemas/bookings';

export interface CheckoutTarget {
  href: string;
  /** Same-origin DEMO supplier page (true) or an external https supplier site (false). */
  internal: boolean;
}

/**
 * The only two shapes the client will open (the server enforces the same rules and is authoritative):
 *  - DEMO supplier: exactly `/demo-supplier/checkout?ref=<opaque>` — a same-origin path, and only when the
 *    server says the link is a DEMO link. `//host`, `/\host`, extra parameters, fragments etc. never match.
 *  - anything else: a plain https URL (no credentials, ports, backslashes or control characters).
 * A DEMO link is never allowed to be an absolute URL, and a non-DEMO link is never allowed to be relative.
 */
export function checkoutTarget(link: Pick<CheckoutLink, 'url' | 'is_demo'>): CheckoutTarget | null {
  if (link.is_demo) {
    return DEMO_CHECKOUT_URL_PATTERN.test(link.url) ? { href: link.url, internal: true } : null;
  }
  const href = safeExternalUrl(link.url);
  return href ? { href, internal: false } : null;
}

/** Only https URLs are ever opened for real suppliers (the server additionally enforces the provider's domain allowlist). */
export function safeCheckoutUrl(raw: string): string | null {
  return safeExternalUrl(raw);
}
