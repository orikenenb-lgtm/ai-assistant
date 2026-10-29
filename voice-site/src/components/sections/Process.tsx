import { trust } from "@/config/site";
import { SectionHeading } from "@/components/ui/Section";

const steps = [
  {
    title: "שיחת היכרות",
    body: "מספרים לנו על העסק, על השיחות שחוזרות על עצמן ועל הכלים שאתם עובדים איתם. 20 דקות, בלי התחייבות.",
  },
  {
    title: "אנחנו בונים את הנציגה",
    body: "בנק ידע, תסריטים, מענה להתנגדויות וחיבורים למערכות. את כל העבודה הזאת אנחנו עושים.",
  },
  {
    title: "בודקים ועולים לאוויר",
    body: "שיחות בדיקה איתכם עד שזה מרגיש נכון, ואז מספר ייעודי ושיחות אמיתיות עם לקוחות.",
  },
  {
    title: "משתפרים מכל שיחה",
    body: "עוברים יחד על שיחות בממשק, מסמנים מה לשפר, והנציגה נהיית טובה יותר משבוע לשבוע.",
  },
];

export function Process() {
  return (
    <section aria-labelledby="process-title" className="container-page py-20 sm:py-28">
      <SectionHeading
        id="process-title"
        eyebrow="איך מתחילים"
        title={
          <>
            מהשיחה הראשונה ועד
            <br />
            שהנציגה עונה ללקוחות.
          </>
        }
        lead={`בדרך כלל ${trust.goLiveDays}. אתם מספרים על העסק, אנחנו עושים את השאר.`}
      />
      <ol className="mt-12 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <li
            key={s.title}
            data-reveal
            style={{ "--reveal-delay": `${i * 90}ms` } as React.CSSProperties}
            className="relative border-t-2 border-ink pt-5 dark:border-ink-3"
          >
            <span className="text-5xl font-extrabold text-brand" aria-hidden="true">
              {i + 1}
            </span>
            <h3 className="mt-3 text-xl font-bold">
              <span className="sr-only">שלב {i + 1}: </span>
              {s.title}
            </h3>
            <p className="mt-2 leading-relaxed text-ink-2">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
