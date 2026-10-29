import { BatteryFull, ChevronDown, Moon, PhoneIncoming, Signal, Wifi } from "lucide-react";
import { brand } from "@/config/site";
import { headlineStats, responseBuckets, sources } from "@/content/research";
import { Eyebrow } from "@/components/ui/Section";

const bucketStyle: Record<string, string> = {
  hour: "bg-forest text-on-forest dark:bg-forest-3",
  day: "bg-brand text-brand-ink",
  late: "bg-brand-soft text-ink",
  never: "bg-surface-2 text-ink-2 border border-line",
};

function Sup({ n }: { n: number }) {
  return (
    <a href={`#source-${n}`} className="ms-0.5 align-super text-[0.65em] font-semibold text-brand hover:underline" aria-label={`מקור ${n}`}>
      {n}
    </a>
  );
}

function NightCall() {
  return (
    <div className="relative mx-auto w-full max-w-[19rem]" data-reveal>
      <div className="rounded-[2.6rem] border-[10px] border-[#0d1510] bg-[#0d1510] shadow-float">
        <div className="relative overflow-hidden rounded-[2rem] bg-gradient-to-b from-[#16291e] to-[#0b140f] px-5 pb-6 pt-3 text-on-forest">
          <div className="flex items-center justify-between text-[0.7rem] text-on-forest-2">
            <span className="ltr tabular font-semibold text-on-forest">02:14</span>
            <span className="flex items-center gap-1" aria-hidden="true">
              <Signal className="size-3" /> <Wifi className="size-3" /> <BatteryFull className="size-3.5" />
            </span>
          </div>
          <div className="mt-8 flex flex-col items-center text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-xs text-on-forest-2">
              <Moon className="size-3.5" aria-hidden="true" /> לילה, העסק סגור
            </span>
            <span className="relative mt-6 grid size-20 place-items-center rounded-full bg-accent text-accent-ink">
              <span className="absolute inset-0 rounded-full bg-accent/40 animate-pulse-ring" aria-hidden="true" />
              <PhoneIncoming className="relative size-8" aria-hidden="true" />
            </span>
            <p className="mt-4 text-lg font-bold">שיחה נכנסת</p>
            <p className="ltr tabular text-sm text-on-forest-2">054-•••-••12</p>
          </div>
          <div className="mt-6 space-y-2 text-[0.82rem] leading-relaxed">
            <p className="me-6 rounded-2xl rounded-ss-md bg-white px-3 py-2 text-[#132019]">יש לכם מחר בבוקר תור פנוי?</p>
            <p className="ms-6 rounded-2xl rounded-se-md bg-forest-3 px-3 py-2">יש ב-9:15. קבעתי ושלחתי אישור בוואטסאפ 🙂</p>
          </div>
          <p className="mt-5 rounded-xl border border-accent/30 bg-accent/10 px-3 py-2 text-center text-xs text-accent">
            {brand.agentName} ענתה תוך שנייה · ליד נשמר
          </p>
        </div>
      </div>
    </div>
  );
}

export function Research() {
  return (
    <section aria-labelledby="research-title" className="container-page py-20 sm:py-28">
      <div className="grid grid-cols-1 gap-14 lg:grid-cols-[1.45fr_1fr] lg:items-center">
        <div>
          <div data-reveal>
            <Eyebrow>המחקר על מהירות תגובה</Eyebrow>
            <h2 id="research-title" className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl lg:leading-[1.08]">
              ליד שמחכה,
              <br />
              <span className="text-brand">הולך למתחרים.</span>
            </h2>
            <p className="mt-5 max-w-2xl text-pretty text-lg leading-relaxed text-ink-2">
              מחקר של Harvard Business Review ניתח כ-1.25 מיליון לידים. עסקים שחזרו לליד תוך שעה הגיעו לשיחה עם מקבל ההחלטה פי 7
              יותר מאלה שחזרו שעה אחר כך, ופי 60 יותר ממי שחיכה יום.
              <Sup n={1} /> כל דקה שעוברת, הלקוח כבר מדבר עם מישהו אחר.
            </p>
          </div>

          <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {headlineStats.map((s, i) => (
              <li
                key={s.value}
                data-reveal
                style={{ "--reveal-delay": `${i * 80}ms` } as React.CSSProperties}
                className="rounded-3xl border border-line bg-surface p-5 shadow-soft"
              >
                <p className="ltr text-start text-4xl font-extrabold tracking-tight text-ink">{s.value}</p>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">
                  {s.label}
                  <Sup n={s.source} />
                </p>
              </li>
            ))}
          </ul>

          <figure className="mt-3 rounded-3xl border border-line bg-surface p-5 shadow-soft sm:p-6" data-reveal>
            <figcaption>
              <p className="font-bold">
                ובפועל? החוקרים שלחו פנייה ל-2,241 חברות.
                <Sup n={1} />
              </p>
              <p className="mt-1 text-sm text-ink-3">זמן התגובה הממוצע, אצל מי שבכלל חזר: 42 שעות.</p>
            </figcaption>
            <div className="mt-5 space-y-3">
              <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3 sm:grid-cols-[8rem_1fr]">
                <span className="text-sm text-ink-2">חברות בארה״ב</span>
                <div className="flex h-9 overflow-hidden rounded-xl text-xs font-bold" role="img" aria-label="37% תוך שעה, 16% שעה עד יום, 24% יותר מיום, 23% לא חזרו בכלל">
                  {responseBuckets.map((b) => (
                    <span key={b.key} className={`grid place-items-center ${bucketStyle[b.key]}`} style={{ width: `${b.value}%` }}>
                      <span className="ltr">{b.value}%</span>
                    </span>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-[6.5rem_1fr] items-center gap-3 sm:grid-cols-[8rem_1fr]">
                <span className="text-sm font-bold text-ink">
                  עם <span dir="ltr">{brand.name}</span>
                </span>
                <div className="flex h-9 items-center justify-center rounded-xl bg-accent text-xs font-bold text-accent-ink">
                  100% תוך פחות מדקה, 24/7
                </div>
              </div>
            </div>
            <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-ink-3">
              {responseBuckets.map((b) => (
                <li key={b.key} className="flex items-center gap-1.5">
                  <span className={`size-2.5 rounded-sm ${bucketStyle[b.key]}`} aria-hidden="true" />
                  {b.label}
                </li>
              ))}
            </ul>
          </figure>

          <div className="mt-3 grid grid-cols-1 gap-3 rounded-3xl bg-forest p-6 text-on-forest dark:bg-forest-2 sm:grid-cols-[auto_1fr] sm:items-center sm:gap-6" data-reveal>
            <p className="text-5xl font-extrabold text-accent">
              6 <span className="text-2xl">דקות</span>
            </p>
            <p className="leading-relaxed text-on-forest-2">
              זה זמן ההמתנה המקסימלי שהחוק בישראל מתיר לספקי שירות גדולים עד למענה אנושי.
              <Sup n={3} /> לקוח שמתקשר לעסק קטן לא מחכה גם לזה.
            </p>
          </div>

          <p className="mt-6 text-lg font-bold" data-reveal>
            בשתיים בלילה, בשישי אחר הצהריים או באמצע יום עמוס: <span className="text-brand">כל ליד מקבל מענה תוך שניות.</span>
          </p>

          <details className="group mt-5 border-t border-line pt-4">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 text-sm font-semibold text-ink-2 hover:text-ink">
              מקורות ({sources.length})
              <ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <ol className="mt-3 space-y-2 text-sm leading-relaxed text-ink-3">
              {sources.map((s) => (
                <li key={s.id} id={`source-${s.id}`} className="flex gap-2">
                  <span className="font-semibold text-ink-2">{s.id}.</span>
                  <span>
                    {s.text}{" "}
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-brand underline underline-offset-2">
                        למקור
                      </a>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        </div>

        <NightCall />
      </div>
    </section>
  );
}
