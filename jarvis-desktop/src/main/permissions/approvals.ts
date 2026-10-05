import { randomUUID } from 'node:crypto';
import type { ApprovalRequest, DisplayInfo, ErrorCode, ToolName } from '../../shared/types';
import type { ApprovalService, Clock, EventSink } from '../core/contracts';
import { paramsHash } from './canonical';

/**
 * שירות אישורים: כל בקשה חד-פעמית, קשורה לכלי + hash של הפרמטרים המדויקים, ופוקעת.
 * ההחלטה מגיעה מה-renderer (לחיצה של המשתמש), אבל ה-renderer לא קובע מה יתבצע:
 * הביצוע מותר רק אם verifyBinding מאשר שזה בדיוק אותו כלי ואותם פרמטרים שהוצגו.
 */

export type ApprovalOutcome = 'approved' | 'rejected' | 'expired' | 'cancelled';

/** התוצאה כוללת גם approvalId (תוספת תואמת לחוזה) — כדי שהמנוע יוכל לקרוא ל-verifyBinding. */
export interface ApprovalResult {
  approved: boolean;
  outcome: ApprovalOutcome;
  displayId?: string;
  approvalId: string;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface ApprovalServiceDeps {
  clock: Clock;
  emit: EventSink;
  ttlMs?: number;
  idFactory?: () => string;
  setTimer?: (fn: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

interface Entry {
  request: ApprovalRequest;
  tool: ToolName;
  hash: string;
  status: 'pending' | ApprovalOutcome;
  /** האישור כבר נוצל (או נשרף בניסיון קשירה לא תואם). */
  consumed: boolean;
  displayId?: string;
  timer: TimerHandle | null;
  detachAbort: (() => void) | null;
  resolve: (result: ApprovalResult) => void;
  settledAt: number | null;
}

/** כמה בקשות שכבר הוכרעו נשמרות (כדי להחזיר הודעה מדויקת על ניסיון החלטה כפול). */
const MAX_SETTLED_KEPT = 100;

const MSG_UNKNOWN = 'בקשת האישור לא מוכרת. ייתכן שהיא כבר טופלה.';
const MSG_ALREADY = 'בקשת האישור הזו כבר טופלה או שפג תוקפה — אפשר לבקש שוב.';
const MSG_EXPIRED = 'פג תוקף בקשת האישור, והפעולה לא בוצעה. אפשר לבקש שוב.';
const MSG_DISPLAY = 'המסך שנבחר לא נמצא ברשימת המסכים שהוצעו. בחר מסך מהרשימה.';

export type ApprovalServiceImpl = Omit<ApprovalService, 'request'> & {
  request(input: Parameters<ApprovalService['request']>[0]): Promise<ApprovalResult>;
  /** מנקה טיימרים (בסגירת האפליקציה). בקשות פתוחות מבוטלות. */
  dispose(): void;
};

export function createApprovalService(deps: ApprovalServiceDeps): ApprovalServiceImpl {
  const ttlMs = deps.ttlMs ?? 60_000;
  const idFactory = deps.idFactory ?? randomUUID;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: TimerHandle) => clearTimeout(h));
  const entries = new Map<string, Entry>();

  function pruneSettled(): void {
    const settled = [...entries.values()].filter((e) => e.status !== 'pending');
    if (settled.length <= MAX_SETTLED_KEPT) return;
    settled.sort((a, b) => (a.settledAt ?? 0) - (b.settledAt ?? 0));
    for (const e of settled.slice(0, settled.length - MAX_SETTLED_KEPT)) entries.delete(e.request.approvalId);
  }

  function settle(entry: Entry, outcome: ApprovalOutcome, displayId?: string): void {
    if (entry.status !== 'pending') return;
    entry.status = outcome;
    entry.settledAt = deps.clock.now().getTime();
    entry.displayId = displayId;
    if (entry.timer !== null) {
      clearTimer(entry.timer);
      entry.timer = null;
    }
    entry.detachAbort?.();
    entry.detachAbort = null;
    deps.emit({ type: 'approval-resolved', approvalId: entry.request.approvalId, outcome });
    entry.resolve({
      approved: outcome === 'approved',
      outcome,
      ...(outcome === 'approved' && displayId ? { displayId } : {}),
      approvalId: entry.request.approvalId,
    });
  }

  function isExpired(entry: Entry): boolean {
    return deps.clock.now().getTime() >= Date.parse(entry.request.expiresAt);
  }

  function chooseDefaultDisplay(displays: DisplayInfo[] | undefined, requested: string | undefined): string | undefined {
    if (!displays?.length) return undefined;
    if (requested && displays.some((d) => d.id === requested)) return requested;
    return (displays.find((d) => d.primary) ?? displays[0])?.id;
  }

  const service: ApprovalServiceImpl = {
    request(input) {
      const approvalId = idFactory();
      const now = deps.clock.now();
      const displays = input.displays?.length ? input.displays.map((d) => ({ ...d })) : undefined;
      const request: ApprovalRequest = {
        approvalId,
        turnId: input.turnId,
        actionId: input.actionId,
        tool: input.tool,
        action_he: input.texts.action_he,
        target_he: input.texts.target_he,
        impact_he: input.texts.impact_he,
        reason: input.reason,
        ...(input.warning_he ? { warning_he: input.warning_he } : {}),
        expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
        ...(displays ? { displays, defaultDisplayId: chooseDefaultDisplay(displays, input.defaultDisplayId) } : {}),
      };

      // אם התור כבר בוטל — לא מציגים בקשה בכלל
      if (input.signal.aborted) {
        return Promise.resolve({ approved: false, outcome: 'cancelled' as const, approvalId });
      }

      return new Promise<ApprovalResult>((resolve) => {
        const entry: Entry = {
          request,
          tool: input.tool,
          hash: paramsHash(input.tool, input.params),
          status: 'pending',
          consumed: false,
          timer: null,
          detachAbort: null,
          resolve,
          settledAt: null,
        };
        entries.set(approvalId, entry);
        pruneSettled();

        entry.timer = setTimer(() => {
          entry.timer = null;
          settle(entry, 'expired');
        }, ttlMs);
        const onAbort = (): void => settle(entry, 'cancelled');
        input.signal.addEventListener('abort', onAbort, { once: true });
        entry.detachAbort = () => input.signal.removeEventListener('abort', onAbort);

        deps.emit({ type: 'approval-required', request });
      });
    },

    decide(decision) {
      const entry = entries.get(decision.approvalId);
      if (!entry) return fail('APPROVAL_MISMATCH', MSG_UNKNOWN);
      if (entry.status !== 'pending') return fail('APPROVAL_EXPIRED', MSG_ALREADY);
      if (isExpired(entry)) {
        settle(entry, 'expired');
        return fail('APPROVAL_EXPIRED', MSG_EXPIRED);
      }
      if (!decision.approved) {
        settle(entry, 'rejected');
        return { ok: true };
      }
      let displayId: string | undefined;
      const offered = entry.request.displays;
      if (offered?.length) {
        if (decision.displayId !== undefined) {
          if (!offered.some((d) => d.id === decision.displayId)) return fail('APPROVAL_MISMATCH', MSG_DISPLAY);
          displayId = decision.displayId;
        } else {
          displayId = entry.request.defaultDisplayId;
        }
      }
      settle(entry, 'approved', displayId);
      return { ok: true };
    },

    verifyBinding(approvalId, tool, params) {
      const entry = entries.get(approvalId);
      if (!entry || entry.status !== 'approved' || entry.consumed) return false;
      // חד-פעמי: גם ניסיון לא תואם "שורף" את האישור (סימן לשיבוש)
      entry.consumed = true;
      return entry.tool === tool && entry.hash === paramsHash(tool, params);
    },

    pending() {
      const out: ApprovalRequest[] = [];
      for (const entry of [...entries.values()]) {
        if (entry.status !== 'pending') continue;
        if (isExpired(entry)) {
          settle(entry, 'expired');
          continue;
        }
        out.push(entry.request);
      }
      return out;
    },

    cancelTurn(turnId) {
      for (const entry of [...entries.values()]) {
        if (entry.status === 'pending' && entry.request.turnId === turnId) settle(entry, 'cancelled');
      }
    },

    dispose() {
      for (const entry of [...entries.values()]) {
        if (entry.status === 'pending') settle(entry, 'cancelled');
      }
    },
  };
  return service;
}

function fail(code: ErrorCode, message_he: string): { ok: false; code: ErrorCode; message_he: string } {
  return { ok: false, code, message_he };
}
