"use client";

import {
  BookOpen,
  Brain,
  Check,
  CornerDownLeft,
  History,
  ListChecks,
  MessagesSquare,
  Plus,
  ThumbsDown,
  ThumbsUp,
  Volume2,
  Wrench,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { brand } from "@/config/site";
import { SectionHeading } from "@/components/ui/Section";
import { LogoMark } from "@/components/ui/Logo";

type TabId = "flow" | "knowledge" | "tools" | "memory" | "calls" | "voice";

const TABS: { id: TabId; label: string; icon: typeof Brain; title: string; body: string }[] = [
  { id: "flow", label: "השיחה", icon: ListChecks, title: "שלבי השיחה", body: "מהפתיחה ועד הסגירה. רואים כל שלב, ומשנים אותו במילים פשוטות." },
  { id: "knowledge", label: "ידע וכללים", icon: BookOpen, title: "ידע וכללים", body: "מחירים, שירותים ונהלים, והקווים האדומים שהנציגה לא חוצה." },
  { id: "tools", label: "כלים", icon: Wrench, title: "כלים וחיבורים", body: "מה הנציגה רשאית לעשות: לקבוע ביומן, לשלוח וואטסאפ, לשמור ליד, להעביר לנציג." },
  { id: "memory", label: "זיכרון", icon: Brain, title: "זיכרון לקוחות", body: "מה היא יודעת על כל מי שדיבר איתה, כשהוא מתקשר שוב. אפשר לתקן ולמחוק." },
  { id: "calls", label: "שיחות", icon: MessagesSquare, title: "שיחות ושיפור", body: "כל שיחה עם הקלטה, תמלול וסיכום. מסמנים מה עבד, והנציגה משתפרת." },
  { id: "voice", label: "קול", icon: Volume2, title: "קול ואופי", body: "בוחרים קול, קצב וסגנון, ותגובות קצרות כמו ״כן״ ו״אהה״ שנשמעות טבעיות." },
];

function Pill({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "ok" | "warn" | "off" }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.7rem] font-semibold",
        tone === "ok" && "bg-brand-soft text-brand",
        tone === "warn" && "bg-[#fdecc8] text-[#8a5a00] dark:bg-[#3a2c0b] dark:text-[#f5c766]",
        tone === "off" && "bg-surface-2 text-ink-3",
        tone === "muted" && "bg-surface-2 text-ink-2",
      )}
    >
      {children}
    </span>
  );
}

function Toggle({ on }: { on: boolean }) {
  return (
    <span aria-hidden="true" className={clsx("relative inline-block h-5 w-9 rounded-full transition-colors", on ? "bg-brand" : "bg-line-strong")}>
      <span className={clsx("absolute top-0.5 size-4 rounded-full bg-white shadow transition-all", on ? "start-[1.15rem]" : "start-0.5")} />
    </span>
  );
}

function FlowTab() {
  const steps = [
    {
      n: 1,
      title: "פתיחה ושם",
      desc: "מציגה את הקליניקה ושואלת איך קוראים ללקוח.",
      say: "״היי, הגעתם לקליניקה של ד״ר אלון, מדברת תמר. איך קוראים לך?״",
      branches: ["מבקשים לדבר עם פיזיותרפיסט", "כאב חריף או פציעה טרייה"],
    },
    { n: 2, title: "מה הלקוח צריך", desc: "אבחון, טיפול המשך או שיקום. שאלה אחת בכל פעם." },
    { n: 3, title: "תור ושליחת אישור", desc: "קובעת ביומן ושולחת טופס קליטה בוואטסאפ." },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_13rem]">
      <ol className="space-y-2">
        {steps.map((s, i) => (
          <li key={s.n}>
            <div className={clsx("rounded-2xl border p-4", i === 2 ? "border-dashed border-line-strong bg-surface/60" : "border-line bg-surface")}>
              <div className="flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full bg-surface-2 text-xs font-bold text-ink-2">{s.n}</span>
                <p className="font-bold">{s.title}</p>
              </div>
              <p className="mt-1 text-sm text-ink-2">{s.desc}</p>
              {s.say ? (
                <div className="mt-3 rounded-xl bg-surface-2 p-3">
                  <p className="text-[0.7rem] font-semibold text-ink-3">אומרת</p>
                  <p className="mt-0.5 text-sm">{s.say}</p>
                </div>
              ) : null}
              {s.branches ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.branches.map((b) => (
                    <span key={b} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-1 text-xs text-ink-2">
                      <CornerDownLeft className="size-3" aria-hidden="true" /> אם {b}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            {i < steps.length - 1 ? (
              <span className="mx-auto my-1 grid size-6 place-items-center rounded-full border border-line bg-surface text-ink-3" aria-hidden="true">
                <Plus className="size-3" />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-bold">כלים בשלב הזה</p>
        <ul className="mt-3 space-y-2 text-sm">
          {["קליטת פרטים מדויקת", "שמירת ליד", "לינק בוואטסאפ", "קביעה ביומן"].map((t) => (
            <li key={t} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-1.5">
              <span className="grid size-4 place-items-center rounded bg-brand text-brand-ink">
                <Check className="size-3" aria-hidden="true" />
              </span>
              {t}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function KnowledgeTab() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-bold">בנק ידע</p>
        <ul className="mt-3 divide-y divide-line text-sm">
          {[
            ["אבחון וטיפול ראשון", "₪320 · 60 דק׳"],
            ["טיפול המשך", "₪260 · 45 דק׳"],
            ["החזר מביטוח משלים", "לפי הפוליסה, קבלה נשלחת במייל"],
            ["ביטול תור", "עד 24 שעות מראש, בלי חיוב"],
          ].map(([k, v]) => (
            <li key={k} className="flex justify-between gap-3 py-2.5">
              <span className="text-ink-2">{k}</span>
              <span className="text-end font-semibold">{v}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-bold">כללים</p>
        <ul className="mt-3 space-y-2 text-sm">
          {[
            { tone: "ok" as const, tag: "תמיד", t: "לחזור על הפרטים לפני שקובעים תור" },
            { tone: "warn" as const, tag: "אסור", t: "לתת אבחנה רפואית או להמליץ על תרופות" },
            { tone: "warn" as const, tag: "אסור", t: "להבטיח הנחה שלא מופיעה במחירון" },
            { tone: "muted" as const, tag: "להעביר", t: "כאב חריף, תלונה או בקשה מפורשת לנציג" },
          ].map(({ tone, tag, t }) => (
            <li key={t} className="flex items-start gap-2">
              <Pill tone={tone}>{tag}</Pill>
              <span className="leading-relaxed">{t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ToolsTab() {
  const tools = [
    { t: "קביעה ושינוי תורים ביומן Google", on: true },
    { t: "שליחת אישורים ותזכורות בוואטסאפ", on: true },
    { t: "שמירת ליד ועדכון סטטוס ב-CRM", on: true },
    { t: "העברת שיחה לנציג אנושי", on: true },
    { t: "סיכום שיחה למייל הצוות", on: true },
    { t: "שליחת לינק לתשלום מקדמה", on: false },
  ];
  return (
    <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {tools.map(({ t, on }) => (
        <li key={t} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          <span className={clsx(!on && "text-ink-3")}>{t}</span>
          <Toggle on={on} />
        </li>
      ))}
    </ul>
  );
}

function MemoryTab() {
  const people = [
    { n: "דנה כהן", facts: ["מטופלת קבועה, ברך שמאל", "מעדיפה תורים בערב", "שילמה דרך ביטוח משלים"], last: "לפני 3 ימים" },
    { n: "אבי מזרחי", facts: ["ליד חדש מגוגל", "שאל על שיקום אחרי ניתוח כתף"], last: "אתמול" },
  ];
  return (
    <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {people.map((p) => (
        <li key={p.n} className="rounded-2xl border border-line bg-surface p-4">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">{p.n[0]}</span>
            <p className="flex-1 font-bold">{p.n}</p>
            <span className="text-xs text-ink-3">{p.last}</span>
          </div>
          <ul className="mt-3 space-y-1.5 text-sm text-ink-2">
            {p.facts.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <History className="size-3.5 shrink-0 text-ink-3" aria-hidden="true" /> {f}
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function CallsTab() {
  const calls = [
    { n: "דנה כהן", r: "נקבע תור", tone: "ok" as const, d: "2:14" },
    { n: "יוסי לוי", r: "שאלה על מחיר", tone: "muted" as const, d: "1:02" },
    { n: "מיכל אברהם", r: "הועבר לצוות", tone: "warn" as const, d: "3:40" },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[14rem_1fr]">
      <ul className="space-y-1.5">
        {calls.map((c, i) => (
          <li key={c.n} className={clsx("flex items-center gap-2 rounded-xl px-3 py-2 text-sm", i === 0 ? "bg-surface ring-1 ring-line" : "")}>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{c.n}</span>
              <Pill tone={c.tone}>{c.r}</Pill>
            </span>
            <span className="ltr tabular text-xs text-ink-3">{c.d}</span>
          </li>
        ))}
      </ul>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm font-bold">סיכום שיחה · דנה כהן</p>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">
          מטופלת קבועה ביקשה להקדים את טיפול ההמשך. נקבע תור לרביעי 17:30, נשלח אישור בוואטסאפ. ציינה שהכאב בברך פחת.
        </p>
        <div className="mt-3 space-y-1.5 rounded-xl bg-surface-2 p-3 text-sm">
          <p>
            <span className="font-semibold text-ink-3">דנה: </span>אפשר להקדים את הטיפול לרביעי?
          </p>
          <p>
            <span className="font-semibold text-brand">תמר: </span>בטח, יש ב-17:30. לקבוע?
          </p>
        </div>
        <div className="mt-3 flex items-center gap-3 text-xs text-ink-3">
          <span>איך היא הייתה?</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-1 text-brand">
            <ThumbsUp className="size-3.5" aria-hidden="true" /> מצוין
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
            <ThumbsDown className="size-3.5" aria-hidden="true" /> לשפר
          </span>
        </div>
      </div>
    </div>
  );
}

function VoiceTab() {
  const voices = [
    { n: "תמר", d: "חמה ורגועה", on: true },
    { n: "דניאל", d: "עניינית ומקצועית", on: false },
    { n: "מאיה", d: "צעירה ואנרגטית", on: false },
  ];
  return (
    <div className="space-y-4">
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {voices.map((v) => (
          <li key={v.n} className={clsx("rounded-2xl border bg-surface p-4", v.on ? "border-brand ring-1 ring-brand" : "border-line")}>
            <div className="flex items-center justify-between">
              <p className="font-bold">{v.n}</p>
              {v.on ? <Pill tone="ok">נבחר</Pill> : null}
            </div>
            <p className="mt-1 text-sm text-ink-2">{v.d}</p>
            <div className="mt-3 flex h-6 items-center gap-[3px]" aria-hidden="true">
              {[0.4, 0.9, 0.6, 1, 0.5, 0.8, 0.35, 0.7, 0.55, 0.9, 0.45].map((h, i) => (
                <span key={i} className="w-[3px] rounded-full bg-brand/70" style={{ height: `${h * 100}%` }} />
              ))}
            </div>
          </li>
        ))}
      </ul>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <li className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          תגובות קצרות (״כן״, ״אהה״, ״רגע, בודקת״) <Toggle on />
        </li>
        <li className="flex items-center justify-between rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
          רעשי רקע עדינים של משרד <Toggle on={false} />
        </li>
      </ul>
    </div>
  );
}

const PANELS: Record<TabId, () => ReactNode> = {
  flow: FlowTab,
  knowledge: KnowledgeTab,
  tools: ToolsTab,
  memory: MemoryTab,
  calls: CallsTab,
  voice: VoiceTab,
};

export function Dashboard() {
  const [tab, setTab] = useState<TabId>("flow");
  const Panel = PANELS[tab];

  return (
    <section aria-labelledby="dashboard-title" className="container-page py-20 sm:py-28">
      <SectionHeading
        id="dashboard-title"
        eyebrow="ממשק ניהול"
        title={
          <>
            ממשק ניהול משלכם,
            <br />
            שרץ על השרתים שלנו.
          </>
        }
        lead="לא מתקינים כלום ולא צריך שרת. נכנסים מהדפדפן, ורואים ומשנים כל מה שהנציגה אומרת ועושה. התשתית, התחזוקה והעדכונים עלינו."
      />

      <div className="mt-12 overflow-hidden rounded-[1.75rem] border border-line bg-bg-soft shadow-float" data-reveal>
        <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-3">
          <span className="flex gap-1.5" aria-hidden="true">
            <span className="size-3 rounded-full bg-[#ff5f57]" />
            <span className="size-3 rounded-full bg-[#febc2e]" />
            <span className="size-3 rounded-full bg-[#28c840]" />
          </span>
          <span className="mx-auto rounded-lg bg-surface-2 px-4 py-1 text-xs text-ink-3">ממשק הניהול · הסוכנים שלי</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-[11rem_1fr]">
          <aside className="hidden border-e border-line bg-surface p-3 md:block" aria-hidden="true">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <LogoMark className="size-6 text-forest dark:text-forest-3" />
              <span dir="ltr" className="text-sm font-extrabold">
                {brand.name}
              </span>
            </div>
            <ul className="mt-4 space-y-1 text-sm">
              {["הסוכנים שלי", "שיחות", "דוחות", "חשבון"].map((t, i) => (
                <li key={t} className={clsx("rounded-lg px-2.5 py-2", i === 0 ? "bg-surface-2 font-semibold" : "text-ink-2")}>
                  {t}
                </li>
              ))}
            </ul>
          </aside>
          <div className="min-w-0 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-bold">תמר · קליניקת פיזיו ד״ר אלון</p>
              <Pill tone="ok">
                <span className="size-1.5 rounded-full bg-current" /> פעילה
              </Pill>
            </div>
            <div role="tablist" aria-label="אזורי הממשק" className="no-scrollbar mt-4 flex gap-1 overflow-x-auto border-b border-line">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  id={`dash-tab-${t.id}`}
                  aria-selected={tab === t.id}
                  aria-controls="dash-panel"
                  tabIndex={tab === t.id ? 0 : -1}
                  onClick={() => setTab(t.id)}
                  onKeyDown={(e) => {
                    // RTL: ArrowLeft moves forward.
                    const i = TABS.findIndex((x) => x.id === t.id);
                    const delta = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
                    if (!delta) return;
                    e.preventDefault();
                    const next = TABS[(i + delta + TABS.length) % TABS.length];
                    setTab(next.id);
                    document.getElementById(`dash-tab-${next.id}`)?.focus();
                  }}
                  className={clsx(
                    "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
                    tab === t.id ? "border-brand text-ink" : "border-transparent text-ink-3 hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div id="dash-panel" role="tabpanel" aria-labelledby={`dash-tab-${tab}`} className="mt-4 min-h-[22rem]">
              <div key={tab} className="animate-in">
                <Panel />
              </div>
            </div>
          </div>
        </div>
        <p className="border-t border-line bg-surface px-4 py-2 text-xs text-ink-3">המחשה של ממשק הניהול. השמות והתוכן לדוגמה.</p>
      </div>

      <ul className="mt-6 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {TABS.map((t) => {
          const Icon = t.icon;
          const selected = tab === t.id;
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setTab(t.id)}
                aria-pressed={selected}
                className={clsx(
                  "flex w-full gap-3 rounded-2xl border-t p-4 text-start transition-colors",
                  selected ? "border-brand bg-surface shadow-soft" : "border-line hover:bg-surface/60",
                )}
              >
                <Icon className={clsx("mt-0.5 size-5 shrink-0", selected ? "text-brand" : "text-ink-3")} aria-hidden="true" />
                <span>
                  <span className="block font-bold">{t.title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-ink-2">{t.body}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
