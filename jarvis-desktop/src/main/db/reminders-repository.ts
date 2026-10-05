import type { DatabaseSync } from 'node:sqlite';
import type { Clock, ReminderRepository } from '../core/contracts';
import type { ReminderDTO, ReminderStatus } from '../../shared/types';
import { normalizeForMatch } from '../../shared/text-normalize';
import { rankByText } from './text-search';
import { changes, str, strOrNull, withTransaction, type Row } from './sql';

/**
 * מאגר התזכורות. מחזור החיים:
 *   scheduled -> fired     (התראה הוצגה בזמן, בתוך חלון החסד)
 *   scheduled -> missed    (המחשב/JARVIS היו כבויים או ישנים במועד)
 *   scheduled|missed -> cancelled
 *   fired|missed -> acknowledged (המשתמש ראה)
 * המעברים מ-scheduled הם UPDATE יחיד מותנה בסטטוס, כך שרק מבצע אחד "זוכה" —
 * גם כששני חיבורים (שני מופעים) עובדים על אותו קובץ. זה מה שמונע התראה כפולה.
 */

const LIST_ALL_LIMIT = 500;
const MAX_TEXT = 1000;
const STATUSES: readonly ReminderStatus[] = ['scheduled', 'fired', 'missed', 'cancelled', 'acknowledged'];

const COLUMNS = 'id, text, due_at_utc, due_local_he, timezone, status, created_at, fired_at';

function toReminder(row: Row): ReminderDTO {
  const status = str(row, 'status') as ReminderStatus;
  return {
    id: str(row, 'id'),
    text: str(row, 'text'),
    dueAtUtc: str(row, 'due_at_utc'),
    dueLocal_he: str(row, 'due_local_he'),
    timezone: str(row, 'timezone'),
    status: STATUSES.includes(status) ? status : 'scheduled',
    createdAt: str(row, 'created_at'),
    firedAt: strOrNull(row, 'fired_at'),
  };
}

export class ReminderValidationError extends Error {
  constructor(public readonly message_he: string) {
    super(message_he);
    this.name = 'ReminderValidationError';
  }
}

export function createReminderRepository(
  db: DatabaseSync,
  deps: { clock: Clock; idFactory: () => string },
): ReminderRepository {
  const insertStmt = db.prepare(
    `INSERT INTO reminders (id, text, text_norm, due_at_utc, timezone, due_local_he, status, created_at, updated_at, fired_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, NULL, 0)`,
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM reminders WHERE id = ? AND deleted = 0`);
  const listUpcomingStmt = db.prepare(
    `SELECT ${COLUMNS} FROM reminders
     WHERE deleted = 0 AND status = 'scheduled'
     ORDER BY due_at_utc ASC, created_at ASC`,
  );
  const listMissedStmt = db.prepare(
    `SELECT ${COLUMNS} FROM reminders
     WHERE deleted = 0 AND status = 'missed'
     ORDER BY due_at_utc ASC, created_at ASC`,
  );
  const listAllStmt = db.prepare(
    `SELECT ${COLUMNS} FROM reminders
     WHERE deleted = 0
     ORDER BY due_at_utc DESC
     LIMIT ?`,
  );
  // ביטול אפשרי לתזכורת מתוזמנת, או "שחרור" של תזכורת שהוחמצה
  const cancelStmt = db.prepare(
    `UPDATE reminders SET status = 'cancelled', updated_at = ?
     WHERE id = ? AND deleted = 0 AND status IN ('scheduled', 'missed')`,
  );
  const searchSourceStmt = db.prepare(
    `SELECT ${COLUMNS}, text_norm FROM reminders
     WHERE deleted = 0 AND status IN ('scheduled', 'missed')
     ORDER BY due_at_utc ASC`,
  );
  const dueStmt = db.prepare(
    `SELECT ${COLUMNS} FROM reminders
     WHERE deleted = 0 AND status = 'scheduled' AND due_at_utc <= ?
     ORDER BY due_at_utc ASC, created_at ASC`,
  );
  const markFiredStmt = db.prepare(
    `UPDATE reminders SET status = 'fired', fired_at = ?, updated_at = ?
     WHERE id = ? AND status = 'scheduled' AND deleted = 0`,
  );
  const markMissedStmt = db.prepare(
    `UPDATE reminders SET status = 'missed', updated_at = ?
     WHERE id = ? AND status = 'scheduled' AND deleted = 0`,
  );
  const acknowledgeStmt = db.prepare(
    `UPDATE reminders SET status = 'acknowledged', updated_at = ?
     WHERE id = ? AND status IN ('missed', 'fired') AND deleted = 0`,
  );

  const nowIso = (): string => deps.clock.now().toISOString();
  const read = (id: string): ReminderDTO | null => {
    const row = getStmt.get(id) as Row | undefined;
    return row ? toReminder(row) : null;
  };

  return {
    create(input) {
      const text = input.text.trim();
      if (!text) throw new ReminderValidationError('טקסט התזכורת ריק.');
      if (text.length > MAX_TEXT) throw new ReminderValidationError('טקסט התזכורת ארוך מדי.');
      const dueMs = Date.parse(input.dueAtUtc);
      if (!Number.isFinite(dueMs)) throw new ReminderValidationError('מועד התזכורת לא תקין.');
      if (!input.timezone.trim()) throw new ReminderValidationError('אזור הזמן של התזכורת חסר.');
      if (!input.dueLocal_he.trim()) throw new ReminderValidationError('תיאור המועד של התזכורת חסר.');
      // פורמט אחיד (toISOString) — ההשוואה ב-dueScheduled היא מילונית
      const dueAtUtc = new Date(dueMs).toISOString();
      const id = deps.idFactory();
      const now = nowIso();
      insertStmt.run(id, text, normalizeForMatch(text), dueAtUtc, input.timezone, input.dueLocal_he, now, now);
      return {
        id,
        text,
        dueAtUtc,
        dueLocal_he: input.dueLocal_he,
        timezone: input.timezone,
        status: 'scheduled',
        createdAt: now,
        firedAt: null,
      };
    },

    list(filter) {
      let rows: Row[];
      if (filter === 'upcoming') rows = listUpcomingStmt.all() as Row[];
      else if (filter === 'missed') rows = listMissedStmt.all() as Row[];
      else rows = listAllStmt.all(LIST_ALL_LIMIT) as Row[];
      return rows.map(toReminder);
    },

    get(id) {
      return read(id);
    },

    cancel(id) {
      cancelStmt.run(nowIso(), id);
      return read(id);
    },

    search(query) {
      if (!normalizeForMatch(query)) return [];
      const rows = searchSourceStmt.all() as Row[];
      return rankByText(query, rows, (r) => str(r, 'text_norm')).map((r) => toReminder(r.item));
    },

    dueScheduled(nowUtcIso) {
      const ms = Date.parse(nowUtcIso);
      if (!Number.isFinite(ms)) return [];
      return (dueStmt.all(new Date(ms).toISOString()) as Row[]).map(toReminder);
    },

    markFired(id, firedAtUtcIso) {
      const ms = Date.parse(firedAtUtcIso);
      const firedAt = Number.isFinite(ms) ? new Date(ms).toISOString() : nowIso();
      return changes(markFiredStmt.run(firedAt, nowIso(), id)) === 1;
    },

    markMissed(id) {
      return changes(markMissedStmt.run(nowIso(), id)) === 1;
    },

    acknowledge(ids) {
      const unique = [...new Set(ids)];
      if (unique.length === 0) return 0;
      const now = nowIso();
      return withTransaction(db, () => {
        let total = 0;
        for (const id of unique) total += changes(acknowledgeStmt.run(now, id));
        return total;
      });
    },

    listMissedUnacknowledged() {
      return (listMissedStmt.all() as Row[]).map(toReminder);
    },
  };
}
