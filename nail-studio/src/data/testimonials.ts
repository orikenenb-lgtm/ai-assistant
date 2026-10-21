import type { Testimonial } from "@/types";

/**
 * DEMO CONTENT ONLY — these are not real reviews.
 * Replace with real customer reviews (with permission) and set `isDemo: false`.
 */
export const testimonials: Testimonial[] = [
  {
    id: "demo-1",
    name: "שם הלקוחה",
    review: "כאן תופיע ביקורת אמיתית של לקוחה. הטקסט הנוכחי הוא תוכן לדוגמה בלבד.",
    rating: 5,
    isDemo: true,
  },
  {
    id: "demo-2",
    name: "שם הלקוחה",
    review: "מקום להמלצה נוספת — חוויה, תוצאה ומה שהיה חשוב ללקוחה. תוכן לדוגמה.",
    rating: 5,
    isDemo: true,
  },
  {
    id: "demo-3",
    name: "שם הלקוחה",
    review: "המלצות אמיתיות יחליפו את הכרטיסים האלה ברגע שיתקבלו. תוכן לדוגמה.",
    rating: 5,
    isDemo: true,
  },
];
