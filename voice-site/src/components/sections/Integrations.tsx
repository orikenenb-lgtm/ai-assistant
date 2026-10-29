import { AudioLines, CalendarClock, Code2, Database, PhoneCall, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { SectionHeading } from "@/components/ui/Section";
import { GmailIcon, GoogleCalendarIcon, WhatsAppIcon } from "@/components/ui/BrandIcons";

type Item = { title: string; body: string; icon: ReactNode };

const items: Item[] = [
  { title: "יומן Google", body: "קובעת, מזיזה ומבטלת תורים ופגישות", icon: <GoogleCalendarIcon className="size-5 text-[#4285F4]" /> },
  { title: "WhatsApp", body: "אישורים, תזכורות ולינקים ללקוח", icon: <WhatsAppIcon className="size-5 text-wa-dark" /> },
  { title: "מייל", body: "סיכום שיחה ופרטי ליד לתיבה שלכם", icon: <GmailIcon className="size-5 text-[#EA4335]" /> },
  { title: "CRM", body: "ליד חדש, סטטוס והערות מהשיחה", icon: <Database className="size-5 text-brand" /> },
  { title: "זימון תורים", body: "מערכת התורים שאתם כבר עובדים איתה", icon: <CalendarClock className="size-5 text-brand" /> },
  { title: "טלפוניה", body: "מספר ישראלי, שיחות נכנסות ויוצאות", icon: <PhoneCall className="size-5 text-brand" /> },
  { title: "API ו-Webhooks", body: "לכל מערכת שמקבלת קריאה מבחוץ", icon: <Code2 className="size-5 text-brand" /> },
  { title: "ועוד לפי העסק", body: "מחברים את מה שאתם צריכים", icon: <Plus className="size-5 text-brand" /> },
];

function Tile({ item }: { item: Item }) {
  return (
    <li className="relative z-10 flex h-full flex-col rounded-3xl border border-line bg-surface p-4 shadow-soft transition-shadow hover:shadow-card sm:p-5 lg:p-6">
      <span className="grid size-10 place-items-center rounded-2xl border border-line bg-surface-2 sm:size-11">{item.icon}</span>
      <p className="mt-3 font-bold sm:mt-4">{item.title}</p>
      <p className="mt-1 text-[0.82rem] leading-relaxed text-ink-2 sm:text-sm">{item.body}</p>
    </li>
  );
}

function Hub() {
  return (
    <div className="relative z-10 flex h-full flex-col items-center justify-center rounded-3xl bg-forest p-6 text-center text-on-forest shadow-float dark:bg-forest-3">
      <span className="relative grid size-14 place-items-center rounded-full bg-accent text-accent-ink">
        <span className="absolute inset-0 rounded-full bg-accent/40 animate-pulse-ring" aria-hidden="true" />
        <AudioLines className="relative size-6" aria-hidden="true" />
      </span>
      <p className="mt-3 text-lg font-bold">הנציגה שלכם</p>
      <p className="text-sm text-on-forest-2">בשיחה, ואחריה</p>
    </div>
  );
}

/** Centers of the 3×3 grid cells, in percent, for the connector lines. */
const CELL = [16.67, 50, 83.33];

export function Integrations() {
  // Grid order (RTL): the hub takes the middle cell.
  const cells = [...items.slice(0, 4), null, ...items.slice(4)];
  return (
    <section aria-labelledby="integrations-title" className="container-page py-20 sm:py-28">
      <SectionHeading
        id="integrations-title"
        eyebrow="חיבורים"
        title="מתחברת למה שכבר עובד אצלכם."
        lead="הנציגה לא נשארת בשיחה: היא קובעת, שולחת ומעדכנת במערכות שלכם, בזמן השיחה ואחריה. את החיבורים אנחנו מקימים."
      />

      <div className="relative mx-auto mt-12 max-w-5xl" data-reveal>
        <svg className="pointer-events-none absolute inset-0 hidden size-full lg:block" aria-hidden="true">
          {CELL.flatMap((y) =>
            CELL.map((x) =>
              x === 50 && y === 50 ? null : (
                <line key={`${x}-${y}`} x1={`${x}%`} y1={`${y}%`} x2="50%" y2="50%" stroke="var(--line-strong)" strokeWidth="1.5" strokeDasharray="4 6" />
              ),
            ),
          )}
        </svg>
        <ul className="relative grid grid-cols-2 gap-3 lg:grid-cols-3 lg:gap-6">
          {cells.map((item) =>
            item ? (
              <Tile key={item.title} item={item} />
            ) : (
              <li key="hub" className="order-first col-span-2 lg:order-none lg:col-span-1">
                <Hub />
              </li>
            ),
          )}
        </ul>
      </div>
    </section>
  );
}
