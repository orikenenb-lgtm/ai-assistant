import type Anthropic from '@anthropic-ai/sdk';
import { TOOL_NAMES, isToolName } from '../../shared/types';
import type { ToolDefinition } from '../core/contracts';
import { toModelJsonSchema } from './schema';

/**
 * רישום הכלים: המקור היחיד לרשימת הכלים שנשלחת למודל ולאימות הקלט לפני ביצוע.
 * הסדר קבוע לפי TOOL_NAMES — כך ה-prefix של הבקשה זהה בין קריאות ו-prompt caching עובד.
 */

export type ToolValidation =
  | { ok: true; data: unknown }
  | { ok: false; code: 'UNKNOWN_TOOL' | 'INVALID_PARAMS'; message_he: string; issues: string[] };

export interface ToolRegistry {
  list(): ToolDefinition<unknown>[];
  get(name: string): ToolDefinition<unknown> | undefined;
  toAnthropicTools(): Anthropic.Beta.BetaTool[];
  validate(name: string, input: unknown): ToolValidation;
}

const MAX_ISSUES = 8;

/** שם כלי שהגיע מהמודל — מנוקה לפני שמופיע בהודעה (בלי תווי בקרה, באורך סביר). */
export function safeToolName(name: string): string {
  const cleaned = Array.from(String(name))
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && !(code >= 0x7f && code <= 0x9f) && ch !== '<' && ch !== '>';
    })
    .join('')
    .trim()
    .slice(0, 64);
  return cleaned || '(ללא שם)';
}

export function createToolRegistry(defs: ReadonlyArray<ToolDefinition<unknown>>): ToolRegistry {
  const byName = new Map<string, ToolDefinition<unknown>>();
  for (const def of defs) {
    if (!isToolName(def.name)) {
      throw new Error(`Tool "${String(def.name)}" is not in TOOL_NAMES`);
    }
    if (byName.has(def.name)) {
      throw new Error(`Duplicate tool definition: ${def.name}`);
    }
    byName.set(def.name, def);
  }

  // סדר דטרמיניסטי לפי TOOL_NAMES (לא לפי סדר ההרכבה ב-main.ts)
  const ordered: ToolDefinition<unknown>[] = TOOL_NAMES.flatMap((name) => {
    const def = byName.get(name);
    return def ? [def] : [];
  });

  // מחושב פעם אחת: אותו אובייקט בדיוק בכל בקשה (יציבות ל-cache)
  const anthropicTools: Anthropic.Beta.BetaTool[] = ordered.map((def) => ({
    name: def.name,
    description: def.description,
    input_schema: toModelJsonSchema(def.inputSchema),
    strict: true,
  }));

  return {
    list: () => [...ordered],
    get: (name) => byName.get(name),
    toAnthropicTools: () => anthropicTools,
    validate(name, input) {
      const def = byName.get(name);
      if (!def) {
        return {
          ok: false,
          code: 'UNKNOWN_TOOL',
          message_he: `הכלי "${safeToolName(name)}" לא קיים, ולכן לא בוצע דבר.`,
          issues: [],
        };
      }
      const parsed = def.inputSchema.safeParse(input);
      if (parsed.success) return { ok: true, data: parsed.data };
      const issues = parsed.error.issues.slice(0, MAX_ISSUES).map((issue) => {
        const path = issue.path.length ? issue.path.map(String).join('.') : '(root)';
        return `${path}: ${issue.message}`;
      });
      return {
        ok: false,
        code: 'INVALID_PARAMS',
        message_he: 'הפרמטרים שנשלחו לכלי לא תקינים, ולכן לא בוצע דבר.',
        issues,
      };
    },
  };
}
