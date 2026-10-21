/**
 * לשונית "היום": משימות להיום (עם סימון כבוצע) ותזכורות קרובות.
 * נטען מחדש כש-main מודיע על שינוי (data-changed).
 */
import { useState } from 'react';
import type { ReminderDTO, TaskDTO } from '../../shared/types';
import { useAsyncData } from '../hooks/useAsyncData';
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';
import { formatDueDate } from '../state/format';
import { IconBell, IconCheck } from './Icons';

interface RowProps {
  onError: (msg: string | null) => void;
  /** אחרי הצלחה מאומתת מ-main — טוענים את הרשימה מחדש (לא סימון אופטימי). */
  onChanged: () => void;
}

function TaskRow({ task, onError, onChanged }: RowProps & { task: TaskDTO }) {
  const controller = useController();
  const [busy, setBusy] = useState(false);
  const complete = async () => {
    setBusy(true);
    onError(null);
    try {
      const res = await controller.api.data.completeTask(task.id);
      if (res.ok) onChanged();
      else onError(res.message_he);
    } catch {
      onError(he.today.loadFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="list-row">
      <button
        type="button"
        className="check-btn"
        aria-label={he.today.completeAria(task.title)}
        title={he.today.complete}
        disabled={busy}
        onClick={() => void complete()}
      >
        <IconCheck size={14} />
      </button>
      <div className="list-main">
        <span className="list-title">{task.title}</span>
        {task.dueDate && <span className="list-sub">{he.today.dueDate(formatDueDate(task.dueDate))}</span>}
      </div>
    </li>
  );
}

function ReminderRow({ reminder, onError, onChanged }: RowProps & { reminder: ReminderDTO }) {
  const controller = useController();
  const [busy, setBusy] = useState(false);
  const cancel = async () => {
    setBusy(true);
    onError(null);
    try {
      const res = await controller.api.data.cancelReminder(reminder.id);
      if (res.ok) onChanged();
      else onError(res.message_he);
    } catch {
      onError(he.today.loadFailed);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="list-row">
      <span className="list-icon" aria-hidden="true">
        <IconBell size={14} />
      </span>
      <div className="list-main">
        <span className="list-title">{reminder.text}</span>
        <span className="list-sub">{reminder.dueLocal_he}</span>
      </div>
      <button
        type="button"
        className="text-btn"
        aria-label={he.today.cancelReminderAria(reminder.text)}
        disabled={busy}
        onClick={() => void cancel()}
      >
        {he.today.cancelReminder}
      </button>
    </li>
  );
}

export function TodayTab() {
  const controller = useController();
  const tasksVersion = useUiState((s) => s.dataVersion.tasks);
  const remindersVersion = useUiState((s) => s.dataVersion.reminders);
  const [actionError, setActionError] = useState<string | null>(null);

  const tasks = useAsyncData(`tasks:${tasksVersion}`, () => controller.api.data.listTasks('today'));
  const reminders = useAsyncData(`reminders:${remindersVersion}`, () => controller.api.data.listReminders('upcoming'));

  return (
    <div className="today">
      {actionError && (
        <p className="inline-error" role="alert">
          {actionError}
        </p>
      )}
      <h3 className="sub-head">{he.today.tasks}</h3>
      {tasks.data === null ? (
        tasks.failed ? (
          <div className="inline-error">
            {he.today.loadFailed}{' '}
            <button type="button" className="text-btn" onClick={tasks.reload}>
              {he.today.retry}
            </button>
          </div>
        ) : (
          <p className="empty-note">{he.today.loading}</p>
        )
      ) : tasks.data.length === 0 ? (
        <p className="empty-note">{he.today.noTasks}</p>
      ) : (
        <ul className="list">
          {tasks.data.map((t) => (
            <TaskRow key={t.id} task={t} onError={setActionError} onChanged={tasks.reload} />
          ))}
        </ul>
      )}

      <h3 className="sub-head">{he.today.reminders}</h3>
      {reminders.data === null ? (
        reminders.failed ? (
          <div className="inline-error">
            {he.today.loadFailed}{' '}
            <button type="button" className="text-btn" onClick={reminders.reload}>
              {he.today.retry}
            </button>
          </div>
        ) : (
          <p className="empty-note">{he.today.loading}</p>
        )
      ) : reminders.data.length === 0 ? (
        <p className="empty-note">{he.today.noReminders}</p>
      ) : (
        <ul className="list">
          {reminders.data.map((r) => (
            <ReminderRow key={r.id} reminder={r} onError={setActionError} onChanged={reminders.reload} />
          ))}
        </ul>
      )}
    </div>
  );
}
