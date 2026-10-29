"use client";

import { CalendarCheck, Check, Database, FileText, Lock, MapPin, MessageSquareText, PhoneIncoming, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { clsx } from "clsx";
import type { Line } from "@/content/industries";
import { trust } from "@/config/site";
import { SectionHeading } from "@/components/ui/Section";
import { PlayButton, TranscriptLines } from "@/components/demo/Transcript";
import { useConversationPlayer } from "@/components/demo/useConversationPlayer";

const LINES: Line[] = [
  { who: "customer", text: "היי, ראיתי שיש לכם שיעור ניסיון. אפשר להגיע השבוע?" },
  { who: "agent", text: "בטח! יש שיעור מתחילות ביום שלישי ב-19:00, או ביום חמישי ב-8:30. מה מתאים לך?" },
  { who: "customer", text: "שלישי בערב. אני מיכל לוי." },
  { who: "agent", text: "מעולה מיכל, שמרתי לך מקום בשלישי ב-19:00. שלחתי לך בוואטסאפ את הכתובת ומה להביא. נתראה!" },
];

const STEPS = [
  { afterLine: 2, icon: CalendarCheck, label: "נבדקה זמינות ביומן הסטודיו" },
  { afterLine: 4, icon: Check, label: "נשמר מקום: שלישי 19:00, שיעור ניסיון" },
  { afterLine: 4, icon: Database, label: "ליד חדש נוצר ב-CRM: מיכל לוי" },
  { afterLine: 4, icon: MessageSquareText, label: "נשלח אישור בוואטסאפ עם כתובת והנחיות" },
  { afterLine: 4, icon: FileText, label: "סיכום ותמלול נשמרו בממשק" },
];

const TRUST = [
  { icon: PhoneIncoming, label: "מספר טלפון ישראלי ייעודי לעסק" },
  { icon: Lock, label: `שרתים ב${trust.dataRegion}` },
  { icon: SlidersHorizontal, label: "אתם קובעים מה מותר לה להגיד ומתי להעביר אליכם" },
  { icon: ShieldCheck, label: "תמלול וסיכום לכל שיחה" },
];

export function CallOutcome() {
  const player = useConversationPlayer(LINES);
  const done = (afterLine: number) => player.visible >= afterLine;

  return (
    <section id="how" aria-labelledby="outcome-title" className="container-page scroll-mt-24 py-20 sm:py-28">
      <SectionHeading
        id="outcome-title"
        eyebrow="שיחה אחת, הרבה פעולות"
        title="מה יוצא משיחה אחת."
        lead="לא רק נציגה שמדברת יפה. כל שיחה נגמרת בפעולה: מקום ביומן, ליד במערכת ואישור ללקוח. בזמן שאתם עובדים."
      />

      <div className="mt-12 overflow-hidden rounded-[2rem] border border-line bg-surface shadow-card" data-reveal>
        <div className="grid grid-cols-1 lg:grid-cols-[1.35fr_1fr]">
          <div className="p-5 sm:p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-lg font-bold">שיחת הדגמה: שיעור ניסיון בסטודיו לפילאטיס</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-3">
                  <MapPin className="size-3.5" aria-hidden="true" /> תרחיש לדוגמה, לא שיחת לקוח אמיתית
                </p>
              </div>
              <div className="flex gap-2 text-xs font-semibold">
                <span className="rounded-full bg-tint px-2.5 py-1 text-brand">לקוחה חדשה</span>
                <span className={clsx("rounded-full px-2.5 py-1 transition-colors", done(4) ? "bg-brand text-brand-ink" : "bg-surface-2 text-ink-3")}>
                  {done(4) ? "טופל" : "בטיפול"}
                </span>
              </div>
            </div>

            <div className="mt-5">
              <PlayButton playing={player.playing} elapsed={player.elapsed} lines={LINES} onPlay={player.play} onStop={player.stop} />
            </div>

            <div className="mt-6 min-h-[19rem]">
              <TranscriptLines lines={LINES} visible={player.visible} customerLabel="לקוחה" />
            </div>
          </div>

          <div className="forest-panel on-forest p-5 sm:p-8">
            <p className="font-bold">מה קרה במערכות</p>
            <p className="mt-1 text-sm text-on-forest-2">בזמן השיחה ומיד אחריה, בלי שאף אחד נגע במקלדת.</p>
            <ol className="relative mt-6 space-y-4">
              <span aria-hidden="true" className="absolute inset-y-3 start-[1.05rem] w-px bg-white/10" />
              {STEPS.map(({ afterLine, icon: Icon, label }, i) => {
                const isDone = done(afterLine);
                return (
                  <li key={label} className="relative flex items-center gap-3">
                    <span
                      className={clsx(
                        "relative grid size-[2.1rem] shrink-0 place-items-center rounded-full border transition-all duration-500",
                        isDone ? "border-accent bg-accent text-accent-ink" : "border-white/15 bg-forest-2 text-on-forest-2",
                      )}
                      style={{ transitionDelay: isDone ? `${i * 120}ms` : "0ms" }}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                    </span>
                    <span className={clsx("transition-opacity duration-500", isDone ? "opacity-100" : "opacity-45")}>
                      {label}
                      <span className="sr-only">{isDone ? " (בוצע)" : " (ממתין)"}</span>
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className={clsx("mt-8 rounded-2xl border border-white/10 bg-white/5 p-4 transition-opacity duration-500", done(4) ? "opacity-100" : "opacity-40")}>
              <p className="text-xs font-semibold text-accent">סיכום אוטומטי</p>
              <p className="mt-1.5 text-sm leading-relaxed text-on-forest-2">
                לקוחה חדשה, מיכל לוי. מתעניינת בשיעור ניסיון למתחילות, נרשמה לשלישי 19:00. מומלץ להציע כרטיסייה אחרי השיעור.
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-3xl border border-line bg-surface-2/60 p-4 sm:px-6" data-reveal>
        <ul className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm text-ink-2">
          <li className="font-bold text-ink">למה אפשר לסמוך עליה:</li>
          {TRUST.map(({ icon: Icon, label }) => (
            <li key={label} className="flex items-center gap-1.5">
              <Icon className="size-4 text-brand" aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
