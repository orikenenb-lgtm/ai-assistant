import { describe, expect, it } from 'vitest';
import { createToolRegistry, safeToolName } from '../../../src/main/tools/registry';
import type { ToolDefinition } from '../../../src/main/core/contracts';
import { TOOL_NAMES } from '../../../src/shared/types';
import { createMockTools } from './helpers/tools.mock';

describe('tool registry', () => {
  it('orders tools by TOOL_NAMES regardless of composition order, all strict', () => {
    const { defs } = createMockTools();
    const registry = createToolRegistry([...defs].reverse());
    expect(registry.list().map((d) => d.name)).toEqual([...TOOL_NAMES]);
    const tools = registry.toAnthropicTools();
    expect(tools.map((t) => t.name)).toEqual([...TOOL_NAMES]);
    for (const t of tools) {
      expect(Object.keys(t).sort()).toEqual(['description', 'input_schema', 'name', 'strict']);
      expect(t.strict).toBe(true);
      expect(t.input_schema.type).toBe('object');
    }
    // אותו אובייקט בכל קריאה (יציבות ל-prompt cache)
    expect(registry.toAnthropicTools()).toBe(tools);
  });

  it('throws on duplicates and on names outside TOOL_NAMES', () => {
    const { defs } = createMockTools();
    expect(() => createToolRegistry([defs[0]!, defs[0]!])).toThrow(/Duplicate/);
    const rogue = { ...defs[0]!, name: 'run_shell' } as unknown as ToolDefinition<unknown>;
    expect(() => createToolRegistry([rogue])).toThrow(/TOOL_NAMES/);
  });

  it('validate: unknown tool, invalid params, valid params', () => {
    const registry = createToolRegistry(createMockTools().defs);
    const unknown = registry.validate('delete_everything', {});
    expect(unknown).toMatchObject({ ok: false, code: 'UNKNOWN_TOOL', issues: [] });
    if (!unknown.ok) expect(unknown.message_he).toContain('delete_everything');

    const invalid = registry.validate('create_reminder', { text: '', date: '6/10/2026', time: '8', extra: 1 });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.code).toBe('INVALID_PARAMS');
      expect(invalid.issues.length).toBeGreaterThanOrEqual(3);
      expect(invalid.message_he).toContain('לא תקינים');
    }

    expect(registry.validate('create_reminder', { text: 'לשתות מים', date: '2026-10-06', time: '08:00' })).toEqual({
      ok: true,
      data: { text: 'לשתות מים', date: '2026-10-06', time: '08:00' },
    });
    expect(registry.get('open_project')?.name).toBe('open_project');
    expect(registry.get('nope')).toBeUndefined();
  });

  it('safeToolName strips control characters and markup and truncates', () => {
    expect(safeToolName('evil\u0000\n<script>name')).toBe('evilscriptname');
    expect(safeToolName('x'.repeat(100))).toHaveLength(64);
    expect(safeToolName('')).toBe('(ללא שם)');
  });
});
