import { HeartHandshake, Palette, ShieldCheck, Sparkle } from "lucide-react";
import type { TrustItem } from "@/types";

/**
 * Section copy, kept out of components so it can later be translated
 * or moved to a CMS without touching layout code.
 */
export const heroContent = {
  eyebrow: "סטודיו לציפורניים",
  headline: "ציפורניים שמרגישות בדיוק כמוך.",
  subheadline:
    "עיצוב מדויק, חומרים איכותיים ותשומת לב לכל פרט — בחוויה רגועה ואישית.",
  primaryCta: "קביעת תור",
  secondaryCta: "לצפייה בעבודות",
};

export const trustItems: TrustItem[] = [
  { title: "עבודה מקצועית", description: "דיוק וגימור נקי בכל סט", icon: Sparkle },
  { title: "יחס אישי", description: "זמן והקשבה לכל לקוחה", icon: HeartHandshake },
  { title: "עיצוב בהתאמה אישית", description: "סט שנבנה סביב הסגנון שלך", icon: Palette },
  { title: "סביבת עבודה נקייה", description: "הקפדה על היגיינה וסטריליות", icon: ShieldCheck },
];

export const sectionContent = {
  services: {
    eyebrow: "טיפולים",
    title: "הטיפולים שלנו",
    description: "כל טיפול מותאם לציפורן, לסגנון ולקצב החיים שלך.",
    pricePending: "מחיר יעודכן בהמשך",
  },
  gallery: {
    eyebrow: "גלריה",
    title: "העבודות שלנו",
    description: "טעימה מהסגנון של הסטודיו. תמונות עבודות אמיתיות יתווספו בקרוב.",
    empty: "העבודות יעלו לכאן ממש בקרוב.",
  },
  about: {
    eyebrow: "הסטודיו",
    placeholderBio: "הסיפור של הסטודיו יופיע כאן — איך הכול התחיל, מה מניע את העבודה ומה חשוב בכל טיפול.",
    placeholderPhilosophy: "משפט הפילוסופיה של הסטודיו יופיע כאן.",
  },
  testimonials: {
    eyebrow: "המלצות",
    title: "מה הלקוחות אומרות",
    description: "המלצות אמיתיות של לקוחות יתווספו כאן בקרוב.",
    demoBadge: "תוכן לדוגמה",
  },
  cta: {
    title: "מוכנה לסט הבא שלך?",
    description: "בואי ניצור יחד את הסט שמתאים בדיוק לך — מהגוון ועד הצורה.",
    primary: "קביעת תור",
    secondary: "יצירת קשר",
  },
  contact: {
    eyebrow: "יצירת קשר",
    title: "נשמח לשמוע ממך",
    description: "לתיאום תור, שאלה או התייעצות על העיצוב הבא.",
    empty: "פרטי ההתקשרות יתעדכנו כאן בקרוב.",
    labels: {
      phone: "טלפון",
      whatsapp: "WhatsApp",
      instagram: "Instagram",
      address: "כתובת",
      hours: "שעות פעילות",
    },
  },
};
