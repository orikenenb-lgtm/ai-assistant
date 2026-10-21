import type { Service } from "@/types";

/**
 * Service catalogue. `price: null` renders "מחיר יעודכן בהמשך".
 * Descriptions are generic explanations of each treatment — not business claims.
 */
export const services: Service[] = [
  {
    id: "gel-polish",
    title: "לק ג׳ל",
    description: "צבע עמיד ומבריק על הציפורן הטבעית, בגימור נקי ומדויק.",
    icon: "gel",
    price: null,
  },
  {
    id: "extensions",
    title: "בנייה",
    description: "הארכה ועיצוב צורת הציפורן — מהקצר והטבעי ועד הארוך והמוקפד.",
    icon: "build",
    price: null,
  },
  {
    id: "refill",
    title: "מילוי",
    description: "חידוש הבנייה לאחר צמיחת הציפורן, לשמירה על מראה מלא ומסודר.",
    icon: "fill",
    price: null,
  },
  {
    id: "french",
    title: "פרנץ׳",
    description: "הקלאסיקה שלא יוצאת מהאופנה, בקו עדין או בגרסה מודרנית.",
    icon: "french",
    price: null,
  },
  {
    id: "nail-art",
    title: "Nail Art",
    description: "עיצובים בהתאמה אישית — מפרטים מינימליסטיים ועד סטים מלאים.",
    icon: "art",
    price: null,
  },
  {
    id: "removal",
    title: "הסרה",
    description: "הסרה עדינה ובטוחה שמכבדת את הציפורן הטבעית.",
    icon: "removal",
    price: null,
  },
];
