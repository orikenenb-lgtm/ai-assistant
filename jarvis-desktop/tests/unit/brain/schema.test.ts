import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sanitizeJsonSchemaForStrictTools, toModelJsonSchema } from '../../../src/main/tools/schema';
import { createMockTools } from './helpers/tools.mock';

const ALLOWED_KEYS = new Set([
  'type',
  'properties',
  'required',
  'enum',
  'const',
  'anyOf',
  'allOf',
  'items',
  'description',
  'additionalProperties',
  '$ref',
  '$defs',
  'format',
]);
const ALLOWED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

/** בודק שכל צומת בסכמה שייך לתת-הקבוצה של strict tool use. */
function assertStrictSubset(node: unknown, path = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((n, i) => assertStrictSubset(n, `${path}[${i}]`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (path.endsWith('.properties') || path.endsWith('.$defs')) continue;
    expect(ALLOWED_KEYS.has(key), `${path}.${key} is not allowed in strict mode`).toBe(true);
  }
  if (typeof obj.format === 'string') expect(ALLOWED_FORMATS.has(obj.format)).toBe(true);
  if (obj.type === 'object') expect(obj.additionalProperties, `${path} must have additionalProperties:false`).toBe(false);
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'properties' || key === '$defs') {
      for (const [name, child] of Object.entries(value as Record<string, unknown>)) assertStrictSubset(child, `${path}.${key}.${name}`);
    } else if (typeof value === 'object') {
      assertStrictSubset(value, `${path}.${key}`);
    }
  }
}

describe('toModelJsonSchema (strict tool-use sanitizer)', () => {
  it('removes unsupported constraints and describes them in English', () => {
    const schema = z
      .object({
        text: z.string().min(1).max(300).describe('What to remind about'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
        count: z.number().int().min(1).max(10),
        tags: z.array(z.string().max(20)).min(1).max(3),
        filter: z.enum(['today', 'open', 'all']).default('today'),
      })
      .strict();
    const out = toModelJsonSchema(schema) as Record<string, unknown>;
    const props = out.properties as Record<string, Record<string, unknown>>;

    expect(out.type).toBe('object');
    expect(out.additionalProperties).toBe(false);
    expect(out.$schema).toBeUndefined();
    expect(props.text).toEqual({ type: 'string', description: 'What to remind about (must not be empty) (max 300 characters)' });
    expect(props.date).toEqual({ type: 'string', description: '(format YYYY-MM-DD)' });
    expect(props.time).toEqual({ type: 'string', description: '(format HH:MM, 24h)' });
    expect(props.count!.description).toBe('(minimum 1) (maximum 10)');
    expect(props.count!.minimum).toBeUndefined();
    expect(props.tags!.description).toBe('(at least 1 items) (at most 3 items)');
    expect(props.tags!.items).toEqual({ type: 'string', description: '(max 20 characters)' });
    expect(props.filter).toEqual({ type: 'string', enum: ['today', 'open', 'all'], description: '(default: "today")' });
    // שדה עם default אופציונלי לקלט (המודל לא חייב לשלוח)
    expect(out.required).toEqual(['text', 'date', 'time', 'count', 'tags']);
    assertStrictSubset(out);
  });

  it('keeps supported formats, drops their redundant pattern, and notes unsupported ones', () => {
    const schema = z.object({ day: z.iso.date(), mail: z.email(), id: z.uuid(), at: z.iso.time({ precision: -1 }) }).strict();
    const props = (toModelJsonSchema(schema) as { properties: Record<string, Record<string, unknown>> }).properties;
    expect(props.day).toEqual({ type: 'string', format: 'date', description: '(format YYYY-MM-DD)' });
    expect(props.mail).toEqual({ type: 'string', format: 'email' });
    expect(props.id!.format).toBe('uuid');
    expect(props.id!.pattern).toBeUndefined();
    expect(props.at).toEqual({ type: 'string', description: '(format HH:MM, 24h)' });

    const raw = sanitizeJsonSchemaForStrictTools({
      type: 'object',
      properties: { ip: { type: 'string', format: 'cidrv4' }, code: { type: 'string', pattern: '^[A-Z]{3}$' } },
    }) as { properties: Record<string, Record<string, unknown>> };
    expect(raw.properties.ip).toEqual({ type: 'string', description: '(format cidrv4)' });
    expect(raw.properties.code).toEqual({ type: 'string', description: '(must match the regular expression ^[A-Z]{3}$)' });
  });

  it('every nested object (also non-strict ones, inside anyOf/items) ends with additionalProperties:false', () => {
    const schema = z
      .object({
        nested: z.object({ a: z.string() }),
        maybe: z.object({ b: z.number() }).nullable(),
        list: z.array(z.object({ c: z.boolean() })),
        choice: z.union([z.object({ kind: z.literal('x') }), z.object({ kind: z.literal('y'), v: z.string() })]),
      })
      .strict();
    const out = toModelJsonSchema(schema);
    assertStrictSubset(out);
    const props = out.properties as Record<string, Record<string, unknown>>;
    expect((props.nested as { additionalProperties: unknown }).additionalProperties).toBe(false);
    expect(props.choice!.anyOf).toHaveLength(2);
    expect((props.list!.items as Record<string, unknown>).additionalProperties).toBe(false);
  });

  it('nullable optional fields stay optional and keep the null branch', () => {
    const schema = z.object({ due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional() }).strict();
    const out = toModelJsonSchema(schema) as { properties: Record<string, { anyOf: unknown[] }>; required?: string[] };
    expect(out.required ?? []).toEqual([]);
    expect(out.properties.due_date!.anyOf).toEqual([{ type: 'string', description: '(format YYYY-MM-DD)' }, { type: 'null' }]);
  });

  it('an empty strict object is still a valid object schema', () => {
    expect(toModelJsonSchema(z.object({}).strict())).toEqual({ type: 'object', properties: {}, additionalProperties: false });
  });

  it('rejects a non-object root schema', () => {
    expect(() => toModelJsonSchema(z.string())).toThrow(/object/);
  });

  it('all MOCK tool schemas convert to the strict subset', () => {
    for (const def of createMockTools().defs) assertStrictSubset(toModelJsonSchema(def.inputSchema));
  });
});
