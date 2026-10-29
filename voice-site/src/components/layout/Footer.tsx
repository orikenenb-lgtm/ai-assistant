import Link from "next/link";
import { Mail } from "lucide-react";
import { brand, contact, nav, whatsappLink } from "@/config/site";
import { Logo } from "@/components/ui/Logo";
import { WhatsAppIcon } from "@/components/ui/BrandIcons";

function Hills() {
  return (
    <svg className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full sm:h-56" viewBox="0 0 1440 220" preserveAspectRatio="none" aria-hidden="true">
      <path d="M0 140 C 180 90, 360 120, 520 100 S 860 40, 1040 80 S 1320 120, 1440 70 V220 H0Z" fill="var(--forest-2)" opacity="0.55" />
      <path d="M0 170 C 220 130, 420 180, 640 150 S 1000 110, 1200 150 S 1380 170, 1440 150 V220 H0Z" fill="var(--forest-3)" opacity="0.65" />
      <path d="M0 200 C 260 175, 520 205, 780 188 S 1200 170, 1440 195 V220 H0Z" fill="var(--forest)" />
    </svg>
  );
}

export function Footer() {
  const year = new Date().getFullYear();
  const wa = whatsappLink(`היי ${brand.name}, יש לי שאלה`);
  return (
    <footer className="relative mt-10 overflow-hidden border-t border-line bg-surface-2/50 pb-48 pt-16 sm:pb-64">
      <div className="container-page relative z-10 grid grid-cols-1 gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs leading-relaxed text-ink-2">{brand.tagline}. עונה, קובעת ומעדכנת, 24/7.</p>
          <ul className="mt-5 space-y-2 text-sm">
            {contact.email ? (
              <li>
                <a href={`mailto:${contact.email}`} className="inline-flex items-center gap-2 text-ink-2 hover:text-ink">
                  <Mail className="size-4" aria-hidden="true" /> {contact.email}
                </a>
              </li>
            ) : null}
            {wa ? (
              <li>
                <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 text-ink-2 hover:text-ink">
                  <WhatsAppIcon className="size-4 text-wa-dark" /> וואטסאפ
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        <nav aria-label="מוצר">
          <p className="font-bold">מוצר</p>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-2">
            {nav.map((item) => (
              <li key={item.href}>
                <Link href={`/${item.href}`} className="hover:text-ink">
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="התחלה">
          <p className="font-bold">התחלה</p>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-2">
            <li>
              <Link href="/#demo" className="hover:text-ink">
                לדבר עם הנציגה
              </Link>
            </li>
            <li>
              <Link href="/#contact" className="hover:text-ink">
                השארת פרטים
              </Link>
            </li>
            <li>
              <Link href="/#roi" className="hover:text-ink">
                כמה תחסכו
              </Link>
            </li>
          </ul>
        </nav>

        <nav aria-label="מידע משפטי">
          <p className="font-bold">מידע ומדיניות</p>
          <ul className="mt-4 space-y-2.5 text-sm text-ink-2">
            <li>
              <Link href="/privacy" className="hover:text-ink">
                מדיניות פרטיות
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-ink">
                תנאי שימוש
              </Link>
            </li>
            <li>
              <Link href="/accessibility" className="hover:text-ink">
                הצהרת נגישות
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="container-page relative z-10 mt-12 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-sm text-ink-3">
        <p>
          © {year} <span dir="ltr">{brand.name}</span>. כל הזכויות שמורות.
        </p>
        <p>נבנה בישראל, בעברית.</p>
      </div>
      <Hills />
    </footer>
  );
}
