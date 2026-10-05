/**
 * כלי המודל get_system_status — קריאה בלבד של מצב המחשב (מעבד, זיכרון, כוננים, סוללה, שירותים).
 * הסיכום בעברית בנוי מהערכים האמיתיים שהשירות מדד, בצורה שמתאימה להקראה.
 */
import { z } from 'zod';
import type { ServiceStatus, SystemStatus, ToolResult } from '../../shared/types';
import type { SystemStatusService, ToolContext, ToolDefinition } from '../core/contracts';

export const SystemStatusInputSchema = z.object({}).strict();
export type SystemStatusInput = z.infer<typeof SystemStatusInputSchema>;

const DESCRIPTION = [
  "Read the real, current status of this Windows PC: CPU usage %, RAM usage, free space on the system drive (and other configured drives), battery (only if the PC really reports one), and the connection state of JARVIS's services (Claude, speech-to-text, text-to-speech, wake word).",
  'Read-only, no side effects, takes no parameters.',
  'Use for questions like "מה מצב המחשב?", "כמה זיכרון פנוי?", "כמה מקום נשאר בכונן?", "המעבד עמוס?", "מה מצב הסוללה?".',
  'There is NO temperature or fan data — never invent temperatures or any value that is not in the result.',
].join(' ');

const GIB = 1024 ** 3;

function oneDecimal(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1);
}

/** נפח בצורה קריאה: עד 100GB עם ספרה אחת אחרי הנקודה, מעל זה מספר שלם, ומעל 1024GB ב-TB. */
export function formatSize(bytes: number): string {
  const gb = bytes / GIB;
  if (gb >= 1024) return `${oneDecimal(gb / 1024)} TB`;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  return `${oneDecimal(gb)} GB`;
}

/** "C:\" → "C:"; שיתוף רשת או "/" נשארים כמו שהם (בלי לוכסן בסוף). */
function driveLabel(mount: string): string {
  const drive = mount.match(/^([a-zA-Z]:)[\\/]?$/);
  if (drive?.[1]) return drive[1].toUpperCase();
  return mount.length > 1 ? mount.replace(/[\\/]+$/, '') : mount;
}

const SERVICE_LABELS: Record<ServiceStatus['service'], string> = {
  llm: 'Claude',
  stt: 'תמלול',
  tts: 'הקראה',
  wakeword: 'מילת הפעלה',
};

const STATE_LABELS: Record<ServiceStatus['state'], string> = {
  ok: 'מחובר',
  error: 'שגיאה',
  unknown: 'לא נבדק',
  not_configured: 'לא מוגדר',
  local: 'מקומי',
};

const SERVICE_ORDER: ServiceStatus['service'][] = ['llm', 'stt', 'tts', 'wakeword'];

function serviceLabel(s: ServiceStatus): string {
  if (s.service === 'llm' && s.provider !== 'anthropic') return s.provider;
  return SERVICE_LABELS[s.service];
}

/** סיכום שמתאים להקראה, למשל: "מעבד 23%, זיכרון 41% בשימוש (26.1 מתוך 63.7 GB), בכונן C: פנויים 212 GB. סוללה: לא זוהתה. Claude: מחובר." */
export function formatSystemSummary(s: SystemStatus): string {
  const parts: string[] = [];
  parts.push(s.cpu.usagePercent === null ? 'עומס המעבד לא נמדד' : `מעבד ${Math.round(s.cpu.usagePercent)}%`);
  if (s.memory.totalBytes > 0) {
    parts.push(
      `זיכרון ${Math.round(s.memory.usagePercent)}% בשימוש (${oneDecimal(s.memory.usedBytes / GIB)} מתוך ${oneDecimal(s.memory.totalBytes / GIB)} GB)`,
    );
  }
  if (s.disks.length === 0) parts.push('נתוני הכוננים לא זמינים');
  for (const d of s.disks.slice(0, 4)) parts.push(`בכונן ${driveLabel(d.mount)} פנויים ${formatSize(d.freeBytes)}`);

  let text = `${parts.join(', ')}.`;
  const b = s.battery;
  text +=
    b.available && typeof b.levelPercent === 'number'
      ? ` סוללה: ${b.levelPercent}%${b.charging ? ', בטעינה' : ''}.`
      : ' סוללה: לא זוהתה.';

  const services = [...s.services].sort((a, c) => SERVICE_ORDER.indexOf(a.service) - SERVICE_ORDER.indexOf(c.service));
  if (services.length > 0) {
    text += ` ${services.map((svc) => `${serviceLabel(svc)}: ${STATE_LABELS[svc.state] ?? svc.state}`).join(', ')}.`;
  }
  return text;
}

export function createSystemTool(status: SystemStatusService): ToolDefinition {
  const tool: ToolDefinition<SystemStatusInput> = {
    name: 'get_system_status',
    description: DESCRIPTION,
    inputSchema: SystemStatusInputSchema,
    risk: 'read',
    sideEffect: false,
    dedupeWindowMs: 0,
    title: () => 'בדיקת מצב המחשב',
    describeForApproval: () => ({
      action_he: 'קריאת מצב המחשב (מעבד, זיכרון, כוננים, סוללה ושירותים)',
      target_he: 'המחשב הזה',
      impact_he: 'קריאה בלבד — שום דבר לא משתנה.',
    }),
    async execute(_input, ctx: ToolContext): Promise<ToolResult> {
      if (ctx.signal.aborted) {
        return { ok: false, status: 'cancelled', error_code: 'CANCELLED', summary_he: 'הבדיקה בוטלה.' };
      }
      try {
        const snapshot = await status.getStatus();
        return { ok: true, status: 'success', summary_he: formatSystemSummary(snapshot), data: snapshot };
      } catch {
        return { ok: false, status: 'error', error_code: 'INTERNAL', summary_he: 'לא הצלחתי לקרוא את מצב המחשב כרגע.' };
      }
    },
  };
  return tool as ToolDefinition;
}
