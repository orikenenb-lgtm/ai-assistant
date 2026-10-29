/** Speed-to-lead research. Every figure here is backed by a numbered source. */

export const sources = [
  {
    id: 1,
    text: "Oldroyd, McElheran & Elkington, ״The Short Life of Online Sales Leads״, Harvard Business Review, מרץ 2011. ניתוח של כ-1.25 מיליון לידים מ-42 חברות, ובדיקת זמני תגובה ב-2,241 חברות בארה״ב.",
    url: "https://hbr.org/2011/03/the-short-life-of-online-sales-leads",
  },
  {
    id: 2,
    text: "Velocify, ניתוח של כ-3.5 מיליון לידים (2012): שיעור ההמרה של לידים שקיבלו שיחה בדקה הראשונה, לעומת שיחה אחרי 30 דקות.",
    url: undefined,
  },
  {
    id: 3,
    text: "חוק הגנת הצרכן, התשמ״א-1981, סעיף 18ב, ותקנות הגנת הצרכן (מתן שירות טלפוני): ספקי שירותים מסוימים (תקשורת, חשמל, מים, גז ועוד) חייבים לתת מענה אנושי תוך 6 דקות לכל היותר.",
    url: "https://www.kolzchut.org.il/he/מענה_טלפוני_חינם_לצרכן_מאת_ספקי_שירותים",
  },
] as const;

export const headlineStats = [
  { value: "×7", label: "יותר סיכוי לדבר עם מקבל ההחלטה כשחוזרים לליד תוך שעה, לעומת שעה אחר כך", source: 1 },
  { value: "×60", label: "יותר סיכוי מאשר כשחוזרים אחרי 24 שעות או יותר", source: 1 },
  { value: "+391%", label: "המרה כשהשיחה לליד יוצאת כבר בדקה הראשונה", source: 2 },
] as const;

/** How the 2,241 audited companies responded to a web lead (HBR, 2011). */
export const responseBuckets = [
  { key: "hour", label: "תוך שעה", value: 37 },
  { key: "day", label: "שעה עד יום", value: 16 },
  { key: "late", label: "יותר מיום", value: 24 },
  { key: "never", label: "לא חזרו בכלל", value: 23 },
] as const;
