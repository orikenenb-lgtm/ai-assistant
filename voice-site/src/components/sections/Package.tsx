import { BookOpen, Check, CircleUserRound, Database, Hash, LayoutDashboard, MessageSquareQuote, PhoneCall, Workflow, X } from "lucide-react";
import type { ReactNode } from "react";
import { clsx } from "clsx";
import { SectionHeading } from "@/components/ui/Section";
import { GmailIcon, GoogleCalendarIcon, WhatsAppIcon } from "@/components/ui/BrandIcons";

function Card({
  title,
  body,
  icon,
  className,
  children,
  dark,
  delay = 0,
}: {
  title: string;
  body?: string;
  icon: ReactNode;
  className?: string;
  children?: ReactNode;
  dark?: boolean;
  delay?: number;
}) {
  return (
    <li
      data-reveal
      style={{ "--reveal-delay": `${delay}ms` } as React.CSSProperties}
      className={clsx(
        "flex flex-col overflow-hidden rounded-[1.75rem] p-5 sm:p-6",
        dark ? "forest-panel on-forest" : "border border-line bg-surface shadow-soft",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className={clsx("grid size-10 shrink-0 place-items-center rounded-2xl", dark ? "bg-white/10 text-accent" : "bg-tint text-brand")}>
          {icon}
        </span>
        <div>
          <h3 className="text-lg font-bold leading-snug">{title}</h3>
          {body ? <p className={clsx("mt-1 text-[0.95rem] leading-relaxed", dark ? "text-on-forest-2" : "text-ink-2")}>{body}</p> : null}
        </div>
      </div>
      {children ? <div className="mt-5 flex-1">{children}</div> : null}
    </li>
  );
}

export function Package() {
  return (
    <section aria-labelledby="package-title" className="container-page py-20 sm:py-28">
      <SectionHeading
        id="package-title"
        eyebrow="מה מקבלים"
        title="כל מה שצריך, בחבילה אחת."
        lead="לא עוד מספר טלפון. נציגה שבנויה סביב העסק שלכם, מחוברת לכלים שלכם, עם ממשק שבו אתם רואים ומשנים הכול."
      />

      <ul className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-6">
        <Card
          dark
          className="md:col-span-3 md:row-span-2"
          icon={<CircleUserRound className="size-5" />}
          title="נציגה מותאמת אישית לעסק"
          body="מדברת בשם העסק ובסגנון שלכם, ויודעת בדיוק מה מותר לה להבטיח ומתי להעביר אליכם."
        >
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-3">
              <span className="grid size-11 place-items-center rounded-full bg-accent text-lg font-extrabold text-accent-ink">ת</span>
              <div>
                <p className="font-bold">תמר</p>
                <p className="text-sm text-on-forest-2">הנציגה של קליניקת פיזיו ד״ר אלון</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
              {["חמה", "עניינית", "עברית ואנגלית", "קול נשי רגוע"].map((t) => (
                <span key={t} className="rounded-full bg-white/10 px-2.5 py-1">
                  {t}
                </span>
              ))}
            </div>
            <ul className="mt-4 space-y-2 text-sm">
              {[
                { ok: true, t: "קובעת ומזיזה תורים לפי היומן" },
                { ok: true, t: "שולחת טופס קליטה בוואטסאפ" },
                { ok: false, t: "לא נותנת אבחנה רפואית" },
                { ok: true, t: "כאב חריף? מעבירה מיד לפיזיותרפיסט התורן" },
              ].map(({ ok, t }) => (
                <li key={t} className="flex items-center gap-2">
                  {ok ? <Check className="size-4 shrink-0 text-accent" /> : <X className="size-4 shrink-0 text-[#fca5a5]" />}
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </Card>

        <Card
          className="md:col-span-3"
          icon={<BookOpen className="size-5" />}
          title="בנק ידע על העסק"
          body="מחירים, שירותים, שעות ונהלים. מה שהיא יודעת, היא עונה בדיוק."
        >
          <dl className="divide-y divide-line rounded-2xl border border-line text-sm">
            {[
              ["אבחון וטיפול ראשון", "₪320"],
              ["טיפול המשך", "₪260"],
              ["שעות פעילות", "א׳–ה׳ 7:30–20:00"],
              ["חניה", "חינם בחניון הבניין"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <dt className="text-ink-2">{k}</dt>
                <dd className="font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card className="md:col-span-3" icon={<MessageSquareQuote className="size-5" />} title="תסריטים ומענה להתנגדויות" body="אתם מלמדים אותה איך לסגור. היא לא שוכחת אף פעם.">
          <div className="space-y-2 text-sm">
            <p className="w-fit rounded-2xl rounded-ss-md border border-line bg-surface-2 px-3 py-2">״זה יקר לי…״</p>
            <p className="ms-auto w-fit max-w-[90%] rounded-2xl rounded-se-md bg-forest px-3 py-2 text-on-forest dark:bg-forest-3">
              מבינה לגמרי. אפשר לחלק לשלושה תשלומים, והאבחון הראשון בלי התחייבות. לקבוע?
            </p>
          </div>
        </Card>

        <Card className="md:col-span-2" icon={<Hash className="size-5" />} title="מספר ישראלי ייעודי" body="שיחות נכנסות ויוצאות, או הפניה מהמספר הקיים שלכם.">
          <p className="ltr tabular rounded-2xl bg-tint px-4 py-3 text-center text-2xl font-extrabold tracking-wider text-brand">07X-XXX-XXXX</p>
        </Card>

        <Card className="md:col-span-2" icon={<LayoutDashboard className="size-5" />} title="ממשק ניהול לשיחות" body="רץ על השרתים שלנו. נכנסים מהדפדפן.">
          <ul className="space-y-1.5 text-sm">
            {[
              ["דנה כהן", "נקבע תור", "2:14"],
              ["יוסי לוי", "שאלה על מחיר", "1:02"],
              ["מיכל אברהם", "הועבר לצוות", "3:40"],
            ].map(([n, r, d]) => (
              <li key={n} className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2">
                <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">{n[0]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{n}</span>
                  <span className="block text-xs text-ink-3">{r}</span>
                </span>
                <span className="ltr tabular text-xs text-ink-3">{d}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="md:col-span-2" icon={<Workflow className="size-5" />} title="אוטומציות אחרי השיחה" body="השיחה נגמרת, העבודה ממשיכה לבד.">
          <ol className="relative space-y-1.5 text-sm">
            <span aria-hidden="true" className="absolute inset-y-3 start-3.5 w-px bg-line-strong" />
            {[
              { icon: <PhoneCall className="size-3.5" />, t: "השיחה הסתיימה" },
              { icon: <WhatsAppIcon className="size-3.5 text-wa-dark" />, t: "אישור ותזכורת בוואטסאפ" },
              { icon: <Database className="size-3.5" />, t: "עדכון ליד ב-CRM" },
              { icon: <GmailIcon className="size-3.5 text-[#EA4335]" />, t: "סיכום למייל של הצוות" },
            ].map(({ icon, t }, i, arr) => (
              <li key={t} className="flex items-center gap-2">
                <span className="relative grid size-7 place-items-center rounded-lg border border-line bg-surface">{icon}</span>
                <span className={clsx(i === arr.length - 1 ? "font-semibold" : "")}>{t}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card
          className="md:col-span-6"
          icon={<GoogleCalendarIcon className="size-5 text-[#4285F4]" />}
          title="מחוברת לכלים ולמערכות שכבר יש לכם"
          body="יומן Google, וואטסאפ, מייל, CRM ומערכות זימון תורים. את החיבורים אנחנו מקימים, אתם רק רואים את התוצאות."
        >
          <ul className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            {[
              { t: "נקבע ביומן: דנה כהן, רביעי 17:30", ago: "לפני 2 דק׳" },
              { t: "נשלח אישור בוואטסאפ", ago: "לפני 2 דק׳" },
              { t: "ליד חדש עודכן ב-CRM", ago: "לפני דקה" },
            ].map(({ t, ago }) => (
              <li key={t} className="flex items-center gap-2 rounded-xl border border-line bg-surface-2/60 px-3 py-2.5">
                <Check className="size-4 shrink-0 text-brand" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{t}</span>
                <span className="shrink-0 text-xs text-ink-3">{ago}</span>
              </li>
            ))}
          </ul>
        </Card>
      </ul>
    </section>
  );
}
