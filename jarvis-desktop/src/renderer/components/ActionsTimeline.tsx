/**
 * ציר הפעולות: כרטיס לכל ActionRecord, עם סטטוס בעברית ותג "אומת ע״י הכלי".
 * הסטטוס מגיע מהקוד המקומי (main) — לא מהטקסט של המודל — ולכן מוצג בנפרד מהתשובה.
 */
import type { ActionRecord } from '../../shared/types';
import { ACTION_STATUS_LABELS, he } from '../i18n/he';
import { useUiState } from '../state/controller';
import { formatShortTime } from '../state/format';

function ActionCard({ action }: { action: ActionRecord }) {
  return (
    <li className="action-card" data-status={action.status}>
      <div className="action-top">
        <span className="action-title">{action.title}</span>
        <span className="status-chip" data-status={action.status}>
          {ACTION_STATUS_LABELS[action.status]}
        </span>
      </div>
      {action.verified && <span className="verified-badge">{he.actions.verified}</span>}
      {action.detail && <p className="action-detail">{action.detail}</p>}
      <div className="action-meta">
        <span className="mono" dir="ltr">
          {action.tool}
        </span>
        <time dir="ltr" dateTime={action.finishedAt ?? action.startedAt}>
          {formatShortTime(action.finishedAt ?? action.startedAt)}
        </time>
      </div>
    </li>
  );
}

export function ActionsList() {
  const actions = useUiState((s) => s.actions);
  if (actions.length === 0) return <p className="empty-note">{he.actions.empty}</p>;
  // החדשה ביותר למעלה
  const ordered = [...actions].reverse();
  return (
    <ol className="action-list" aria-live="polite">
      {ordered.map((a) => (
        <ActionCard key={a.id} action={a} />
      ))}
    </ol>
  );
}

export function ActionsTimeline() {
  return (
    <section className="actions frame" aria-labelledby="actions-title">
      <header className="panel-head">
        <h2 id="actions-title">{he.actions.title}</h2>
        <span className="panel-sub">{he.actions.subtitle}</span>
      </header>
      <div className="panel-scroll">
        <ActionsList />
      </div>
    </section>
  );
}
