import { describe, expect, it } from 'vitest';
import { canonicalJson, paramsHash } from '../../../src/main/permissions/canonical';

describe('canonicalJson / paramsHash', () => {
  it('sorts keys recursively and is stable', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('follows JSON semantics for undefined, non-finite numbers and dates', () => {
    expect(canonicalJson({ a: undefined, b: null, c: Number.NaN })).toBe('{"b":null,"c":null}');
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
    expect(canonicalJson(new Date('2026-10-05T17:15:00Z'))).toBe('"2026-10-05T17:15:00.000Z"');
    expect(canonicalJson('עברית')).toBe('"עברית"');
  });

  it('throws on circular structures', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    expect(() => canonicalJson(a)).toThrow(/circular/);
  });

  it('paramsHash: sha256 hex, bound to tool and exact params', () => {
    const h = paramsHash('open_application', { app_id: 'eplan' });
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(paramsHash('open_application', { app_id: 'eplan' })).toBe(h);
    expect(paramsHash('open_project', { app_id: 'eplan' })).not.toBe(h);
    expect(paramsHash('open_application', { app_id: 'calculator' })).not.toBe(h);
    // אותם פרמטרים בסדר מפתחות שונה -> אותו hash
    expect(paramsHash('t', { a: 1, b: 2 })).toBe(paramsHash('t', { b: 2, a: 1 }));
  });
});
