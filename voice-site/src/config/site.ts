/**
 * Single source of truth for everything business-specific on the site:
 * brand, contact channels, prices and claims. Change values here (or via the
 * NEXT_PUBLIC_* env vars) and every section, the ROI calculator, the demo agent
 * and the structured data pick them up.
 */

export const brand = {
  name: "SMART Voice",
  /** Short line under the logo and in the footer. */
  tagline: "נציג טלפוני AI בעברית לעסקים",
  /** The demo agent's persona name (used in the live demo and examples). */
  agentName: "נועה",
  description:
    "סוכן AI טלפוני בעברית שעונה לשיחות, קובע תורים ופגישות, ומעדכן את היומן, ה-CRM והוואטסאפ של העסק. 24/7, על מספר ישראלי ייעודי.",
} as const;

function digitsOnly(value: string | undefined): string | undefined {
  const d = value?.replace(/\D/g, "");
  return d ? d : undefined;
}

/**
 * Contact channels. Anything left empty is simply not rendered, so the site
 * never shows a dead button. Set them in `.env.local` / Vercel env.
 */
export const contact = {
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, ""),
  /** International format digits, e.g. 972501234567. Enables WhatsApp CTAs. */
  whatsappNumber: digitsOnly(process.env.NEXT_PUBLIC_WHATSAPP_NUMBER),
  /** A line that reaches the live phone agent, e.g. 03-1234567. Enables "call it now". */
  demoPhone: process.env.NEXT_PUBLIC_DEMO_PHONE?.trim() || undefined,
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || undefined,
  /** How fast the team promises to get back to a lead (shown in the form). */
  responseTime: "תוך יום עסקים",
} as const;

export function whatsappLink(text: string): string | undefined {
  if (!contact.whatsappNumber) return undefined;
  return `https://wa.me/${contact.whatsappNumber}?text=${encodeURIComponent(text)}`;
}

export function telLink(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  return `tel:${d}`;
}

export type Plan = {
  id: "start" | "growth" | "pro";
  name: string;
  /** Monthly price in ILS, before VAT. */
  price: number;
  /** Talk minutes included per month. */
  minutes: number;
  agents: number;
  whatsapp: boolean;
  highlight?: boolean;
  blurb: string;
  features: string[];
};

export const plans: Plan[] = [
  {
    id: "start",
    name: "Start",
    price: 490,
    minutes: 120,
    agents: 1,
    whatsapp: false,
    blurb: "לעסק שרוצה להפסיק לפספס שיחות",
    features: [
      "120 דקות שיחה בחודש",
      "סוכן אחד מותאם לעסק",
      "מספר ישראלי ייעודי",
      "שיחות נכנסות ויוצאות",
      "יומן Google, מייל ו-Webhooks",
      "תמלול וסיכום לכל שיחה",
    ],
  },
  {
    id: "growth",
    name: "Growth",
    price: 790,
    minutes: 300,
    agents: 1,
    whatsapp: true,
    highlight: true,
    blurb: "הכי משתלם לרוב העסקים",
    features: [
      "300 דקות שיחה בחודש",
      "הכול ב-Start, ובנוסף:",
      "סוכן וואטסאפ על אותו מוח",
      "חיבור ל-CRM ולמערכת התורים",
      "תזכורות ואישורי הגעה אוטומטיים",
      "דוח שיחות שבועי",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: 1290,
    minutes: 600,
    agents: 2,
    whatsapp: true,
    blurb: "לעסק עם כמה סניפים או מחלקות",
    features: [
      "600 דקות שיחה בחודש",
      "הכול ב-Growth, ובנוסף:",
      "2 סוכנים (למשל מכירות ושירות)",
      "העברה חכמה בין סוכנים ונציגים",
      "חיבור API מותאם",
      "ליווי אישי ושיפור חודשי",
    ],
  },
];

export const pricing = {
  currency: "₪",
  setupFee: 0,
  /** Price per extra minute above the plan's included minutes. */
  extraMinutePrice: 1.9,
  /** WhatsApp agent add-on for plans that don't include it. */
  whatsappAddon: 69,
  /** Free talk minutes to build and try the agent before paying. */
  trialMinutes: 15,
  vatNote: "המחירים לחודש, לפני מע״מ. בלי התחייבות ובלי דמי הקמה.",
} as const;

/** Claims shown in trust strips and FAQ. Keep them true for your deployment. */
export const trust = {
  dataRegion: "האיחוד האירופי",
  languages: ["עברית", "אנגלית", "ערבית", "רוסית"],
  goLiveDays: "3–7 ימי עבודה",
} as const;

export const nav = [
  { href: "#how", label: "איך זה עובד" },
  { href: "#industries", label: "למי זה מתאים" },
  { href: "#roi", label: "מחשבון חיסכון" },
  { href: "#pricing", label: "מחירון" },
  { href: "#faq", label: "שאלות" },
] as const;
