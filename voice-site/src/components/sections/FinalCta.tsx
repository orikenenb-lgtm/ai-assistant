import { Globe, PhoneCall } from "lucide-react";
import { brand, contact, telLink, whatsappLink } from "@/config/site";
import { Eyebrow } from "@/components/ui/Section";
import { WhatsAppIcon } from "@/components/ui/BrandIcons";
import { StartDemoButton } from "@/components/demo/StartDemoButton";
import { ContactForm } from "@/components/sections/ContactForm";

export function FinalCta() {
  const wa = whatsappLink(`היי ${brand.name}, אשמח לשמוע על נציגה טלפונית לעסק שלי`);
  const channels = [
    {
      key: "browser",
      node: (
        <StartDemoButton className="flex w-full items-center gap-3 rounded-2xl border border-white/12 bg-white/5 p-4 text-start transition hover:bg-white/10">
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent text-accent-ink">
            <Globe className="size-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block font-bold">דברו איתה בדפדפן</span>
            <span className="block text-sm text-on-forest-2">בלי הרשמה, ישר מהעמוד</span>
          </span>
        </StartDemoButton>
      ),
    },
    contact.demoPhone
      ? {
          key: "phone",
          node: (
            <a href={telLink(contact.demoPhone)} className="flex items-center gap-3 rounded-2xl border border-white/12 bg-white/5 p-4 transition hover:bg-white/10">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-white text-[#132019]">
                <PhoneCall className="size-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block font-bold">התקשרו אליה</span>
                <span className="ltr block text-sm text-on-forest-2">{contact.demoPhone}</span>
              </span>
            </a>
          ),
        }
      : null,
    wa
      ? {
          key: "wa",
          node: (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-white/12 bg-white/5 p-4 transition hover:bg-white/10">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-wa text-[#0b3d1e]">
                <WhatsAppIcon className="size-5" />
              </span>
              <span>
                <span className="block font-bold">כתבו לנו בוואטסאפ</span>
                <span className="block text-sm text-on-forest-2">על העסק ועל השיחות שתרצו להעביר</span>
              </span>
            </a>
          ),
        }
      : null,
  ].filter((c) => c !== null);

  return (
    <section id="contact" aria-labelledby="contact-title" className="scroll-mt-20 px-2 py-10 sm:px-3">
      <div className="forest-panel on-forest relative overflow-hidden rounded-[2rem] py-16 sm:rounded-[2.5rem] sm:py-24">
        <div className="container-page grid grid-cols-1 gap-12 lg:grid-cols-[1fr_1.15fr] lg:items-center">
          <div data-reveal>
            <Eyebrow className="text-accent">מתחילים</Eyebrow>
            <h2 id="contact-title" className="mt-3 text-balance text-4xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl lg:leading-[1.05]">
              רוצים נציגה כזו
              <br />
              <span className="text-accent">לעסק שלכם?</span>
            </h2>
            <p className="mt-5 max-w-lg text-pretty text-lg leading-relaxed text-on-forest-2">
              ספרו לנו על העסק ועל השיחות שאתם רוצים להעביר לנציגה, ונחזור עם הצעה מותאמת. או פשוט תדברו איתה קודם.
            </p>
            <ul className="mt-8 grid grid-cols-1 max-w-md gap-3">
              {channels.map((c) => (
                <li key={c.key}>{c.node}</li>
              ))}
            </ul>
          </div>
          <div data-reveal style={{ "--reveal-delay": "120ms" } as React.CSSProperties}>
            <ContactForm />
          </div>
        </div>
      </div>
    </section>
  );
}
