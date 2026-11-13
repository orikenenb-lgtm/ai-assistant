import { ArrowLeft, CalendarRange } from 'lucide-react';
import { useId } from 'react';
import { Link } from 'react-router';
import alpine from './assets/alpine.webp';
import oldTown from './assets/old-town.webp';
import poolVilla from './assets/pool-villa.webp';
import tropical from './assets/tropical.webp';
import wing from './assets/wing.webp';

interface Destination {
  code: string;
  city: string;
  country: string;
  theme: string;
  nights: number;
  image: string;
  alt: string;
}

/**
 * Inspiration cards. The photos are illustrative mood images (owner supplied) — they do not show the destination,
 * a hotel or an offer, and the copy says so. Each card opens the "cheapest day of the year" scan for that city
 * (the scan page reads `from/to/nights/adults` from the URL); every price there is labeled with its data source.
 */
const DESTINATIONS: Destination[] = [
  {
    code: 'HKT',
    city: 'פוקט',
    country: 'תאילנד',
    theme: 'חופים טרופיים',
    nights: 7,
    image: tropical,
    alt: 'מרפסת עם בריכה מול מפרץ טרופי בשקיעה',
  },
  {
    code: 'ATH',
    city: 'אתונה',
    country: 'יוון',
    theme: 'עיר עתיקה ליד הים',
    nights: 4,
    image: oldTown,
    alt: 'זוג מטייל עם מזוודות ברחוב אבן עתיק עם פרחים',
  },
  {
    code: 'PFO',
    city: 'פאפוס',
    country: 'קפריסין',
    theme: 'וילה ובריכה',
    nights: 5,
    image: poolVilla,
    alt: 'בריכת אינסוף לבנה מול הים בין עצי דקל',
  },
  {
    code: 'ZRH',
    city: 'ציריך',
    country: 'שווייץ',
    theme: 'חופשת שלג באלפים',
    nights: 6,
    image: alpine,
    alt: 'בקתת עץ מוארת בהרים מושלגים בשקיעה',
  },
];

function scanHref(code: string, nights: number): string {
  return `/cheapest-year?${new URLSearchParams({ from: 'TLV', to: code, nights: String(nights), adults: '2' })}`;
}

const CARD =
  'group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-xs transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

export function DestinationInspiration() {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} data-testid="destination-inspiration" className="flex flex-col gap-4">
      <div>
        <h2 id={headingId} className="text-lg font-bold text-fg">
          השראה ליעד הבא
        </h2>
        <p className="text-sm text-fg-muted">בוחרים יעד, ובודקים מה היום הזול ביותר לטוס אליו בשנה הקרובה.</p>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
        <li className="sm:col-span-2">
          <Link to="/cheapest-year" className={CARD} data-testid="inspiration-card" data-code="">
            <div className="relative aspect-[16/7] overflow-hidden bg-surface-sunken">
              <img
                src={wing}
                alt="כנף מטוס מעל העננים בשקיעה"
                width={960}
                height={540}
                loading="lazy"
                decoding="async"
                className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
              />
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-xs font-medium text-fg-muted">לא בטוחים לאן?</p>
                <p className="text-base font-bold text-fg">בחרו יעד ומצאו את היום הזול בשנה</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-accent">
                <CalendarRange className="size-4" aria-hidden="true" />
                הזול בשנה
                <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden="true" />
              </span>
            </div>
          </Link>
        </li>
        {DESTINATIONS.map((d) => (
          <li key={d.code}>
            <Link
              to={scanHref(d.code, d.nights)}
              className={CARD}
              data-testid="inspiration-card"
              data-code={d.code}
              aria-label={`${d.theme}: ${d.city}, ${d.country} — סריקת השנה, ${d.nights} לילות`}
            >
              <div className="relative aspect-[16/9] overflow-hidden bg-surface-sunken">
                <img
                  src={d.image}
                  alt={d.alt}
                  width={960}
                  height={540}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                />
              </div>
              <div className="flex flex-1 flex-col gap-1 p-4">
                <p className="text-xs font-medium text-fg-muted">{d.theme}</p>
                <p className="text-base font-bold text-fg">
                  {d.city}, {d.country}
                </p>
                <p className="mt-auto inline-flex items-center gap-1.5 pt-2 text-sm font-semibold text-accent">
                  סריקת השנה · {d.nights} לילות
                  <ArrowLeft className="size-4 ltr:rotate-180" aria-hidden="true" />
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-xs text-fg-muted">
        התמונות להמחשה בלבד, ואינן מציגות את היעד, מלון או הצעה מסוימים. המחירים בסריקה מסומנים לפי מקורם.
      </p>
    </section>
  );
}
