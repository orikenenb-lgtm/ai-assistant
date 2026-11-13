import { act, renderHook } from '@testing-library/react';
import { getThemePreference, resolveTheme, setThemePreference, THEME_STORAGE_KEY, useTheme } from './theme';

afterEach(() => {
  setThemePreference('system');
  vi.restoreAllMocks();
});

describe('theme', () => {
  it('resolves "system" from prefers-color-scheme and keeps explicit choices', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('defaults to the system theme (light in jsdom) on <html>', () => {
    expect(getThemePreference()).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('applies and persists a manual choice; "system" clears the stored value', () => {
    setThemePreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    setThemePreference('system');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('still switches when localStorage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    expect(() => setThemePreference('dark')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('useTheme re-renders on change', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.preference).toBe('system');
    act(() => result.current.setPreference('dark'));
    expect(result.current.preference).toBe('dark');
    expect(result.current.resolved).toBe('dark');
  });
});
