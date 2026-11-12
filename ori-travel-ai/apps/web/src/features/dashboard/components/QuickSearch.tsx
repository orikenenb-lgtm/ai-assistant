import { ArrowLeft, BedDouble, Car, Plane, Sparkles, Ticket, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';

const SHORTCUTS: Array<{ to: string; title: string; text: string; icon: LucideIcon }> = [
  { to: '/search/flights', title: 'טיסות', text: 'הלוך-חזור, גמישות תאריכים', icon: Plane },
  { to: '/search/hotels', title: 'מלונות', text: 'חדרים, ארוחות וביטול חינם', icon: BedDouble },
  { to: '/search/cars', title: 'רכבים', text: 'איסוף, החזרה וביטוחים', icon: Car },
  { to: '/search/activities', title: 'אטרקציות', text: 'פעילויות למשפחה', icon: Ticket },
];

export function QuickSearch() {
  return (
    <section aria-labelledby="quick-search-title">
      <h2 id="quick-search-title" className="sr-only">
        חיפוש מהיר
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Link
          to="/assistant"
          className="surface-dark bg-horizon group relative flex min-h-36 flex-col justify-between overflow-hidden rounded-xl p-5 text-white shadow-md transition-shadow hover:shadow-lg sm:col-span-2 lg:col-span-2 lg:row-span-2 lg:min-h-0"
        >
          <span className="grid size-11 place-items-center rounded-xl bg-white/10 text-sun-400" aria-hidden="true">
            <Sparkles className="size-5" />
          </span>
          <span className="mt-6 block">
            <span className="block text-lg font-bold">שאלו את העוזר</span>
            <span className="mt-1 block text-sm leading-relaxed text-ink-200">
              ספרו במילים שלכם לאן, מתי ועם מי — והעוזר יחפש בשבילכם.
            </span>
          </span>
          <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sea-300">
            פתיחת העוזר
            <ArrowLeft className="size-4 transition-transform group-hover:-translate-x-0.5 ltr:rotate-180" aria-hidden="true" />
          </span>
        </Link>
        {SHORTCUTS.map(({ to, title, text, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            className={cn(
              'group flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4 shadow-xs transition-all',
              'hover:border-sea-200 hover:shadow-md lg:col-span-2',
            )}
          >
            <span
              className="grid size-11 shrink-0 place-items-center rounded-xl bg-sea-50 text-sea-700 transition-colors group-hover:bg-sea-100"
              aria-hidden="true"
            >
              <Icon className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-fg">{title}</span>
              <span className="block truncate text-sm text-fg-muted">{text}</span>
            </span>
            <ArrowLeft className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:-translate-x-0.5 ltr:rotate-180" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}
