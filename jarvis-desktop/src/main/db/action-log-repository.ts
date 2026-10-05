import type { DatabaseSync } from 'node:sqlite';
import type { ActionLogEntry, ActionLogRepository, Clock } from '../core/contracts';
import type { ActionStatus } from '../../shared/types';
import { normalizeIso, str, type Row } from './sql';

/**
 * יומן פעולות — משמש למניעת כפילות: אותו כלי עם אותם פרמטרים בתוך חלון זמן לא יבוצע שוב.
 * record הוא upsert לפי מזהה הפעולה, כך שעדכון סטטוס של אותה פעולה (running -> succeeded) לא נכשל.
 */

const MAX_SUMMARY = 2000;

function toEntry(row: Row): ActionLogEntry {
  return {
    id: str(row, 'id'),
    turnId: str(row, 'turn_id'),
    tool: str(row, 'tool'),
    paramsHash: str(row, 'params_hash'),
    status: str(row, 'status') as ActionStatus,
    summary: str(row, 'summary'),
    createdAt: str(row, 'created_at'),
  };
}

export function createActionLogRepository(db: DatabaseSync, deps: { clock: Clock }): ActionLogRepository {
  const upsertStmt = db.prepare(
    `INSERT INTO action_log (id, turn_id, tool, params_hash, status, summary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       turn_id = excluded.turn_id,
       tool = excluded.tool,
       params_hash = excluded.params_hash,
       status = excluded.status,
       summary = excluded.summary,
       created_at = excluded.created_at`,
  );
  const findStmt = db.prepare(
    `SELECT id, turn_id, tool, params_hash, status, summary, created_at FROM action_log
     WHERE tool = ? AND params_hash = ? AND status = 'succeeded' AND created_at >= ?
     ORDER BY created_at DESC, rowid DESC
     LIMIT 1`,
  );
  const clearStmt = db.prepare('DELETE FROM action_log');

  return {
    record(entry) {
      const createdAt = normalizeIso(entry.createdAt, deps.clock.now());
      upsertStmt.run(
        entry.id,
        entry.turnId,
        entry.tool,
        entry.paramsHash,
        entry.status,
        entry.summary.slice(0, MAX_SUMMARY),
        createdAt,
      );
    },

    findRecentSuccess(tool, paramsHash, sinceIso) {
      const ms = Date.parse(sinceIso);
      // מועד לא תקין => לא מניחים כפילות (עדיף לבצע מאשר לחסום בטעות)
      if (!Number.isFinite(ms)) return null;
      const row = findStmt.get(tool, paramsHash, new Date(ms).toISOString()) as Row | undefined;
      return row ? toEntry(row) : null;
    },

    clear() {
      clearStmt.run();
    },
  };
}
