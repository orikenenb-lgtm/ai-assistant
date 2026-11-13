import { describe, expect, it } from 'vitest';
import type { ProviderStatus } from '@/lib/schemas/providers';
import { summarizeDataMode } from './hooks';

function p(id: string, mode: 'DEMO' | 'LIVE' | 'SANDBOX', configured = true): ProviderStatus {
  return { provider_id: id, mode, enabled: true, configured, status: configured ? 'OK' : 'NOT_CONFIGURED' } as ProviderStatus;
}

describe('summarizeDataMode', () => {
  it('reports SANDBOX (never LIVE) when the only real provider is in its test environment', () => {
    const s = summarizeDataMode([p('demo_a', 'DEMO'), p('duffel', 'SANDBOX'), p('amadeus', 'LIVE', false)]);
    expect(s.mode).toBe('SANDBOX');
    expect(s.liveCount).toBe(0);
    expect(s.sandboxCount).toBe(1);
  });
  it('keeps DEMO / MIXED / LIVE as before', () => {
    expect(summarizeDataMode([p('demo_a', 'DEMO')]).mode).toBe('DEMO');
    expect(summarizeDataMode([p('demo_a', 'DEMO'), p('x', 'LIVE')]).mode).toBe('MIXED');
    expect(summarizeDataMode([p('x', 'LIVE')]).mode).toBe('LIVE');
    expect(summarizeDataMode(undefined).mode).toBe('DEMO');
  });
});
