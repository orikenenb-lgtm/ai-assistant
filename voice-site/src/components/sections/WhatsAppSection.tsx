import { BrainCircuit, Camera, CheckCheck, ChevronRight, Mic, Paperclip, Phone, ShieldCheck, Video, Workflow } from "lucide-react";
import { brand, plans, pricing, whatsappLink } from "@/config/site";
import { formatIls } from "@/lib/format";
import { Eyebrow } from "@/components/ui/Section";
import { WhatsAppIcon } from "@/components/ui/BrandIcons";
import { buttonClass } from "@/components/ui/Button";

const features = [
  {
    icon: ShieldCheck,
    title: "וואטסאפ רשמי, על המספר שלכם",
    body: "חיבור דרך ה-API הרשמי של Meta: על המספר הישראלי של הנציגה, או על מספר הוואטסאפ העסקי שכבר יש לכם.",
  },
  {
    icon: BrainCircuit,
    title: "קול וצ׳אט, מוח אחד",
    body: "לקוח שהתקשר אתמול וכותב היום ממשיך מאותה נקודה. היא זוכרת מה נאמר ולא שואלת שוב.",
  },
  {
    icon: Workflow,
    title: "אוטומציות שעובדות לבד",
    body: "אישור אחרי שיחה, תזכורת יום לפני, לינק לטופס או לתשלום, ומעקב אחרי ליד שלא ענה.",
  },
];

type Bubble = { side: "in" | "out"; text: string; time: string; tag?: string };

const chat: { day: string; bubbles: Bubble[] }[] = [
  {
    day: "אתמול",
    bubbles: [
      { side: "out", text: "שיחה קולית · 2 דק׳", time: "17:28", tag: "call" },
      { side: "out", text: "היי דנה, כמו שסיכמנו בטלפון: הלבנה ביום רביעי ב-17:30. לאישור הגעה לחצי כאן ›", time: "17:32" },
      { side: "in", text: "אפשר להזיז לשש?", time: "17:40" },
      { side: "out", text: "כן, הזזתי ל-18:00. נתראה ברביעי 🙂", time: "17:40" },
    ],
  },
  {
    day: "היום",
    bubbles: [{ side: "out", text: "תזכורת: מחר ב-18:00 הלבנה במרפאת ד״ר לוי. להזזה פשוט עני כאן.", time: "10:00" }],
  },
];

function PhoneMock() {
  return (
    <div className="mx-auto w-full max-w-[20rem]" data-reveal>
      <div className="rounded-[2.75rem] border-[10px] border-[#101611] bg-[#101611] shadow-float">
        <div className="overflow-hidden rounded-[2.1rem] bg-[#efe7dd]">
          <div className="flex items-center gap-2 bg-[#0f5c4c] px-3 pb-3 pt-4 text-white">
            <ChevronRight className="size-5" aria-hidden="true" />
            <span className="grid size-9 place-items-center rounded-full bg-white/20 text-sm font-bold">ל</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">מרפאת ד״ר לוי</p>
              <p className="text-[0.7rem] text-white/75">חשבון עסקי</p>
            </div>
            <Video className="size-4" aria-hidden="true" />
            <Phone className="size-4" aria-hidden="true" />
          </div>
          <div className="space-y-2 px-3 py-4 text-[0.8rem] leading-relaxed text-[#111b21]">
            {chat.map((group) => (
              <div key={group.day} className="space-y-2">
                <p className="mx-auto w-fit rounded-lg bg-white/90 px-2.5 py-0.5 text-[0.7rem] text-[#54656f] shadow-sm">
                  {group.day}
                </p>
                {group.bubbles.map((b, i) => (
                  <div key={i} className={b.side === "out" ? "flex justify-start" : "flex justify-end"}>
                    <div
                      className={`max-w-[85%] rounded-xl px-2.5 py-1.5 shadow-sm ${
                        b.side === "out" ? "rounded-ss-sm bg-white" : "rounded-se-sm bg-[#d9fdd3]"
                      }`}
                    >
                      {b.tag === "call" ? (
                        <p className="flex items-center gap-1.5 font-medium">
                          <Phone className="size-3.5 text-wa-dark" aria-hidden="true" /> {b.text}
                        </p>
                      ) : (
                        <p>{b.text}</p>
                      )}
                      <p className="mt-0.5 flex items-center justify-end gap-1 text-[0.65rem] text-[#4d5e66]">
                        <span className="ltr">{b.time}</span>
                        {b.side === "in" ? <CheckCheck className="size-3 text-[#53bdeb]" aria-hidden="true" /> : null}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 px-2 pb-3">
            <div className="flex h-9 flex-1 items-center gap-2 rounded-full bg-white px-3 text-[0.75rem] text-[#667781]">
              <span className="flex-1">הודעה</span>
              <Paperclip className="size-3.5" aria-hidden="true" />
              <Camera className="size-3.5" aria-hidden="true" />
            </div>
            <span className="grid size-9 place-items-center rounded-full bg-wa-dark text-white">
              <Mic className="size-4" aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function WhatsAppSection() {
  const includedIn = plans.filter((p) => p.whatsapp).map((p) => p.name);
  const link = whatsappLink(`היי ${brand.name}, אשמח לשמוע על נציגה בוואטסאפ לעסק שלי`);
  return (
    <section aria-labelledby="wa-title" className="container-page py-20 sm:py-28">
      <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div data-reveal>
            <Eyebrow className="text-wa-ink">
              <span className="sr-only">וואטסאפ</span>
              WhatsApp
            </Eyebrow>
            <h2 id="wa-title" className="mt-3 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl lg:leading-[1.08]">
              אותה נציגה,
              <br />
              <span className="text-wa-ink">גם בוואטסאפ.</span>
            </h2>
            <p className="mt-5 max-w-xl text-pretty text-lg leading-relaxed text-ink-2">
              אותו מוח שעונה לטלפון עונה גם בצ׳אט: אותו ידע, אותם כללים ואותו זיכרון על כל לקוח.
            </p>
          </div>
          <ul className="mt-8 space-y-5">
            {features.map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="flex gap-4" data-reveal style={{ "--reveal-delay": `${i * 80}ms` } as React.CSSProperties}>
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[#25d366]/12 text-wa-ink">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="font-bold">{title}</p>
                  <p className="mt-1 leading-relaxed text-ink-2">{body}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-8 flex flex-wrap items-center gap-3" data-reveal>
            <p className="rounded-full bg-[#25d366]/12 px-4 py-2 text-sm font-semibold text-wa-ink">
              כלול בחבילות {includedIn.join(" ו-")}, ובחבילת {plans.find((p) => !p.whatsapp)?.name ?? "Start"} בתוספת{" "}
              <span className="ltr">{formatIls(pricing.whatsappAddon)}</span> לחודש
            </p>
            {link ? (
              <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClass("whatsapp", "md")}>
                <WhatsAppIcon className="size-4" /> שאלו אותנו בוואטסאפ
              </a>
            ) : null}
          </div>
        </div>
        <PhoneMock />
      </div>
    </section>
  );
}
