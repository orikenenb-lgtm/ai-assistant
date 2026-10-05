import type { DatabaseSync } from 'node:sqlite';
import type { Clock, TaskRepository } from '../core/contracts';
import type { TaskDTO } from '../../shared/types';
import { normalizeForMatch } from '../../shared/text-normalize';
import { parseLocalDate } from '../time/time';
import { rankByText } from './text-search';
import { str, strOrNull, type Row } from './sql';

/**
 * מאגר המשימות. מחיקה רכה בלבד (deleted=1) כדי שסנכרון עתידי יוכל להפיץ מחיקות.
 * כל שאילתה מסננת deleted=0.
 */

/** תקרה להחזרה ב-'all' — הרשימה מוצגת/מוקראת, אין טעם בעשרות אלפי שורות. */
const LIST_ALL_LIMIT = 500;
const MAX_TITLE = 500;
const MAX_NOTES = 4000;

const COLUMNS = 'id, title, notes, due_date, status, created_at, completed_at';

function toTask(row: Row): TaskDTO {
  const status = str(row, 'status');
  return {
    id: str(row, 'id'),
    title: str(row, 'title'),
    notes: strOrNull(row, 'notes'),
    dueDate: strOrNull(row, 'due_date'),
    status: status === 'done' || status === 'cancelled' ? status : 'open',
    createdAt: str(row, 'created_at'),
    completedAt: strOrNull(row, 'completed_at'),
  };
}

export class TaskValidationError extends Error {
  constructor(public readonly message_he: string) {
    super(message_he);
    this.name = 'TaskValidationError';
  }
}

export function createTaskRepository(db: DatabaseSync, deps: { clock: Clock; idFactory: () => string }): TaskRepository {
  const insertStmt = db.prepare(
    `INSERT INTO tasks (id, title, title_norm, notes, due_date, status, source, created_at, updated_at, completed_at, deleted)
     VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, NULL, 0)`,
  );
  const getStmt = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ? AND deleted = 0`);
  // היום = פתוחות שתאריך היעד שלהן היום או קודם (באיחור), או בלי תאריך
  const listTodayStmt = db.prepare(
    `SELECT ${COLUMNS} FROM tasks
     WHERE deleted = 0 AND status = 'open' AND (due_date IS NULL OR due_date <= ?)
     ORDER BY due_date IS NULL, due_date ASC, created_at ASC`,
  );
  const listOpenStmt = db.prepare(
    `SELECT ${COLUMNS} FROM tasks
     WHERE deleted = 0 AND status = 'open'
     ORDER BY due_date IS NULL, due_date ASC, created_at ASC`,
  );
  const listAllStmt = db.prepare(
    `SELECT ${COLUMNS} FROM tasks
     WHERE deleted = 0
     ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC
     LIMIT ?`,
  );
  const completeStmt = db.prepare(
    `UPDATE tasks SET status = 'done', completed_at = ?, updated_at = ?
     WHERE id = ? AND deleted = 0 AND status = 'open'`,
  );
  const searchSourceStmt = db.prepare(
    `SELECT ${COLUMNS}, title_norm FROM tasks
     WHERE deleted = 0 AND status = 'open'
     ORDER BY created_at DESC`,
  );

  const nowIso = (): string => deps.clock.now().toISOString();

  return {
    create(input) {
      const title = input.title.trim();
      if (!title) throw new TaskValidationError('כותרת המשימה ריקה.');
      if (title.length > MAX_TITLE) throw new TaskValidationError('כותרת המשימה ארוכה מדי.');
      const notes = input.notes?.trim() ? input.notes.trim().slice(0, MAX_NOTES) : null;
      const dueDate = input.dueDate ?? null;
      if (dueDate !== null && !parseLocalDate(dueDate)) {
        throw new TaskValidationError(`תאריך היעד "${dueDate}" לא תקין.`);
      }
      const id = deps.idFactory();
      const now = nowIso();
      insertStmt.run(id, title, normalizeForMatch(title), notes, dueDate, input.source, now, now);
      return {
        id,
        title,
        notes,
        dueDate,
        status: 'open',
        createdAt: now,
        completedAt: null,
      };
    },

    list(filter, today) {
      let rows: Row[];
      if (filter === 'today') rows = listTodayStmt.all(today) as Row[];
      else if (filter === 'open') rows = listOpenStmt.all() as Row[];
      else rows = listAllStmt.all(LIST_ALL_LIMIT) as Row[];
      return rows.map(toTask);
    },

    get(id) {
      const row = getStmt.get(id) as Row | undefined;
      return row ? toTask(row) : null;
    },

    complete(id) {
      // עדכון מותנה בסטטוס 'open' — קריאה חוזרת לא משנה את completed_at (אידמפוטנטי)
      const now = nowIso();
      completeStmt.run(now, now, id);
      const row = getStmt.get(id) as Row | undefined;
      return row ? toTask(row) : null;
    },

    search(query) {
      if (!normalizeForMatch(query)) return [];
      const rows = searchSourceStmt.all() as Row[];
      // הדירוג על העמודה המנורמלת שנשמרה בזמן היצירה
      return rankByText(query, rows, (r) => str(r, 'title_norm')).map((r) => toTask(r.item));
    },
  };
}
