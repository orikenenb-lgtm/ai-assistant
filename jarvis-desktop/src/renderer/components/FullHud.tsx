/**
 * התצוגה המלאה (~960x680): שורת כותרת, שורת מצב, באנר תזכורות, לוח צד / ליבה+שיחה / פעולות, וסרגל תחתון.
 */
import type { AssistantState } from '../../shared/types';
import { useMediaQuery } from '../hooks/environment';
import { he } from '../i18n/he';
import { useUiState } from '../state/controller';
import { ActionsTimeline } from './ActionsTimeline';
import { ArcCore } from './ArcCore';
import { BottomBar } from './BottomBar';
import { HeaderBar } from './HeaderBar';
import { MissedRemindersBanner } from './Notices';
import { SidePanel } from './SidePanel';
import { TitleBar } from './TitleBar';
import { Transcript } from './Transcript';
import { Waveform } from './Waveform';

export function FullHud({
  state,
  label,
  reducedMotion,
  obscured,
}: {
  state: AssistantState;
  label: string;
  reducedMotion: boolean;
  /** הגדרות או דיאלוג אישור פתוחים: גוף ה-HUD לא נגיש (inert), שורת הכותרת נשארת פעילה לגרירה/סגירה. */
  obscured: boolean;
}) {
  // בחלון צר אין מקום לעמודת פעולות נפרדת — היא עוברת ללשונית בלוח הצד
  const narrow = useMediaQuery('(max-width: 899px)');
  const engineLabel = useUiState((s) => s.engineLabel);
  const showEngineLabel = engineLabel && (state === 'THINKING' || state === 'EXECUTING');

  return (
    <div className="hud" data-state={state}>
      <TitleBar />
      <div className="hud-body" inert={obscured || undefined}>
        <HeaderBar />
        <MissedRemindersBanner />
        <main className="hud-main" data-narrow={narrow ? 'on' : undefined}>
          <SidePanel includeActions={narrow} paused={obscured} />
          <section className="hud-center" aria-label={he.core.regionLabel}>
            <div className="core-stage">
              {/* מתחת לשכבת-על (הגדרות/אישור) הליבה סטטית — אין טעם להנפיש מה שלא רואים */}
              <ArcCore state={state} reducedMotion={reducedMotion || obscured} size="full" />
              <div className="state-readout" role="status" aria-live="polite">
                <span className="state-label">{label}</span>
                {showEngineLabel && <span className="state-sub">{engineLabel}</span>}
              </div>
            </div>
            <Waveform reducedMotion={reducedMotion} />
            <Transcript />
          </section>
          {!narrow && <ActionsTimeline />}
        </main>
        <BottomBar />
      </div>
    </div>
  );
}
