import { EyeOff, Scale, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from './Logo';

const PROMISES = [
  { icon: Scale, title: 'שקיפות מלאה', text: 'כל מחיר מוצג עם מקורו: הדגמה, חי או שמור במטמון.' },
  { icon: ShieldCheck, title: 'אין רכישה בלי אישור', text: 'המערכת מכינה הזמנות — אף פעם לא קונה בשמכם.' },
  { icon: EyeOff, title: 'פרטיות המשפחה', text: 'פרטי נוסעים מוצפנים וגלויים רק לבני המשפחה.' },
];

/** Light horizon illustration: sun over calm sea lines (theme-aware strokes). */
function HorizonArt() {
  return (
    <svg viewBox="0 0 400 150" className="h-auto w-full max-w-sm" aria-hidden="true">
      <defs>
        <linearGradient id="auth-sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5d9a8" />
          <stop offset="1" stopColor="#e9a85a" />
        </linearGradient>
        <clipPath id="auth-horizon">
          <rect x="0" y="0" width="400" height="92" />
        </clipPath>
      </defs>
      <circle cx="200" cy="92" r="52" fill="url(#auth-sun)" clipPath="url(#auth-horizon)" />
      <path d="M0 92h400" stroke="var(--color-line-strong)" strokeWidth="1.5" />
      <path
        d="M10 104c24 0 24-7 48-7s24 7 48 7 24-7 48-7 24 7 48 7 24-7 48-7 24 7 48 7 24-7 48-7 24 7 48 7"
        fill="none"
        stroke="var(--color-sea-400)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M40 121c21 0 21-6 42-6s21 6 42 6 21-6 42-6 21 6 42 6 21-6 42-6 21 6 42 6 21-6 42-6"
        fill="none"
        stroke="var(--color-sea-300)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M80 137c18 0 18-5 36-5s18 5 36 5 18-5 36-5 18 5 36 5 18-5 36-5 18 5 36 5"
        fill="none"
        stroke="var(--color-sky-200)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M300 34l14 4-14 4 4-4z" fill="var(--color-ink-300)" />
    </svg>
  );
}

/** Two-panel layout for login / invitation (light brand panel on the inline-start side on desktop). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="bg-brand-wash relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden border-e border-line p-10 lg:flex xl:p-14">
        <Logo />
        <div>
          <p className="text-sm font-semibold text-accent-strong">פלטפורמת טיולים משפחתית פרטית</p>
          <p className="mt-3 text-display font-bold text-fg">מתכננים יחד, בשקט.</p>
          <ul className="mt-8 flex flex-col gap-5">
            {PROMISES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-accent shadow-xs"
                  aria-hidden="true"
                >
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold text-fg">{title}</span>
                  <span className="block text-sm leading-relaxed text-fg-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <HorizonArt />
      </aside>
      <main id="main" className="flex flex-1 flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="mb-8 lg:hidden">
          <Logo />
        </div>
        <div className="w-full max-w-md">{children}</div>
        <p className="mt-8 text-center text-xs text-fg-subtle">גישה בהזמנה בלבד · ללא רכישות אמיתיות מתוך המערכת</p>
      </main>
    </div>
  );
}
