import type { ReactNode } from "react";
import { Clock, MapPin, MessageCircle, Phone, Send } from "lucide-react";
import { sectionContent } from "@/data/content";
import { siteConfig } from "@/config/site";
import { SECTION_IDS, phoneHref } from "@/lib/links";
import { hasValue, safeHttpsUrl, toWhatsAppHref } from "@/lib/utils";
import { Button } from "@/components/ui/Button";
import { Container } from "@/components/ui/Container";
import { InstagramIcon } from "@/components/ui/SocialIcons";
import { Reveal } from "@/components/ui/Reveal";
import { Section } from "@/components/ui/Section";
import { SectionHeading } from "@/components/ui/SectionHeading";

interface ContactRow {
  key: string;
  label: string;
  icon: ReactNode;
  content: ReactNode;
}

const iconClass = "h-5 w-5";

/** Builds only the rows that have real, valid values — nothing fake, nothing broken. */
function getContactRows(): ContactRow[] {
  const { contact } = siteConfig;
  const labels = sectionContent.contact.labels;
  const rows: ContactRow[] = [];

  const tel = phoneHref();
  if (tel) {
    rows.push({
      key: "phone",
      label: labels.phone,
      icon: <Phone aria-hidden className={iconClass} strokeWidth={1.2} />,
      content: <ExternalValue href={tel} ltr>{contact.phone}</ExternalValue>,
    });
  }

  const whatsapp = toWhatsAppHref(contact.whatsapp);
  if (whatsapp) {
    rows.push({
      key: "whatsapp",
      label: labels.whatsapp,
      icon: <MessageCircle aria-hidden className={iconClass} strokeWidth={1.2} />,
      content: <ExternalValue href={whatsapp} newTab>שליחת הודעה</ExternalValue>,
    });
  }

  const instagram = safeHttpsUrl(contact.instagram);
  if (instagram) {
    rows.push({
      key: "instagram",
      label: labels.instagram,
      icon: <InstagramIcon className={iconClass} />,
      content: <ExternalValue href={instagram} newTab>לעמוד האינסטגרם</ExternalValue>,
    });
  }

  const location = [contact.address, contact.city].filter(hasValue).join(", ");
  if (location) {
    const maps = safeHttpsUrl(contact.mapsUrl);
    rows.push({
      key: "address",
      label: labels.address,
      icon: <MapPin aria-hidden className={iconClass} strokeWidth={1.2} />,
      content: maps ? <ExternalValue href={maps} newTab>{location}</ExternalValue> : <span>{location}</span>,
    });
  }

  const hours = contact.openingHours.filter((entry) => hasValue(entry.days) && hasValue(entry.hours));
  if (hours.length > 0) {
    rows.push({
      key: "hours",
      label: labels.hours,
      icon: <Clock aria-hidden className={iconClass} strokeWidth={1.2} />,
      content: (
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1">
          {hours.map((entry) => (
            <div key={entry.days} className="contents">
              <dt>{entry.days}</dt>
              <dd dir="ltr" className="text-end">{entry.hours}</dd>
            </div>
          ))}
        </dl>
      ),
    });
  }

  return rows;
}

function ExternalValue({ href, children, newTab, ltr }: { href: string; children: ReactNode; newTab?: boolean; ltr?: boolean }) {
  return (
    <a
      href={href}
      dir={ltr ? "ltr" : undefined}
      className="inline-flex min-h-11 items-center underline decoration-orchid decoration-1 underline-offset-[6px] transition-colors hover:text-orchid"
      {...(newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
      {newTab && <span className="sr-only"> (נפתח בחלון חדש)</span>}
    </a>
  );
}

export function ContactSection() {
  const copy = sectionContent.contact;
  const rows = getContactRows();
  const whatsapp = toWhatsAppHref(siteConfig.contact.whatsapp);

  return (
    <Section id={SECTION_IDS.contact} aria-labelledby="contact-title">
      <Container className="grid gap-12 lg:grid-cols-[1fr_1.1fr] lg:gap-20">
        <Reveal className="flex flex-col gap-8">
          <SectionHeading id="contact-title" eyebrow={copy.eyebrow} title={copy.title} highlight={copy.highlight} description={copy.description} />
          {whatsapp && (
            <Button href={whatsapp} external size="lg" className="self-start">
              <Send aria-hidden className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.8} />
              הודעה ב-WhatsApp
            </Button>
          )}
        </Reveal>

        <Reveal delay={0.1}>
          {rows.length > 0 ? (
            <ul className="divide-y divide-line border-y border-line">
              {rows.map((row) => (
                <li key={row.key} className="flex items-start gap-4 py-5">
                  <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-orchid/30 text-orchid">{row.icon}</span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="text-sm text-mist">{row.label}</span>
                    <div className="text-lg text-cream">{row.content}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex h-full min-h-56 flex-col items-center justify-center gap-4 rounded-[2rem] border border-line bg-coal px-6 py-14 text-center">
              <span className="grid h-12 w-12 place-items-center rounded-full border border-orchid/30 text-orchid">
                <MessageCircle aria-hidden className="h-5 w-5" strokeWidth={1.2} />
              </span>
              <p className="max-w-xs text-lg text-mist">{copy.empty}</p>
            </div>
          )}
        </Reveal>
      </Container>
    </Section>
  );
}
