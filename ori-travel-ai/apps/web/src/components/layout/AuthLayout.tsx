import { EyeOff, Scale, ShieldCheck } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from './Logo';

const PROMISES = [
  { icon: Scale, title: 'שקיפות מלאה', text: 'כל מחיר מוצג עם מקורו: הדגמה, חי או שמור במטמון.' },
  { icon: ShieldCheck, title: 'אין רכישה בלי אישור', text: 'המערכת מכינה הזמנות — אף פעם לא קונה בשמכם.' },
  { icon: EyeOff, title: 'פרטיות המשפחה', text: 'פרטי נוסעים מוצפנים וגלויים רק לבני המשפחה.' },
];

function HorizonArt() {
  return (
    <svg viewBox="0 0 400 160" className="h-auto w-full max-w-sm" aria-hidden="true">
      <defs>
        <linearGradient id="sun" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f0cd8f" />
          <stop offset="1" stopColor="#d99a45" />
        </linearGradient>
      </defs>
      <circle cx="200" cy="96" r="54" fill="url(#sun)" opacity=".95" />
      <rect x="0" y="96" width="400" height="64" fill="#0b1526" />
      <path d="M0 104c25 0 25-7 50-7s25 7 50 7 25-7 50-7 25 7 50 7 25-7 50-7 25 7 50 7 25-7 50-7 25 7 50 7" fill="none" stroke="#6fc5b8" strokeWidth="3" strokeLinecap="round" />
      <path d="M30 122c22 0 22-6 44-6s22 6 44 6 22-6 44-6 22 6 44 6 22-6 44-6 22 6 44 6 22-6 44-6 22 6 44 6" fill="none" stroke="#6fc5b8" strokeOpacity=".5" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M70 140c18 0 18-5 36-5s18 5 36 5 18-5 36-5 18 5 36 5 18-5 36-5 18 5 36 5 18-5 36-5" fill="none" stroke="#6fc5b8" strokeOpacity=".25" strokeWidth="2" strokeLinecap="round" />
      <path d="M300 40l14 4-14 4 4-4z" fill="#cdd5e0" opacity=".6" />
    </svg>
  );
}

/** Two-panel layout for login / invitation (brand panel on the inline-start side on desktop). */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="surface-dark bg-horizon relative hidden w-[44%] max-w-xl flex-col justify-between overflow-hidden p-10 text-white lg:flex xl:p-14">
        <Logo tone="light" />
        <div>
          <p className="text-sm font-medium text-sun-300">פלטפורמת טיולים משפחתית פרטית</p>
          <p className="mt-3 text-display font-bold">מתכננים יחד, בשקט.</p>
          <ul className="mt-8 flex flex-col gap-5">
            {PROMISES.map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3.5">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/10 text-sea-300" aria-hidden="true">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm leading-relaxed text-ink-200">{text}</span>
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
