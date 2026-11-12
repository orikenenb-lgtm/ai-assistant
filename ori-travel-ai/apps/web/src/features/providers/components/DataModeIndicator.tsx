import { FlaskConical, Radio, TestTube } from 'lucide-react';
import { Badge, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useDataModeSummary } from '../hooks';

const COPY = {
  DEMO: {
    label: 'מצב הדגמה',
    short: 'הדגמה',
    text: 'כל התוצאות במערכת הן נתוני הדגמה: ספקים, מחירים וזמינות אינם אמיתיים ולא ניתן להזמין אותם.',
  },
  SANDBOX: {
    label: 'בדיקה + הדגמה',
    short: 'בדיקה',
    text: 'אין ספק חי. חלק מהספקים מחוברים לסביבת הבדיקה (Sandbox) שלהם — נתוני בדיקה, לא מחירים אמיתיים — והשאר מחזירים נתוני הדגמה. אי אפשר להזמין אף אחד מהם.',
  },
  MIXED: {
    label: 'חי + הדגמה',
    short: 'חי + הדגמה',
    text: 'חלק מהספקים מחוברים בנתונים חיים וחלק מחזירים נתוני הדגמה. כל תוצאה מסומנת במקור שלה.',
  },
  LIVE: {
    label: 'נתונים חיים',
    short: 'חי',
    text: 'הספקים הפעילים מחזירים נתונים חיים. המחיר הסופי נקבע רק אצל הספק, ואין רכישה אוטומטית.',
  },
} as const;

/** Global "is this real data?" indicator in the top bar. Defaults to DEMO when unknown. */
export function DataModeIndicator({ className }: { className?: string }) {
  const summary = useDataModeSummary();
  const copy = COPY[summary.mode];
  const Icon = summary.mode === 'DEMO' ? FlaskConical : summary.mode === 'SANDBOX' ? TestTube : Radio;
  const description = summary.known
    ? copy.text
    : `${COPY.DEMO.text} (לא ניתן היה לאמת את מצב הספקים כרגע; ברירת המחדל של המערכת היא נתוני הדגמה.)`;

  return (
    <Tooltip content={description} side="bottom">
      <Badge
        tone={summary.mode === 'DEMO' ? 'demo' : summary.mode === 'SANDBOX' ? 'warn' : summary.mode === 'LIVE' ? 'success' : 'info'}
        tabIndex={0}
        data-testid="data-mode-indicator"
        data-mode={summary.mode}
        className={cn('cursor-help py-1', className)}
      >
        <Icon aria-hidden="true" />
        <span className="sr-only">מצב נתונים: </span>
        <span className="hidden sm:inline">{copy.label}</span>
        <span className="sm:hidden">{copy.short}</span>
      </Badge>
    </Tooltip>
  );
}
