import type { DatabaseSync } from 'node:sqlite';
import type { Clock, HistoryEntry, HistoryRepository } from '../core/contracts';
import { changes, normalizeIso, str, withTransaction, type Row } from './sql';

/**
 * היסטוריית שיחה (טקסט בלבד: מה המשתמש אמר ומה JARVIS ענה).
 * נשמרת רק אם המשתמש מאפשר זאת בהגדרות, ונמחקת לפי מדיניות השמירה (prune).
 */

const DAY_MS = 24 * 3600 * 1000;
/** תקרת בטיחות למספר התורות שמוחזרים, גם אם התבקש יותר. */
const MAX_TURNS = 100;

function toEntry(row: Row): HistoryEntry {
  return {
    turnId: str(row, 'turn_id'),
    role: str(row, 'role') === 'assistant' ? 'assistant' : 'user',
    text: str(row, 'text'),
    mode: str(row, 'mode') === 'local' ? 'local' : 'ai',
    createdAt: str(row, 'created_at'),
  };
}

/** עזרים מעבר לחוזה HistoryRepository (contracts.ts). */
export interface HistoryRepositoryExtras {
  /**
   * כתיבת כל הרשומות של תור אחד (בדרך כלל user + assistant) בטרנזקציה אחת:
   * או שכולן נשמרות או שאף אחת — אין "שאלה בלי תשובה" בהיסטוריה אחרי קריסה או דיסק מלא.
   */
  appendTurn(entries: readonly HistoryEntry[]): void;
}

export function createHistoryRepository(
  db: DatabaseSync,
  deps: { clock: Clock },
): HistoryRepository & HistoryRepositoryExtras {
  const insertStmt = db.prepare('INSERT INTO history (turn_id, role, text, mode, created_at) VALUES (?, ?, ?, ?, ?)');
  // N התורות האחרונים לפי הרשומה האחרונה של כל תור, ואז כל הרשומות שלהם בסדר כרונולוגי
  const recentStmt = db.prepare(
    `WITH last_turns AS (
       SELECT turn_id, MAX(id) AS last_id FROM history GROUP BY turn_id ORDER BY last_id DESC LIMIT ?
     )
     SELECT h.turn_id, h.role, h.text, h.mode, h.created_at
     FROM history h JOIN last_turns t ON t.turn_id = h.turn_id
     ORDER BY h.id ASC`,
  );
  const pruneStmt = db.prepare('DELETE FROM history WHERE created_at < ?');
  const clearStmt = db.prepare('DELETE FROM history');

  return {
    append(entry) {
      const createdAt = normalizeIso(entry.createdAt, deps.clock.now());
      insertStmt.run(entry.turnId, entry.role, entry.text, entry.mode, createdAt);
    },

    appendTurn(entries) {
      if (entries.length === 0) return;
      const fallback = deps.clock.now();
      withTransaction(db, () => {
        for (const e of entries) insertStmt.run(e.turnId, e.role, e.text, e.mode, normalizeIso(e.createdAt, fallback));
      });
    },

    recent(limitTurns) {
      const n = Math.min(Math.floor(limitTurns), MAX_TURNS);
      if (!Number.isFinite(n) || n <= 0) return [];
      return (recentStmt.all(n) as Row[]).map(toEntry);
    },

    prune(retentionDays, now) {
      if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
      const cutoff = new Date(now.getTime() - retentionDays * DAY_MS).toISOString();
      return changes(pruneStmt.run(cutoff));
    },

    clear() {
      clearStmt.run();
    },
  };
}
