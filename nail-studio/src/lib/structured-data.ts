import { siteConfig } from "@/config/site";
import { hasValue, safeHttpsUrl } from "@/lib/utils";

/**
 * Builds schema.org LocalBusiness (NailSalon) JSON-LD.
 * Returns null until the essential real details exist, so no invented
 * business data is ever published to search engines.
 */
export function buildLocalBusinessSchema(): Record<string, unknown> | null {
  const { name, contact, url, description } = siteConfig;
  const hasEssentials = hasValue(name) && hasValue(contact.address) && hasValue(contact.city) && hasValue(contact.phone);
  if (!hasEssentials) return null;

  const sameAs = [safeHttpsUrl(contact.instagram), safeHttpsUrl(contact.tiktok)].filter(
    (link): link is string => link !== null,
  );

  return {
    "@context": "https://schema.org",
    "@type": "NailSalon",
    name,
    description,
    url,
    telephone: contact.phone,
    address: {
      "@type": "PostalAddress",
      streetAddress: contact.address,
      addressLocality: contact.city,
      addressCountry: "IL",
    },
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}
