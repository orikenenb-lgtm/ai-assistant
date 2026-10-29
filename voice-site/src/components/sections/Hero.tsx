import { CalendarCheck, Clock3, Code2, Database, MessageCircle, PhoneCall, Sparkles } from "lucide-react";
import { brand, plans, pricing } from "@/config/site";
import { formatIls } from "@/lib/format";
import { buttonClass } from "@/components/ui/Button";
import { GmailIcon, GoogleCalendarIcon, WhatsAppIcon } from "@/components/ui/BrandIcons";
import { LiveDemo } from "@/components/demo/LiveDemo";
import { StartDemoButton } from "@/components/demo/StartDemoButton";

const cheapest = Math.min(...plans.map((p) => p.price));

const chips = [
  { icon: Clock3, label: "מענה 24/7" },
  { icon: CalendarCheck, label: "תיאום תורים ופגישות" },
  { icon: Database, label: "עדכון כל המערכות" },
];

function FloatingCard({
  className,
  icon,
  title,
  body,
  delay,
}: {
  className: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  delay: string;
}) {
  return (
    <div
      className={`pointer-events-none absolute z-10 hidden w-52 animate-float rounded-2xl border border-line bg-surface/95 p-3 text-ink shadow-float backdrop-blur 2xl:block ${className}`}
      style={{ animationDelay: delay }}
      aria-hidden="true"
    >
      <div className="flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-tint">{icon}</span>
        <div className="min-w-0">
          <p className="text-sm font-bold">{title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{body}</p>
        </div>
      </div>
    </div>
  );
}

function HeroArt() {
  return (
    <svg className="pointer-events-none absolute inset-0 size-full opacity-60" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="hero-line" x1="0" x2="1">
          <stop offset="0" stopColor="#bfe08f" stopOpacity="0" />
          <stop offset="0.5" stopColor="#bfe08f" stopOpacity="0.35" />
          <stop offset="1" stopColor="#bfe08f" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0, 1, 2, 3, 4].map((i) => (
        <path
          key={i}
          d={`M-50 ${560 + i * 34} C 250 ${470 + i * 30}, 420 ${700 - i * 18}, 700 ${600 + i * 12} S 1100 ${470 + i * 26}, 1260 ${520 + i * 22}`}
          fill="none"
          stroke="url(#hero-line)"
          strokeWidth="1.2"
        />
      ))}
      <circle cx="1040" cy="120" r="220" fill="#bfe08f" opacity="0.05" />
    </svg>
  );
}

export function Hero() {
  return (
    <section aria-labelledby="hero-title" className="px-2 pt-2 sm:px-3 sm:pt-3">
      <div className="forest-panel on-forest relative overflow-hidden rounded-[2rem] sm:rounded-[2.5rem]">
        <HeroArt />
        <div className="container-page relative grid grid-cols-1 gap-12 pb-14 pt-28 sm:pb-20 sm:pt-32 lg:grid-cols-[1.08fr_1fr] lg:items-center lg:gap-10 lg:pb-24 lg:pt-36">
          <div>
            <ul className="flex flex-wrap gap-2" aria-label="יכולות עיקריות">
              {chips.map(({ icon: Icon, label }) => (
                <li
                  key={label}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/12 bg-white/5 px-3 py-1.5 text-sm text-on-forest-2"
                >
                  <Icon className="size-4 text-accent" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>

            <h1 id="hero-title" className="mt-6 text-balance text-[2.6rem] font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:text-[4.1rem]">
              הטלפון מצלצל.
              <br />
              <span className="text-accent">הנציגה כבר עונה.</span>
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-lg leading-relaxed text-on-forest-2 sm:text-xl">
              נציגת AI טלפונית בעברית טבעית, שעונה לכל שיחה, קובעת תורים ופגישות ומעדכנת את היומן, הוואטסאפ וה-CRM. מסביב
              לשעון, גם כשכל הצוות עסוק.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#contact" className={buttonClass("accent", "lg")}>
                <Sparkles className="size-5" aria-hidden="true" />
                בואו נקים לכם נציג
              </a>
              <StartDemoButton className={buttonClass("onForestOutline", "lg")}>
                <PhoneCall className="size-5" aria-hidden="true" />
                דברו איתה עכשיו
              </StartDemoButton>
            </div>

            <p className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-on-forest-2">
              <span>
                החל מ-<span className="ltr font-bold text-on-forest">{formatIls(cheapest)}</span> לחודש
              </span>
              <span aria-hidden="true" className="size-1 rounded-full bg-on-forest-2/60" />
              <span>{pricing.trialMinutes} דקות ניסיון חינם</span>
              <span aria-hidden="true" className="size-1 rounded-full bg-on-forest-2/60" />
              <span>בלי דמי הקמה</span>
            </p>

            <div className="mt-10">
              <p className="text-xs font-medium tracking-wide text-on-forest-2">מתחבר לכלים שכבר עובדים אצלכם</p>
              <ul className="mt-3 flex flex-wrap items-center gap-2.5" aria-label="חיבורים נתמכים">
                {[
                  { label: "WhatsApp", node: <WhatsAppIcon className="size-5 text-wa" /> },
                  { label: "יומן Google", node: <GoogleCalendarIcon className="size-5 text-[#4285F4]" /> },
                  { label: "Gmail", node: <GmailIcon className="size-5 text-[#EA4335]" /> },
                  { label: "CRM", node: <span className="text-[0.7rem] font-extrabold tracking-wide text-[#132019]">CRM</span> },
                  { label: "טלפוניה", node: <PhoneCall className="size-5 text-[#132019]" /> },
                  { label: "API", node: <Code2 className="size-5 text-[#132019]" /> },
                ].map((item) => (
                  <li key={item.label} title={item.label} className="grid size-11 place-items-center rounded-2xl bg-white shadow-soft">
                    {item.node}
                    <span className="sr-only">{item.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div id="demo" className="relative mx-auto w-full max-w-[27rem] scroll-mt-28 lg:me-auto lg:ms-0">
            <p className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-accent">
              <MessageCircle className="size-4" aria-hidden="true" />
              נסו אותה עכשיו, ישירות מהדפדפן
            </p>
            <LiveDemo />
            {/* What a call triggers: floating cards in the side margin on wide screens, a row of pills elsewhere */}
            <ul className="mt-3 flex flex-wrap gap-2 text-xs text-on-forest-2 2xl:hidden" aria-label="מה קורה אחרי שיחה">
              {[
                { icon: <CalendarCheck className="size-3.5 text-accent" />, t: "נקבע ביומן" },
                { icon: <WhatsAppIcon className="size-3.5 text-wa" />, t: "אישור בוואטסאפ" },
                { icon: <Database className="size-3.5 text-accent" />, t: "ליד ב-CRM" },
              ].map(({ icon, t }) => (
                <li key={t} className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-2.5 py-1">
                  {icon}
                  {t}
                </li>
              ))}
            </ul>
            <FloatingCard
              className="-end-[14.5rem] top-16"
              delay="0s"
              icon={<GoogleCalendarIcon className="size-4 text-[#4285F4]" />}
              title="נקבע ביומן"
              body="דנה כהן · רביעי 17:30"
            />
            <FloatingCard
              className="-end-[13rem] top-[45%]"
              delay="1.2s"
              icon={<WhatsAppIcon className="size-4 text-wa-dark" />}
              title="אישור נשלח בוואטסאפ"
              body="עם כתובת ולינק לאישור"
            />
            <FloatingCard
              className="-end-[14.5rem] bottom-6"
              delay="2.4s"
              icon={<Database className="size-4 text-brand" />}
              title="ליד חדש ב-CRM"
              body={`עם סיכום השיחה של ${brand.agentName}`}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
