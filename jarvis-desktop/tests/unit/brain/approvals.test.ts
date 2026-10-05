import { describe, expect, it } from 'vitest';
import { createApprovalService } from '../../../src/main/permissions/approvals';
import type { ApprovalService } from '../../../src/main/core/contracts';
import type { AssistantEvent } from '../../../src/shared/types';
import { createMockClock, mockDisplay } from './helpers/env.mock';
import { createManualTimers } from './helpers/timers.mock';

function setup() {
  const clock = createMockClock();
  const events: AssistantEvent[] = [];
  const timers = createManualTimers();
  let seq = 0;
  const service = createApprovalService({
    clock,
    emit: (e) => events.push(e),
    idFactory: () => `a${++seq}`,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
  });
  // בדיקת התאמה לחוזה
  const asContract: ApprovalService = service;
  void asContract;
  const ask = (params: unknown = { app_id: 'eplan' }, extra: Partial<Parameters<typeof service.request>[0]> = {}) => {
    const controller = new AbortController();
    const promise = service.request({
      turnId: 't1',
      actionId: `act-${seq + 1}`,
      tool: 'open_application',
      params,
      texts: { action_he: 'פתיחת תוכנה', target_he: 'EPLAN', impact_he: 'תיפתח תוכנה' },
      reason: 'tainted',
      signal: controller.signal,
      ...extra,
    });
    return { promise, controller, id: `a${seq}` };
  };
  return { service, events, timers, clock, ask };
}

describe('approval service', () => {
  it('emits approval-required with the request details and resolves on approve', async () => {
    const t = setup();
    const { promise, id } = t.ask(undefined, { warning_he: 'זהירות' });
    expect(t.events[0]).toMatchObject({
      type: 'approval-required',
      request: { approvalId: id, tool: 'open_application', reason: 'tainted', warning_he: 'זהירות', expiresAt: '2026-10-05T17:16:00.000Z' },
    });
    expect(t.service.pending().map((r) => r.approvalId)).toEqual([id]);
    expect(t.service.decide({ approvalId: id, approved: true })).toEqual({ ok: true });
    await expect(promise).resolves.toMatchObject({ approved: true, outcome: 'approved', approvalId: id });
    expect(t.events.at(-1)).toEqual({ type: 'approval-resolved', approvalId: id, outcome: 'approved' });
    expect(t.service.pending()).toEqual([]);
    expect(t.timers.pending()).toEqual([]);
  });

  it('(12) binding: only identical tool+params verify; one-time use', async () => {
    const t = setup();
    const { promise, id } = t.ask({ app_id: 'eplan', app_name: 'EPLAN' });
    t.service.decide({ approvalId: id, approved: true });
    await promise;
    // אותם פרמטרים בסדר שונה — תקין
    expect(t.service.verifyBinding(id, 'open_application', { app_name: 'EPLAN', app_id: 'eplan' })).toBe(true);
    // חד-פעמי
    expect(t.service.verifyBinding(id, 'open_application', { app_name: 'EPLAN', app_id: 'eplan' })).toBe(false);
  });

  it('(12) binding: different params or tool -> false, and the approval is burned', async () => {
    const t = setup();
    const { promise, id } = t.ask({ app_id: 'eplan' });
    t.service.decide({ approvalId: id, approved: true });
    await promise;
    expect(t.service.verifyBinding(id, 'open_application', { app_id: 'calculator' })).toBe(false);
    expect(t.service.verifyBinding(id, 'open_application', { app_id: 'eplan' })).toBe(false);

    const second = t.ask({ app_id: 'eplan' });
    t.service.decide({ approvalId: second.id, approved: true });
    await second.promise;
    expect(t.service.verifyBinding(second.id, 'open_project', { app_id: 'eplan' })).toBe(false);
  });

  it('(12) rejected approvals never verify', async () => {
    const t = setup();
    const { promise, id } = t.ask();
    t.service.decide({ approvalId: id, approved: false });
    await expect(promise).resolves.toMatchObject({ approved: false, outcome: 'rejected' });
    expect(t.service.verifyBinding(id, 'open_application', { app_id: 'eplan' })).toBe(false);
  });

  it('(12) expiry -> resolved expired; deciding afterwards fails with APPROVAL_EXPIRED', async () => {
    const t = setup();
    const { promise, id } = t.ask();
    expect(t.timers.fire(60_000)).toBe(1);
    await expect(promise).resolves.toMatchObject({ approved: false, outcome: 'expired' });
    expect(t.events.at(-1)).toEqual({ type: 'approval-resolved', approvalId: id, outcome: 'expired' });
    const res = t.service.decide({ approvalId: id, approved: true });
    expect(res).toMatchObject({ ok: false, code: 'APPROVAL_EXPIRED' });
    expect(res.message_he).toBeTruthy();
    expect(t.service.verifyBinding(id, 'open_application', { app_id: 'eplan' })).toBe(false);
  });

  it('expiry by clock is enforced even if the timer is late', async () => {
    const t = setup();
    const { promise, id } = t.ask();
    t.clock.advance(61_000);
    expect(t.service.decide({ approvalId: id, approved: true })).toMatchObject({ ok: false, code: 'APPROVAL_EXPIRED' });
    await expect(promise).resolves.toMatchObject({ outcome: 'expired' });
  });

  it('a decided approval cannot be decided again; unknown ids are a mismatch', async () => {
    const t = setup();
    const { promise, id } = t.ask();
    t.service.decide({ approvalId: id, approved: false });
    await promise;
    expect(t.service.decide({ approvalId: id, approved: true })).toMatchObject({ ok: false, code: 'APPROVAL_EXPIRED' });
    expect(t.service.decide({ approvalId: 'nope', approved: true })).toMatchObject({ ok: false, code: 'APPROVAL_MISMATCH' });
  });

  it('displays: the chosen display must be one of those offered; omitted -> default', async () => {
    const t = setup();
    const displays = [mockDisplay('1', false), mockDisplay('2', true)];
    const a = t.ask({ question: 'מה?' }, { tool: 'capture_screen_for_analysis', reason: 'privacy', displays });
    expect((t.events[0] as Extract<AssistantEvent, { type: 'approval-required' }>).request.defaultDisplayId).toBe('2');
    expect(t.service.decide({ approvalId: a.id, approved: true, displayId: '3' })).toMatchObject({ ok: false, code: 'APPROVAL_MISMATCH' });
    // עדיין פתוח — אפשר לבחור מסך תקין
    expect(t.service.decide({ approvalId: a.id, approved: true, displayId: '1' })).toEqual({ ok: true });
    await expect(a.promise).resolves.toMatchObject({ approved: true, displayId: '1' });

    const b = t.ask({ question: 'מה?' }, { tool: 'capture_screen_for_analysis', reason: 'privacy', displays });
    t.service.decide({ approvalId: b.id, approved: true });
    await expect(b.promise).resolves.toMatchObject({ approved: true, displayId: '2' });
  });

  it('cancelTurn and signal abort settle as cancelled', async () => {
    const t = setup();
    const a = t.ask();
    t.service.cancelTurn('t1');
    await expect(a.promise).resolves.toMatchObject({ approved: false, outcome: 'cancelled' });

    const b = t.ask();
    b.controller.abort();
    await expect(b.promise).resolves.toMatchObject({ outcome: 'cancelled' });
    expect(t.timers.pending()).toEqual([]);
    expect(t.service.decide({ approvalId: b.id, approved: true }).ok).toBe(false);
  });

  it('an already-aborted signal resolves immediately without showing a request', async () => {
    const t = setup();
    const controller = new AbortController();
    controller.abort();
    const res = await t.service.request({
      turnId: 't1',
      actionId: 'x',
      tool: 'open_application',
      params: {},
      texts: { action_he: '', target_he: '', impact_he: '' },
      reason: 'policy',
      signal: controller.signal,
    });
    expect(res.outcome).toBe('cancelled');
    expect(t.events).toEqual([]);
  });
});
