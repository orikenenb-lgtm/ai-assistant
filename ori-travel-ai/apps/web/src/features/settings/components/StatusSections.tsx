import { Bot, KeyRound, ShieldCheck, Plug } from 'lucide-react';
import { Badge, Callout } from '@/components/ui';
import type { Settings } from '@/lib/schemas/settings';
import { SettingsSection } from './SettingsSection';

const READ_ONLY = 'מצב המערכת — לקריאה בלבד';

function StatusRow({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warn' | 'muted' | 'info' }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-sm">
      <dt className="text-fg-muted">{label}</dt>
      <dd>
        <Badge tone={tone}>{value}</Badge>
      </dd>
    </div>
  );
}

const PROVIDER_LABELS: Record<string, string> = { none: 'לא מוגדר', ollama: 'Ollama (מקומי)', anthropic: 'Anthropic (בתשלום)', openai: 'OpenAI (בתשלום)' };

export function AiSection({ settings }: { settings: Settings }) {
  const ai = settings.ai;
  const local = ai.provider === 'ollama';
  return (
    <SettingsSection id="ai" title="עוזר AI" description="הסבר על הצעות ותכנון בשיחה. הגדרה בשרת בלבד — לא ניתנת לשינוי מהדפדפן." icon={<Bot />} readOnlyReason={READ_ONLY}>
      <dl className="divide-y divide-line">
        <StatusRow label="ספק" value={PROVIDER_LABELS[ai.provider] ?? ai.provider} tone={ai.configured ? 'success' : 'muted'} />
        <StatusRow label="מצב" value={ai.configured ? 'מוגדר' : 'לא מוגדר'} tone={ai.configured ? 'success' : 'warn'} />
        <StatusRow label="מודל" value={ai.model ?? '—'} tone="muted" />
        <StatusRow label="שימוש בספק בתשלום" value={ai.paid_allowed ? 'מותר' : 'חסום'} tone={ai.paid_allowed ? 'warn' : 'success'} />
      </dl>
      {!ai.configured && (
        <Callout tone="info" title="העוזר כבוי" className="mt-4">
          כל שאר המערכת — חיפוש, השוואה, תכנון והתראות — עובדת בלי AI. להפעלה מקומית ובחינם, התקינו Ollama במחשב השרת והגדירו בשרת ספק ומודל (למשל ORI_AI_PROVIDER=ollama ו-ORI_AI_MODEL). אפשר גם להגדיר ספק בתשלום, אבל זה דורש אישור מפורש.
        </Callout>
      )}
      {ai.configured && local && (
        <Callout tone="success" className="mt-4">
          העוזר רץ מקומית ב-Ollama: השיחות לא יוצאות מהשרת שלכם ואין עלות לשאילתה.
        </Callout>
      )}
      <Callout tone={ai.paid_allowed ? 'warn' : 'neutral'} title="אזהרת עלות" className="mt-4">
        ספקי AI בענן גובים לפי שימוש. {ai.paid_allowed ? 'שימוש בספק בתשלום מאושר כרגע בשרת — כל שאילתה עלולה לעלות כסף.' : 'שימוש בספק בתשלום חסום כרגע; כדי לאפשר אותו יש לשנות את הגדרות השרת ביודעין.'}
      </Callout>
    </SettingsSection>
  );
}

export function SafetySection({ settings }: { settings: Settings }) {
  return (
    <SettingsSection id="safety" title="בטיחות הזמנות ואבטחה" description="מה המערכת עושה ומה היא לא עושה." icon={<ShieldCheck />} readOnlyReason={READ_ONLY}>
      <dl className="divide-y divide-line">
        <StatusRow
          label="ביצוע הזמנות אמיתיות"
          value={settings.booking.live_execution ? 'מופעל' : 'כבוי'}
          tone={settings.booking.live_execution ? 'warn' : 'success'}
        />
        <StatusRow label="הצפנת פרטי נוסעים" value={settings.encryption_available ? 'פעילה' : 'לא זמינה'} tone={settings.encryption_available ? 'success' : 'warn'} />
        <StatusRow label="ספקי נתונים חיים" value={settings.live_providers_enabled ? 'מופעלים' : 'כבויים (הדגמה בלבד)'} tone={settings.live_providers_enabled ? 'info' : 'muted'} />
      </dl>
      {!settings.booking.live_execution && (
        <Callout tone="success" icon={<ShieldCheck />} title="המערכת לא מבצעת הזמנות ולא מחייבת כרטיס אשראי" className="mt-4">
          הכנת הזמנה מסתיימת בקישור לאתר הספק או בהוראות — התשלום וההזמנה בפועל נעשים על ידכם מחוץ למערכת. אין ביצוע הזמנה אוטומטי.
        </Callout>
      )}
      {!settings.encryption_available && (
        <Callout tone="warn" icon={<KeyRound />} title="מפתח ההצפנה חסר" className="mt-4">
          בלי מפתח הצפנה אי אפשר לשמור או לקרוא פרטי דרכון. בעל החשבון צריך להגדיר את ORI_DATA_KEY בהגדרות השרת (אפשר ליצור מפתח עם <span dir="ltr">python -m app.cli gen-key</span>) ולהפעיל את השרת מחדש.
        </Callout>
      )}
      {!settings.live_providers_enabled && (
        <Callout tone="neutral" icon={<Plug />} className="mt-4">
          כרגע המחירים בחיפוש הם נתוני הדגמה ומסומנים בתג "הדגמה". ספקים חיים מופעלים בהגדרות השרת ובעמוד "ספקים", ורק אחרי הגדרת מפתחות.
        </Callout>
      )}
    </SettingsSection>
  );
}
