import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

/**
 * המרת סכמת zod לסכמת JSON שמתאימה ל-strict tool use של Claude.
 *
 * ב-strict tool use ה-API תומך רק בתת-קבוצה של JSON Schema. מגבלות כמו maxLength/minimum/pattern
 * לא נאכפות שם (ואף נדחות), ולכן:
 * 1) משאירים רק מילות מפתח נתמכות.
 * 2) מגבלות שהוסרו מתוארות במילים (באנגלית) בתוך description — כדי שהמודל עדיין יכבד אותן.
 * 3) כל אובייקט מסתיים ב-additionalProperties:false.
 * האכיפה האמיתית נשארת מקומית: הרישום (registry) מאמת כל קלט מול סכמת zod המלאה לפני ביצוע.
 */

/** פורמטים שה-API תומך בהם ב-strict mode. */
const SUPPORTED_FORMATS = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);

/** מילות מפתח שנשמרות כמו שהן (properties/items/anyOf וכו' מטופלות ברקורסיה). */
const PASSTHROUGH_KEYS = new Set(['type', 'enum', 'const', 'description', '$ref']);

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** תיאור מילולי של regex נפוצים, כדי שהמודל יבין את הפורמט בלי pattern. */
function describePattern(pattern: string): string {
  // תאריך: \d{4}-\d{2}-\d{2} או הגרסה הארוכה של zod (\d{4}-(?:...))
  if (/\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(pattern) || /\\d\{4\}-\(\?:/.test(pattern)) return 'format YYYY-MM-DD';
  // שעה: HH:MM בשעון 24 (למשל ^(?:[01]\d|2[0-3]):[0-5]\d$ או ^\d{2}:\d{2}$)
  const looksLikeClock =
    pattern.includes(':') &&
    (/2\[0-3\]/.test(pattern) || /^\^?\\d\{(?:2|1,2)\}:\\d\{2\}\$?$/.test(pattern)) &&
    /(?:\[0-5\]\\d|\\d\{2\})\)?\$?$/.test(pattern);
  if (looksLikeClock) return 'format HH:MM, 24h';
  return `must match the regular expression ${pattern}`;
}

function appendNotes(description: unknown, notes: string[]): string | undefined {
  const base = typeof description === 'string' ? description.trim() : '';
  if (!notes.length) return base || undefined;
  const suffix = notes.map((n) => `(${n})`).join(' ');
  return base ? `${base} ${suffix}` : suffix;
}

function formatDefault(value: unknown): string {
  try {
    return `default: ${JSON.stringify(value)}`;
  } catch {
    return 'has a default value';
  }
}

/** מסיר מגבלות לא נתמכות מצומת אחד ומחזיר אותן כהערות מילוליות. */
function collectRemovedConstraints(node: JsonObject, keptFormat: boolean): string[] {
  const notes: string[] = [];
  const isArray = node.type === 'array';
  const isNumber = node.type === 'number' || node.type === 'integer';

  if (typeof node.minLength === 'number' && typeof node.maxLength === 'number' && node.minLength === node.maxLength) {
    notes.push(`exactly ${node.minLength} characters`);
  } else {
    if (typeof node.minLength === 'number' && node.minLength > 0) {
      notes.push(node.minLength === 1 ? 'must not be empty' : `min ${node.minLength} characters`);
    }
    if (typeof node.maxLength === 'number') notes.push(`max ${node.maxLength} characters`);
  }

  if (typeof node.minimum === 'number') notes.push(`minimum ${node.minimum}`);
  if (typeof node.exclusiveMinimum === 'number') notes.push(`greater than ${node.exclusiveMinimum}`);
  if (typeof node.maximum === 'number') notes.push(`maximum ${node.maximum}`);
  if (typeof node.exclusiveMaximum === 'number') notes.push(`less than ${node.exclusiveMaximum}`);
  if (typeof node.multipleOf === 'number') {
    notes.push(isNumber && node.multipleOf === 1 ? 'whole number' : `multiple of ${node.multipleOf}`);
  }

  if (isArray || typeof node.minItems === 'number' || typeof node.maxItems === 'number') {
    if (typeof node.minItems === 'number' && node.minItems > 0) notes.push(`at least ${node.minItems} items`);
    if (typeof node.maxItems === 'number') notes.push(`at most ${node.maxItems} items`);
  }

  if (typeof node.pattern === 'string') {
    // כשיש format נתמך — הוא כבר מתאר את הצורה, ה-pattern מיותר (חוץ מתאריך, שבו נוח לציין במפורש)
    if (!keptFormat) notes.push(describePattern(node.pattern));
    else if (node.format === 'date') notes.push('format YYYY-MM-DD');
  }

  if (typeof node.format === 'string' && !keptFormat) notes.push(`format ${node.format}`);

  if ('default' in node) notes.push(formatDefault(node.default));
  return notes;
}

function sanitizeNode(input: unknown, depth: number): unknown {
  if (depth > 32) throw new Error('Tool schema is nested too deeply');
  if (Array.isArray(input)) return input.map((v) => sanitizeNode(v, depth + 1));
  if (!isObject(input)) return input;

  const node = input;
  const out: JsonObject = {};
  const keptFormat = typeof node.format === 'string' && SUPPORTED_FORMATS.has(node.format);

  for (const key of PASSTHROUGH_KEYS) {
    if (key in node && key !== 'description') out[key] = node[key];
  }
  if (keptFormat) out.format = node.format;

  if (isObject(node.properties)) {
    const props: JsonObject = {};
    for (const [name, child] of Object.entries(node.properties)) props[name] = sanitizeNode(child, depth + 1);
    out.properties = props;
  }
  if (Array.isArray(node.required)) out.required = [...(node.required as unknown[])];
  if ('items' in node && node.items !== undefined) {
    // prefixItems/tuple לא נתמכים — רק items יחיד
    if (isObject(node.items)) out.items = sanitizeNode(node.items, depth + 1);
  }
  if (Array.isArray(node.anyOf)) out.anyOf = node.anyOf.map((v) => sanitizeNode(v, depth + 1));
  // oneOf לא נתמך ב-strict — anyOf הוא קירוב בטוח (האימות המקומי מחמיר יותר)
  if (Array.isArray(node.oneOf)) {
    const extra = node.oneOf.map((v) => sanitizeNode(v, depth + 1));
    out.anyOf = Array.isArray(out.anyOf) ? [...(out.anyOf as unknown[]), ...extra] : extra;
  }
  if (Array.isArray(node.allOf)) out.allOf = node.allOf.map((v) => sanitizeNode(v, depth + 1));
  if (isObject(node.$defs)) {
    const defs: JsonObject = {};
    for (const [name, child] of Object.entries(node.$defs)) defs[name] = sanitizeNode(child, depth + 1);
    out.$defs = defs;
  }

  const description = appendNotes(node.description, collectRemovedConstraints(node, keptFormat));
  if (description) out.description = description;

  const looksLikeObject = node.type === 'object' || (node.type === undefined && isObject(node.properties));
  if (looksLikeObject) {
    if (!isObject(out.properties)) out.properties = {};
    out.additionalProperties = false;
  }
  return out;
}

/** מנקה סכמת JSON כללית לתת-הקבוצה של strict tool use. מיוצא לבדיקות. */
export function sanitizeJsonSchemaForStrictTools(schema: Record<string, unknown>): Anthropic.Beta.BetaTool.InputSchema {
  const cleaned = sanitizeNode(schema, 0);
  if (!isObject(cleaned) || cleaned.type !== 'object') {
    throw new Error('Tool input schema must be a JSON object schema (type: "object")');
  }
  return cleaned as Anthropic.Beta.BetaTool.InputSchema;
}

/**
 * zod -> JSON Schema לכלי. משתמשים במצב io:'input' כי המודל מייצר את הקלט (שדות עם default נשארים אופציונליים).
 */
export function toModelJsonSchema(schema: z.ZodType): Anthropic.Beta.BetaTool.InputSchema {
  const raw = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return sanitizeJsonSchemaForStrictTools(raw);
}
