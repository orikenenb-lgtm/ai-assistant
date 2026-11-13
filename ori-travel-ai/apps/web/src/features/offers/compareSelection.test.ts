import { beforeEach, describe, expect, it } from 'vitest';
import { COMPARE_MAX, COMPARE_STORAGE_KEY, compareSelection } from './compareSelection';

describe('compareSelection', () => {
  beforeEach(() => {
    compareSelection.clear();
    window.sessionStorage.clear();
  });

  it('toggles ids and persists them in sessionStorage', () => {
    expect(compareSelection.toggle('a')).toBe('added');
    expect(compareSelection.toggle('b')).toBe('added');
    expect(compareSelection.get()).toEqual(['a', 'b']);
    expect(JSON.parse(window.sessionStorage.getItem(COMPARE_STORAGE_KEY) ?? '[]')).toEqual(['a', 'b']);
    expect(compareSelection.toggle('a')).toBe('removed');
    expect(compareSelection.get()).toEqual(['b']);
  });

  it('refuses more than the maximum', () => {
    for (let i = 0; i < COMPARE_MAX; i++) expect(compareSelection.toggle(`o${i}`)).toBe('added');
    expect(compareSelection.toggle('extra')).toBe('full');
    expect(compareSelection.get()).toHaveLength(COMPARE_MAX);
  });

  it('reloads from storage', () => {
    window.sessionStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(['x', 'y', 'x', 3]));
    compareSelection.reload();
    expect(compareSelection.get()).toEqual(['x', 'y']);
  });
});
