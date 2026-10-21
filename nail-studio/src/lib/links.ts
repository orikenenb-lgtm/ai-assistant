import { siteConfig } from "@/config/site";
import { safeHttpsUrl, toTelHref, toWhatsAppHref } from "@/lib/utils";

/** In-page anchor IDs. Keep in sync with the section `id` attributes. */
export const SECTION_IDS = {
  home: "home",
  services: "services",
  gallery: "gallery",
  about: "about",
  testimonials: "testimonials",
  booking: "booking",
  contact: "contact",
} as const;

export type SectionId = (typeof SECTION_IDS)[keyof typeof SECTION_IDS];

export const anchor = (id: SectionId) => `/#${id}` as const;

export interface BookingLink {
  href: string;
  external: boolean;
}

/**
 * Where "קביעת תור" leads. Until a booking system is configured,
 * it scrolls to the contact section; later it opens the booking URL.
 */
export function getBookingLink(): BookingLink {
  const external = safeHttpsUrl(siteConfig.booking.url);
  return external
    ? { href: external, external: true }
    : { href: anchor(SECTION_IDS.contact), external: false };
}

export interface SocialLink {
  id: "instagram" | "whatsapp" | "tiktok";
  label: string;
  href: string;
}

/** Only returns social links that are actually configured and valid. */
export function getSocialLinks(): SocialLink[] {
  const { instagram, whatsapp, tiktok } = siteConfig.contact;
  const links: Array<SocialLink | null> = [
    withHref("instagram", "Instagram", safeHttpsUrl(instagram)),
    withHref("whatsapp", "WhatsApp", toWhatsAppHref(whatsapp)),
    withHref("tiktok", "TikTok", safeHttpsUrl(tiktok)),
  ];
  return links.filter((link): link is SocialLink => link !== null);
}

function withHref(id: SocialLink["id"], label: string, href: string | null): SocialLink | null {
  return href ? { id, label, href } : null;
}

export const phoneHref = () => toTelHref(siteConfig.contact.phone);
