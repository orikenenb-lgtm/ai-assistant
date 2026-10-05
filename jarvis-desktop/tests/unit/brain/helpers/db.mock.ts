import type {
  ActionLogEntry,
  Database,
  HistoryEntry,
  UsageEntry,
} from '../../../../src/main/core/contracts';
import type { ReminderDTO, TaskDTO } from '../../../../src/shared/types';

/**
 * MOCK: מסד נתונים בזיכרון שמממש את ממשקי ה-repository — לבדיקות המנוע בלבד.
 * לא מנסה לשחזר את כל ההתנהגות של SQLite, רק את מה שהמנוע צריך (היסטוריה, יומן פעולות, שימוש).
 */
export interface MockDatabase extends Database {
  readonly historyEntries: HistoryEntry[];
  readonly actionEntries: ActionLogEntry[];
  readonly usageEntries: UsageEntry[];
}

export function createMockDatabase(): MockDatabase {
  const historyEntries: HistoryEntry[] = [];
  const actionEntries: ActionLogEntry[] = [];
  const usageEntries: UsageEntry[] = [];
  const tasks: TaskDTO[] = [];
  const reminders: ReminderDTO[] = [];
  let seq = 0;
  const nextId = (): string => `mock-${++seq}`;

  return {
    historyEntries,
    actionEntries,
    usageEntries,
    tasks: {
      create(input) {
        const t: TaskDTO = {
          id: nextId(),
          title: input.title,
          notes: input.notes ?? null,
          dueDate: input.dueDate ?? null,
          status: 'open',
          createdAt: new Date(0).toISOString(),
          completedAt: null,
        };
        tasks.push(t);
        return t;
      },
      list: (filter) => (filter === 'all' ? [...tasks] : tasks.filter((t) => t.status === 'open')),
      get: (id) => tasks.find((t) => t.id === id) ?? null,
      complete(id) {
        const t = tasks.find((x) => x.id === id);
        if (!t) return null;
        t.status = 'done';
        return t;
      },
      search: (q) => tasks.filter((t) => t.title.includes(q)),
    },
    reminders: {
      create(input) {
        const r: ReminderDTO = {
          id: nextId(),
          text: input.text,
          dueAtUtc: input.dueAtUtc,
          dueLocal_he: input.dueLocal_he,
          timezone: input.timezone,
          status: 'scheduled',
          createdAt: new Date(0).toISOString(),
          firedAt: null,
        };
        reminders.push(r);
        return r;
      },
      list: () => [...reminders],
      get: (id) => reminders.find((r) => r.id === id) ?? null,
      cancel(id) {
        const r = reminders.find((x) => x.id === id);
        if (r) r.status = 'cancelled';
        return r ?? null;
      },
      search: (q) => reminders.filter((r) => r.text.includes(q)),
      dueScheduled: () => [],
      markFired: () => false,
      markMissed: () => false,
      acknowledge: () => 0,
      listMissedUnacknowledged: () => [],
    },
    history: {
      append: (entry) => {
        historyEntries.push({ ...entry });
      },
      recent(limitTurns) {
        const turnIds: string[] = [];
        for (const e of historyEntries) if (!turnIds.includes(e.turnId)) turnIds.push(e.turnId);
        const keep = new Set(turnIds.slice(-limitTurns));
        return historyEntries.filter((e) => keep.has(e.turnId)).map((e) => ({ ...e }));
      },
      prune: () => 0,
      clear: () => {
        historyEntries.length = 0;
      },
    },
    actions: {
      record: (entry) => {
        actionEntries.push({ ...entry });
      },
      findRecentSuccess(tool, hash, sinceIso) {
        const since = Date.parse(sinceIso);
        const matches = actionEntries.filter(
          (e) => e.tool === tool && e.paramsHash === hash && e.status === 'succeeded' && Date.parse(e.createdAt) >= since,
        );
        return matches[matches.length - 1] ?? null;
      },
      clear: () => {
        actionEntries.length = 0;
      },
    },
    usage: {
      record: (entry) => {
        usageEntries.push({ ...entry });
      },
      summary: () => [],
      clear: () => {
        usageEntries.length = 0;
      },
    },
    close: () => undefined,
  };
}
