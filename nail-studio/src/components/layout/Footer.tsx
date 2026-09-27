import Link from "next/link";
import { siteConfig, brandName } from "@/config/site";
import { mainNav } from "@/data/navigation";
import { getSocialLinks, phoneHref } from "@/lib/links";
import { hasValue } from "@/lib/utils";
import { Container } from "@/components/ui/Container";
import { CurrentYear } from "@/components/ui/CurrentYear";
import { Logo } from "@/components/ui/Logo";
import { SocialIconLink } from "@/components/ui/SocialIconLink";

export function Footer() {
  const socials = getSocialLinks();
  const tel = phoneHref();
  const { address, city } = siteConfig.contact;
  const location = [address, city].filter(hasValue).join(", ");

  return (
    <footer className="bg-ink text-ivory">
      <Container className="grid gap-12 py-16 sm:py-20 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="flex flex-col gap-5">
          <Logo tone="light" className="self-start" />
          <p className="max-w-xs leading-relaxed text-ivory/80">{siteConfig.description}</p>
          {socials.length > 0 && (
            <div className="flex gap-2">
              {socials.map((social) => (
                <SocialIconLink key={social.id} social={social} tone="light" />
              ))}
            </div>
          )}
        </div>

        <nav aria-label="ניווט בתחתית העמוד">
          <h2 className="mb-4 text-sm font-medium tracking-[0.04em] text-rose-200">ניווט</h2>
          <ul className="grid grid-cols-2 gap-x-6 md:grid-cols-1">
            {mainNav.map((item) => (
              <li key={item.href}>
                <a href={item.href} className="inline-flex min-h-11 min-w-11 items-center text-ivory/80 transition-colors hover:text-ivory">
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          <h2 className="mb-4 text-sm font-medium tracking-[0.04em] text-rose-200">יצירת קשר</h2>
          {tel || location ? (
            <ul className="flex flex-col gap-1 text-ivory/80">
              {tel && (
                <li>
                  <a href={tel} dir="ltr" className="inline-flex min-h-11 items-center transition-colors hover:text-ivory">
                    {siteConfig.contact.phone}
                  </a>
                </li>
              )}
              {location && <li className="py-2.5">{location}</li>}
            </ul>
          ) : (
            <p className="leading-relaxed text-ivory/70">פרטי ההתקשרות יתעדכנו בקרוב.</p>
          )}
        </div>
      </Container>

      <div className="border-t border-ivory/10">
        <Container className="flex flex-col items-center justify-between gap-2 py-6 text-sm text-ivory/70 sm:flex-row">
          <p>
            © <CurrentYear serverYear={new Date().getFullYear()} /> <span dir="auto">{brandName}</span>. כל הזכויות שמורות.
          </p>
          <Link href="/#home" className="inline-flex min-h-11 items-center transition-colors hover:text-ivory">
            חזרה למעלה ↑
          </Link>
        </Container>
      </div>
    </footer>
  );
}
