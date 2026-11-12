import {
  Ban,
  CircleCheck,
  CircleSlash,
  CircleX,
  FlaskConical,
  History,
  Radio,
  TimerOff,
  TriangleAlert,
  Unplug,
  type LucideIcon,
} from 'lucide-react';
import type { DataMode, ProviderHealthStatus } from '@/lib/schemas/common';
import type { ProviderRunStatus } from '@/lib/schemas/search';
import { cn } from '@/lib/cn';
import { Badge, type BadgeTone } from './Badge';
import { Tooltip } from './Tooltip';

/** Data modes (DEMO/LIVE/CACHED), provider health and provider-run statuses. */
export type ModeBadgeValue = DataMode | ProviderHealthStatus | ProviderRunStatus;

interface ModeConfig {
  label: string;
  tone: BadgeTone;
  icon: LucideIcon;
  description: string;
  /** Screen-reader prefix giving context to the short label. */
  srPrefix: string;
}

export const MODE_BADGE_CONFIG: Record<ModeBadgeValue, ModeConfig> = {
  DEMO: {
    label: 'הדגמה',
    tone: 'demo',
    icon: FlaskConical,
    srPrefix: 'מקור נתונים:',
    description: 'נתוני הדגמה בלבד: ספקים, מחירים וזמינות אינם אמיתיים, ולא ניתן להזמין אותם.',
  },
  LIVE: {
    label: 'חי',
    tone: 'success',
    icon: Radio,
    srPrefix: 'מקור נתונים:',
    description: 'נתונים עדכניים מספק רשמי. המחיר הסופי נקבע רק באישור אצל הספק.',
  },
  CACHED: {
    label: 'שמור במטמון',
    tone: 'info',
    icon: History,
    srPrefix: 'מקור נתונים:',
    description: 'תוצאה שנשמרה מחיפוש קודם. ייתכן שהמחיר או הזמינות השתנו מאז — בדקו שוב לפני החלטה.',
  },
  OK: {
    label: 'תקין',
    tone: 'success',
    icon: CircleCheck,
    srPrefix: 'מצב ספק:',
    description: 'הספק פועל כרגיל בבדיקה האחרונה.',
  },
  DEGRADED: {
    label: 'חלקי',
    tone: 'warn',
    icon: TriangleAlert,
    srPrefix: 'מצב ספק:',
    description: 'הספק פועל חלקית: חלק מהבקשות נכשלות או איטיות, והתוצאות עלולות להיות חסרות.',
  },
  FAILED: {
    label: 'נכשל',
    tone: 'danger',
    icon: CircleX,
    srPrefix: 'מצב ספק:',
    description: 'הספק לא החזיר תשובה תקינה. תוצאות ממנו אינן מוצגות.',
  },
  NOT_CONFIGURED: {
    label: 'לא מחובר',
    tone: 'neutral',
    icon: Unplug,
    srPrefix: 'מצב ספק:',
    description: 'הספק אינו מחובר: חסרים פרטי התחברות בשרת. ראו "ספקים ואבחון" ומסך העזרה.',
  },
  DISABLED: {
    label: 'מושבת',
    tone: 'muted',
    icon: CircleSlash,
    srPrefix: 'מצב ספק:',
    description: 'הספק הושבת ידנית ואינו משתתף בחיפושים.',
  },
  TIMEOUT: {
    label: 'פג זמן',
    tone: 'warn',
    icon: TimerOff,
    srPrefix: 'מצב ספק:',
    description: 'הספק לא ענה בזמן המוקצב לחיפוש. נסו שוב מאוחר יותר.',
  },
  UNSUPPORTED: {
    label: 'לא נתמך',
    tone: 'muted',
    icon: Ban,
    srPrefix: 'מצב ספק:',
    description: 'הספק אינו תומך בסוג החיפוש הזה.',
  },
};

export interface ModeBadgeProps {
  mode: ModeBadgeValue;
  size?: 'sm' | 'md';
  /** Hover/focus explanation (default true). Disable in dense lists. */
  showTooltip?: boolean;
  /** Override the default explanation. */
  description?: string;
  className?: string;
}

/** Color + text + icon status badge with an explanatory tooltip. */
export function ModeBadge({ mode, size = 'md', showTooltip = true, description, className }: ModeBadgeProps) {
  const config = MODE_BADGE_CONFIG[mode];
  const Icon = config.icon;
  const badge = (
    <Badge
      tone={config.tone}
      size={size}
      data-mode={mode}
      tabIndex={showTooltip ? 0 : undefined}
      className={cn(showTooltip && 'cursor-help', className)}
    >
      <Icon aria-hidden="true" />
      <span className="sr-only">{config.srPrefix} </span>
      <span>{config.label}</span>
    </Badge>
  );
  if (!showTooltip) return badge;
  return <Tooltip content={description ?? config.description}>{badge}</Tooltip>;
}
