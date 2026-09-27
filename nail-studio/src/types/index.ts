import type { LucideIcon } from "lucide-react";

/** A single navigation entry. `href` is always an in-page anchor such as "/#services". */
export interface NavItem {
  label: string;
  href: `/#${string}` | "/";
}

/** One line of opening hours, e.g. { days: "א׳–ה׳", hours: "10:00–19:00" }. */
export interface OpeningHoursEntry {
  days: string;
  hours: string;
}

export interface SiteContact {
  /** Display phone, e.g. "050-000-0000". Empty = hidden. */
  phone: string;
  /** WhatsApp number in international format without "+", e.g. "972500000000". Empty = hidden. */
  whatsapp: string;
  /** Full https:// Instagram profile URL. Empty = hidden. */
  instagram: string;
  /** Full https:// TikTok profile URL. Empty = hidden. */
  tiktok: string;
  /** Street address. Empty = hidden. */
  address: string;
  city: string;
  /** Optional https:// Google Maps link for the address. */
  mapsUrl: string;
  openingHours: OpeningHoursEntry[];
}

export interface SiteConfig {
  /** Business name. Placeholder tokens (UPPER_SNAKE_CASE) are treated as "not set". */
  name: string;
  owner: string;
  description: string;
  /** Canonical site origin, read from NEXT_PUBLIC_SITE_URL. */
  url: string;
  locale: string;
  lang: string;
  dir: "rtl" | "ltr";
  contact: SiteContact;
  booking: {
    /** External booking system URL (https://). Empty = CTA scrolls to the contact section. */
    url: string;
  };
  seo: {
    /** Search engines index the site only when this is true (NEXT_PUBLIC_ALLOW_INDEXING=true). */
    allowIndexing: boolean;
  };
  features: {
    /** Show clearly-labelled demo testimonials until real reviews exist. */
    showDemoTestimonials: boolean;
  };
}

export type ServiceIconName =
  | "gel"
  | "build"
  | "fill"
  | "french"
  | "art"
  | "removal";

export interface Service {
  id: string;
  title: string;
  description: string;
  icon: ServiceIconName;
  /** Price in ILS. `null` = not published yet. */
  price: number | null;
  /** Optional duration label, e.g. "60 דק׳". */
  duration?: string;
}

/** Visual tone used by the abstract placeholder art until real photos exist. */
export type PlaceholderTone = "nude" | "rose" | "ivory" | "mocha" | "blush" | "sand";

export interface GalleryImage {
  src: string;
  width: number;
  height: number;
}

export interface GalleryItem {
  id: string;
  /** Real photo. When missing, an abstract placeholder is rendered. */
  image?: GalleryImage;
  alt: string;
  category: string;
  description: string;
  /** Grid footprint on larger screens. */
  shape: "square" | "tall" | "wide";
  tone: PlaceholderTone;
}

export interface Testimonial {
  id: string;
  name: string;
  review: string;
  /** 1–5 */
  rating: number;
  avatar?: string;
  /** Demo content must be labelled as such in the UI. */
  isDemo: boolean;
}

export interface TrustItem {
  title: string;
  description: string;
  icon: LucideIcon;
}

export interface AboutContent {
  heading: string;
  ownerImage?: GalleryImage;
  /** Paragraphs of the real biography. Empty = placeholder copy is shown. */
  biography: string[];
  experience: string;
  philosophy: string;
}
