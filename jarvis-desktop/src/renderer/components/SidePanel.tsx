/**
 * לוח הצד: "היום" ו"מערכת" (ובחלון צר גם "פעולות", כשאין מקום לעמודה נפרדת).
 */
import { useState } from 'react';
import { he } from '../i18n/he';
import { ActionsList } from './ActionsTimeline';
import { SystemTab } from './SystemTab';
import { Tabs, type TabItem } from './Tabs';
import { TodayTab } from './TodayTab';

type SideTab = 'today' | 'system' | 'actions';

export function SidePanel({ includeActions, paused }: { includeActions: boolean; paused: boolean }) {
  const [tab, setTab] = useState<SideTab>('today');
  const items: Array<TabItem<SideTab>> = [
    { id: 'today', label: he.side.today },
    { id: 'system', label: he.side.system },
  ];
  if (includeActions) items.push({ id: 'actions', label: he.side.actions });
  // אם העמודה הנפרדת חזרה (חלון רחב) והלשונית "פעולות" נעלמה — חוזרים ל"היום"
  const current: SideTab = !includeActions && tab === 'actions' ? 'today' : tab;

  return (
    <aside className="side frame">
      <Tabs items={items} selected={current} onSelect={setTab} idPrefix="side" label={he.side.tabsLabel} />
      <div
        role="tabpanel"
        id={`side-panel-${current}`}
        aria-labelledby={`side-tab-${current}`}
        className="tabpanel panel-scroll"
        tabIndex={0}
      >
        {current === 'today' && <TodayTab />}
        {/* SystemTab מושך נתונים רק כשהוא מוצג — כשעוברים לשונית, הרכיב מתפרק והמשיכה נעצרת */}
        {current === 'system' && <SystemTab paused={paused} />}
        {current === 'actions' && (
          <>
            <p className="panel-sub">{he.actions.subtitle}</p>
            <ActionsList />
          </>
        )}
      </div>
    </aside>
  );
}
