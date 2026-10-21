import type { SiteConfig } from "@/types";
import { hasValue } from "@/lib/utils";

/**
 * ─────────────────────────────────────────────────────────────
 *  The ONLY place for business details.
 *  Replace placeholders here — components read everything from this file.
 *  Empty strings / UPPER_SNAKE_CASE tokens are treated as "not set" and
 *  the related UI (links, contact rows, structured data) is hidden.
 * ─────────────────────────────────────────────────────────────
 */
export const siteConfig: SiteConfig = {
  name: "NAIL_STUDIO_NAME",
  owner: "OWNER_NAME",
  description:
    "סטודיו לציפורניים — לק ג׳ל, בנייה, מילוי ועיצובי Nail Art בהתאמה אישית.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000",
  locale: "he_IL",
  lang: "he",
  dir: "rtl",
  contact: {
    phone: "", // PHONE_NUMBER, e.g. "050-000-0000"
    whatsapp: "", // WHATSAPP number, e.g. "972500000000"
    instagram: "", // INSTAGRAM_URL, e.g. "https://www.instagram.com/..."
    tiktok: "", // TIKTOK_URL
    address: "", // STUDIO_ADDRESS
    city: "", // STUDIO_CITY
    mapsUrl: "", // GOOGLE_MAPS_URL
    openingHours: [], // e.g. [{ days: "א׳–ה׳", hours: "10:00–19:00" }]
  },
  booking: {
    url: "", // BOOKING_URL — external booking system, when available
  },
  seo: {
    allowIndexing: process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true",
  },
  features: {
    showDemoTestimonials: true,
  },
};

/** Generic wordmark shown until the real business name is configured. */
const BRAND_FALLBACK = "Nail Studio";

export const brandName = hasValue(siteConfig.name) ? siteConfig.name : BRAND_FALLBACK;
