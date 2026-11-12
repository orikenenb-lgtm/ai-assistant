import { describe, expect, it } from 'vitest';
import { safeExternalUrl } from './safeUrl';

describe('safeExternalUrl', () => {
  it('accepts plain https links', () => {
    expect(safeExternalUrl('https://www.viator.com/tours/x')).toBe('https://www.viator.com/tours/x');
  });
  it.each([
    'http://www.viator.com/x',
    'https://evil.com\\.viator.com/x',
    'javascript:alert(1)',
    'https://user:pw@viator.com/x',
    'https://viator.com:8443/x',
    'https://viator.com/a b',
    '',
    null,
  ])('rejects %s', (url) => {
    expect(safeExternalUrl(url)).toBeNull();
  });
});
