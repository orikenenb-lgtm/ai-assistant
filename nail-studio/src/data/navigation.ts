import type { NavItem } from "@/types";
import { SECTION_IDS, anchor } from "@/lib/links";

export const mainNav: NavItem[] = [
  { label: "בית", href: anchor(SECTION_IDS.home) },
  { label: "שירותים", href: anchor(SECTION_IDS.services) },
  { label: "עבודות", href: anchor(SECTION_IDS.gallery) },
  { label: "אודות", href: anchor(SECTION_IDS.about) },
  { label: "המלצות", href: anchor(SECTION_IDS.testimonials) },
  { label: "יצירת קשר", href: anchor(SECTION_IDS.contact) },
];
