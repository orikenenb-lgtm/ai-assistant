import { Check, PhoneMissed, Repeat2, StickyNote } from "lucide-react";
import { SectionHeading } from "@/components/ui/Section";

const pains = [
  {
    icon: PhoneMissed,
    quote: "״התקשרו בדיוק כשהייתי עם לקוח״",
    answer: "הנציגה עונה מיד, גם כשכולם עסוקים, אוספת את הפרטים ומוודאת שאף פנייה לא הולכת לאיבוד.",
    stat: "כל שיחה נענית",
  },
  {
    icon: Repeat2,
    quote: "״כל היום שואלים אותנו את אותן שאלות״",
    answer: "מחירים, שעות, זמינות וחניה. הלקוחות מקבלים תשובה מדויקת, והצוות חוזר לעבודה האמיתית.",
    stat: "שעות שמתפנות כל שבוע",
  },
  {
    icon: StickyNote,
    quote: "״רשמנו את הפרטים, ושכחנו לחזור״",
    answer: "כל שיחה נגמרת בסיכום, בפרטי הלקוח ובפעולה הבאה, ישר ב-CRM, ביומן ובוואטסאפ.",
    stat: "אפס פתקים אבודים",
  },
];

export function PainPoints() {
  return (
    <section aria-labelledby="pains-title" className="container-page py-20 sm:py-28">
      <SectionHeading align="center" id="pains-title" title="מכירים את השיחות האלה?" lead="שלוש בעיות שכל בעל עסק מכיר, ופתרון אחד שעובד בשבילכם מסביב לשעון." />
      <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3">
        {pains.map(({ icon: Icon, quote, answer, stat }, i) => (
          <li
            key={quote}
            data-reveal
            style={{ "--reveal-delay": `${i * 90}ms` } as React.CSSProperties}
            className="group relative flex flex-col rounded-3xl border border-line bg-surface p-6 shadow-soft transition-shadow hover:shadow-card"
          >
            <span className="grid size-11 place-items-center rounded-2xl bg-tint text-brand">
              <Icon className="size-5" aria-hidden="true" />
            </span>
            <p className="mt-5 text-xl font-bold leading-snug">{quote}</p>
            <div className="mt-4 flex gap-2 border-t border-line pt-4 text-ink-2">
              <Check className="mt-1 size-4 shrink-0 text-brand" aria-hidden="true" />
              <p className="leading-relaxed">{answer}</p>
            </div>
            <p className="mt-auto pt-5 text-sm font-semibold text-brand">{stat}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
