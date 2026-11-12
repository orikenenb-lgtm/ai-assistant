import { describe, expect, it } from 'vitest';
import { checkoutTarget } from './checkoutUrl';

const REF = 'A1b2C3d4E5f6G7h8I9j0K1l2';
const DEMO = `/demo-supplier/checkout?ref=${REF}`;

describe('checkoutTarget', () => {
  it('opens the in-app DEMO supplier page only for a DEMO link in the exact allowlisted shape', () => {
    expect(checkoutTarget({ url: DEMO, is_demo: true })).toEqual({ href: DEMO, internal: true });
  });

  it.each([
    `//evil.example/demo-supplier/checkout?ref=${REF}`,
    `/\\evil.example/demo-supplier/checkout?ref=${REF}`,
    `https://evil.example/demo-supplier/checkout?ref=${REF}`,
    `${DEMO}&next=https://evil.example`,
    `${DEMO}#x`,
    `${DEMO}\n`,
    `/demo-supplier/checkout?ref=short`,
    `/demo-supplier/checkout/../login?ref=${REF}`,
    `javascript:alert(1)`,
    `/bookings`,
    '',
  ])('refuses %j as a DEMO link', (url) => {
    expect(checkoutTarget({ url, is_demo: true })).toBeNull();
  });

  it('never follows a relative URL for a non-DEMO (real supplier) link', () => {
    expect(checkoutTarget({ url: DEMO, is_demo: false })).toBeNull();
    expect(checkoutTarget({ url: '//supplier.example/x', is_demo: false })).toBeNull();
    expect(checkoutTarget({ url: 'http://supplier.example/x', is_demo: false })).toBeNull();
  });

  it('opens a plain https URL for a real supplier as an external link', () => {
    expect(checkoutTarget({ url: 'https://supplier.example/checkout?x=1', is_demo: false })).toEqual({
      href: 'https://supplier.example/checkout?x=1',
      internal: false,
    });
  });
});
