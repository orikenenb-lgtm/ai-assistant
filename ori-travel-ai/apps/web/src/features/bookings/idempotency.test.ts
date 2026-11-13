import { beforeEach, describe, expect, it } from 'vitest';
import { getSubmitKey, resetSubmitKeysForTests, submitKeyStorageName } from './idempotency';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('getSubmitKey', () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetSubmitKeysForTests();
  });

  it('is stable per booking+approval and persisted in sessionStorage', () => {
    const a = getSubmitKey('b1', 'ap1');
    expect(a).toMatch(UUID);
    expect(getSubmitKey('b1', 'ap1')).toBe(a);
    expect(sessionStorage.getItem(submitKeyStorageName('b1', 'ap1'))).toBe(a);
  });
  it('survives a reload (memory cleared, storage kept)', () => {
    const a = getSubmitKey('b1', 'ap1');
    resetSubmitKeysForTests();
    expect(getSubmitKey('b1', 'ap1')).toBe(a);
  });
  it('creates a different key for a new approval or another booking', () => {
    const a = getSubmitKey('b1', 'ap1');
    expect(getSubmitKey('b1', 'ap2')).not.toBe(a);
    expect(getSubmitKey('b2', 'ap1')).not.toBe(a);
  });
});
