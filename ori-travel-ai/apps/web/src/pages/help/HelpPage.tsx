import {
  BadgeCheck,
  CircleHelp,
  ClipboardCheck,
  FileCheck2,
  KeyRound,
  LockKeyhole,
  PlugZap,
  Scale,
  Send,
  ShieldCheck,
  Tags,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { Callout, Card, ModeBadge, MODE_BADGE_CONFIG, PageHeader, type ModeBadgeValue } from '@/components/ui';
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/labels';
import { ROLES } from '@/lib/schemas/auth';
import { DEFAULT_RANKING_WEIGHTS } from '@/lib/schemas/offers';

const SECTIONS = [
  { id: 'data-modes', title: 'מקור הנתונים', icon: Tags },
  { id: 'provider-status', title: 'מצב ספקים', icon: PlugZap },
  { id: 'scoring', title: 'ניקוד ההשוואה', icon: Scale },
  { id: 'booking-safety', title: 'בטיחות הזמנות', icon: ShieldCheck },
  { id: 'privacy', title: 'פרטיות נתוני הנוסעים', icon: LockKeyhole },
  { id: 'connect-providers', title: 'חיבור ספקים', icon: KeyRound },
  { id: 'roles', title: 'תפקידים והרשאות', icon: Users },
] as const;

type SectionId = (typeof SECTIONS)[number]['id'];

function Section({ id, children, lead }: { id: SectionId; children: ReactNode; lead?: ReactNode }) {
  const meta = SECTIONS.find((s) => s.id === id)!;
  const Icon = meta.icon;
  return (
    <Card as="section" id={id} aria-labelledby={`${id}-title`} className="scroll-mt-24">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sea-50 text-sea-700" aria-hidden="true">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-lg font-bold text-fg">
            {meta.title}
          </h2>
          {lead && <p className="mt-1 text-sm leading-relaxed text-fg-muted">{lead}</p>}
        </div>
      </div>
      <div className="mt-5 text-sm leading-relaxed text-fg">{children}</div>
    </Card>
  );
}

function BadgeList({ modes }: { modes: ModeBadgeValue[] }) {
  return (
    <dl className="flex flex-col divide-y divide-line">
      {modes.map((m) => (
        <div key={m} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-start sm:gap-4">
          <dt className="w-32 shrink-0">
            <ModeBadge mode={m} showTooltip={false} />
          </dt>
          <dd className="text-fg-muted">{MODE_BADGE_CONFIG[m].description}</dd>
        </div>
      ))}
    </dl>
  );
}

const FACTORS: Array<{ key: keyof typeof DEFAULT_RANKING_WEIGHTS; label: string; color: string; text: string }> = [
  {
    key: 'cost',
    label: 'עלות',
    color: 'bg-sea-600',
    text: 'המחיר הכולל הידוע של ההצעה ביחס להצעות האחרות. רכיבים משוערים או לא כלולים מוצגים בנפרד ואינם מוסתרים.',
  },
  {
    key: 'convenience',
    label: 'נוחות',
    color: 'bg-sea-300',
    text: 'עד כמה ההצעה נוחה למשפחה — למשל משך ועצירות בטיסה, או מיקום הלינה.',
  },
  {
    key: 'flexibility',
    label: 'גמישות',
    color: 'bg-sun-400',
    text: 'מדיניות ביטול ושינוי: האם אפשר לבטל בחינם, לשנות, ובאיזו עלות.',
  },
  {
    key: 'quality',
    label: 'איכות',
    color: 'bg-harbor-500',
    text: 'דירוגים וסטנדרט כפי שהספק מדווח (למשל דירוג אורחים או כוכבים).',
  },
];

const BOOKING_STEPS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: ClipboardCheck, title: 'הכנה', text: 'מבוגר/ת מורשה בוחר/ת הצעה ונוסעים. נוצרת טיוטת הזמנה — שום דבר עוד לא נשלח לספק.' },
  { icon: BadgeCheck, title: 'בדיקה חוזרת', text: 'המערכת בודקת מול הספק אם המחיר או הזמינות השתנו, ומציגה כל שינוי.' },
  {
    icon: FileCheck2,
    title: 'אישור מפורש',
    text: 'סיכום התנאים מוצג במלואו; האישור דורש הזנת סיסמה. שינוי מהותי (למשל בנוסעים) מבטל את האישור.',
  },
  {
    icon: Send,
    title: 'שליחה בסימולציה',
    text: 'בגרסה הנוכחית השליחה היא סימולציה בלבד. רכישה אמיתית נעשית רק באתר הרשמי של הספק, ואחריה אפשר לתעד את מספר האישור.',
  },
];

export default function HelpPage() {
  return (
    <>
      <PageHeader
        title="עזרה"
        icon={<CircleHelp />}
        description="איך Ori Travel AI עובד, מאיפה מגיעים הנתונים, ואיך אנחנו שומרים על המשפחה שלכם."
      />

      <nav aria-label="בעמוד זה" className="mb-6">
        <ul className="flex flex-wrap gap-2">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-fg-muted shadow-xs transition-colors hover:border-sea-200 hover:text-fg"
              >
                <s.icon className="size-3.5" aria-hidden="true" />
                {s.title}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="flex flex-col gap-6">
        <Section
          id="data-modes"
          lead="כל הצעה, מחיר וזמינות במערכת מסומנים במקור שלהם — כדי שתמיד תדעו מה אמיתי ומה לא."
        >
          <BadgeList modes={['DEMO', 'LIVE', 'CACHED']} />
          <Callout tone="neutral" className="mt-5">
            כל עוד לא חובר ספק רשמי, המערכת עובדת עם ספקי הדגמה. שמות הספקים בהדגמה בדויים, אבל הגאוגרפיה (שדות תעופה וערים)
            אמיתית, כדי שאפשר יהיה לתרגל תכנון. המחיר הסופי של הצעה חיה נקבע תמיד אצל הספק.
          </Callout>
        </Section>

        <Section id="provider-status" lead="במסך ״ספקים ואבחון״ ובכל חיפוש מוצג מצבו של כל ספק.">
          <BadgeList modes={['OK', 'DEGRADED', 'FAILED', 'NOT_CONFIGURED', 'DISABLED']} />
          <p className="mt-4 text-fg-muted">
            כשחלק מהספקים נכשלים, החיפוש מסומן כ״חלקי״ והתוצאות מוצגות עם הסבר על הכיסוי — לעולם לא כאילו זו כל התמונה.
          </p>
        </Section>

        <Section id="scoring" lead="הדירוג שקוף ודטרמיניסטי: אותן הצעות ואותם משקלים יפיקו תמיד אותו סדר.">
          <div
            className="flex h-4 overflow-hidden rounded-full"
            role="img"
            aria-label={`משקלי ברירת המחדל: ${FACTORS.map((f) => `${f.label} ${DEFAULT_RANKING_WEIGHTS[f.key]}%`).join(', ')}`}
          >
            {FACTORS.map((f) => (
              <span key={f.key} className={f.color} style={{ width: `${DEFAULT_RANKING_WEIGHTS[f.key]}%` }} />
            ))}
          </div>
          <ul className="mt-5 grid gap-4 sm:grid-cols-2">
            {FACTORS.map((f) => (
              <li key={f.key} className="flex gap-3">
                <span className={`mt-1.5 size-3 shrink-0 rounded-sm ${f.color}`} aria-hidden="true" />
                <span>
                  <span className="font-semibold">
                    {f.label} — <span className="tabular-nums">{DEFAULT_RANKING_WEIGHTS[f.key]}%</span>
                  </span>
                  <span className="mt-0.5 block text-fg-muted">{f.text}</span>
                </span>
              </li>
            ))}
          </ul>
          <ul className="mt-5 flex list-disc flex-col gap-1.5 ps-5 text-fg-muted marker:text-sea-500">
            <li>כל גורם מקבל ציון 0–100, והציון הכולל הוא ממוצע משוקלל. לכל הצעה מוצגים פירוט הציון ונימוקים בעברית.</li>
            <li>אפשר לשנות את המשקלים במסך ההגדרות (סכום המשקלים תמיד 100).</li>
            <li>
              הצעות במטבעות שונים ללא שער המרה זמין מסומנות כ״לא ברות השוואה״ — המערכת לא ממירה מטבע בשקט, וכל המרה מוצגת
              עם מקור השער והזמן שלו.
            </li>
          </ul>
        </Section>

        <Section id="booking-safety" lead="אין רכישות אמיתיות מתוך המערכת. כל הזמנה עוברת ארבעה שלבים מבוקרים.">
          <ol className="grid gap-3 sm:grid-cols-2">
            {BOOKING_STEPS.map((step, i) => (
              <li key={step.title} className="flex gap-3 rounded-lg border border-line bg-sand-50 p-4">
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ink-900 text-sm font-bold text-sun-300" aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <span className="flex items-center gap-1.5 font-semibold">
                    <step.icon className="size-4 text-sea-700" aria-hidden="true" />
                    {step.title}
                  </span>
                  <span className="mt-1 block text-fg-muted">{step.text}</span>
                </span>
              </li>
            ))}
          </ol>
          <ul className="mt-5 flex list-disc flex-col gap-1.5 ps-5 text-fg-muted marker:text-sea-500">
            <li>רק בעלים או מבוגר/ת שאושר/ה כבגיר/ה יכולים להכין הזמנה.</li>
            <li>עוזר ה־AI לעולם אינו יכול להזמין או לשלם — הוא רק מחפש ומסביר.</li>
            <li>אין במערכת תשלום, ולא מתבקשים בה פרטי כרטיס אשראי.</li>
          </ul>
        </Section>

        <Section id="privacy" lead="פרטי הנוסעים שייכים למשפחה — ונשארים בה.">
          <ul className="flex list-disc flex-col gap-1.5 ps-5 text-fg-muted marker:text-sea-500">
            <li>הגישה למערכת בהזמנה בלבד; ההתחברות נשמרת בעוגיית סשן מאובטחת עם הגנת CSRF.</li>
            <li>פרטים רגישים של נוסעים (שם משפטי, תאריך לידה, פרטי מסמכים) נשמרים מוצפנים בשרת.</li>
            <li>ברשימות, מספרי דרכון מוסתרים. חשיפה מלאה מחייבת הזנת סיסמה מחדש ונרשמת ביומן הביקורת.</li>
            <li>משתמשים בתפקיד ״צופה״ רואים מידע מוסתר בלבד.</li>
            <li>אפשר למחוק פרופיל נוסע — הנתונים נמחקים מהשרת.</li>
            <li>תוכן שמגיע מספקים מטופל כמידע לא מהימן, ואינו יכול להפעיל פעולות במערכת.</li>
          </ul>
        </Section>

        <Section id="connect-providers" lead="חיבור ספק רשמי נעשה בשרת, על ידי בעלי החשבון — לא דרך הדפדפן.">
          <ol className="flex list-decimal flex-col gap-2 ps-5 text-fg-muted marker:font-semibold marker:text-fg">
            <li>פותחים חשבון מפתחים אצל הספק הרשמי ומקבלים פרטי גישה.</li>
            <li>
              מגדירים את פרטי הגישה כמשתני סביבה בשרת (בקובץ <code dir="ltr" className="rounded bg-surface-sunken px-1 font-mono text-xs">.env</code>).
              לעולם אל תדביקו מפתחות בצ׳אט, בהודעות או בדפדפן.
            </li>
            <li>
              מפעילים במפורש נתונים חיים בשרת (
              <code dir="ltr" className="rounded bg-surface-sunken px-1 font-mono text-xs">
                ORI_LIVE_PROVIDERS_ENABLED=true
              </code>
              ) — כך מפתח שהוגדר לא יתחיל לצרוך מכסה בלי כוונה.
            </li>
            <li>במסך ״ספקים ואבחון״ מריצים בדיקת תקינות ומפעילים את הספק.</li>
          </ol>
          <p className="mt-4 text-fg-muted">
            עד שהספק מחובר הוא מוצג כ־<ModeBadge mode="NOT_CONFIGURED" size="sm" showTooltip={false} />, והחיפושים משתמשים
            בספקי הדגמה. הממשק תומך בספקים רשמיים כמו Duffel ו־Amadeus (טיסות), Booking.com ו־Expedia (מלונות) ו־Viator
            (אטרקציות); הרשימה המעודכנת ושמות המשתנים הנדרשים מופיעים במסך הספקים.
          </p>
        </Section>

        <Section id="roles" lead="ההרשאות נאכפות בשרת; הממשק רק מסתיר פעולות שאינן זמינות לכם.">
          <dl className="grid gap-3 sm:grid-cols-3">
            {ROLES.map((r) => (
              <div key={r} className="rounded-lg border border-line p-4">
                <dt className="font-semibold">{ROLE_LABELS[r]}</dt>
                <dd className="mt-1 text-fg-muted">{ROLE_DESCRIPTIONS[r]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-fg-muted">הכנת הזמנות מותרת רק לבעלים או למבוגר/ת שסומן/ה כבגיר/ה על ידי בעלי החשבון.</p>
        </Section>
      </div>
    </>
  );
}
