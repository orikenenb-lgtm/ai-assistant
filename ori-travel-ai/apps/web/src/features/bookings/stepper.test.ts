import { describe, expect, it } from 'vitest';
import type { HistoryEntry } from '@/lib/schemas/bookings';
import { buildStepper } from './stepper';

const h = (from: string | null, to: string): HistoryEntry => ({ from, to, at: '2026-11-12T10:00:00Z' });

describe('buildStepper', () => {
  it('marks the current step and completed ones', () => {
    const m = buildStepper('READY_FOR_APPROVAL');
    expect(m.steps.map((s) => s.status)).toEqual(['done', 'done', 'current', 'todo', 'todo', 'todo']);
    expect(m.side).toBeNull();
  });
  it('completes everything when CONFIRMED', () => {
    expect(buildStepper('CONFIRMED').steps.every((s) => s.status === 'done')).toBe(true);
  });
  it('shows UNKNOWN as a problem at the "sent" step with a side state', () => {
    const m = buildStepper('UNKNOWN', [h('DRAFT', 'QUOTE_SELECTED'), h('APPROVED', 'SUBMITTING'), h('SUBMITTING', 'UNKNOWN')]);
    expect(m.side).toBe('UNKNOWN');
    expect(m.steps[4]?.status).toBe('problem');
    expect(m.steps[3]?.status).toBe('done');
  });
  it('keeps progress reached before expiry', () => {
    const m = buildStepper('EXPIRED', [h('QUOTE_SELECTED', 'READY_FOR_APPROVAL'), h('READY_FOR_APPROVAL', 'EXPIRED')]);
    expect(m.side).toBe('EXPIRED');
    expect(m.steps.filter((s) => s.status === 'done')).toHaveLength(2);
    expect(m.steps.some((s) => s.status === 'current')).toBe(false);
  });
});
