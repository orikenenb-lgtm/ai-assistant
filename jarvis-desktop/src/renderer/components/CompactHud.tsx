/**
 * תצוגה קומפקטית (~420x150): ליבה קטנה, מצב, שורה אחרונה, מיקרופון/עצירה והרחבה.
 * כל המשטח הוא אזור גרירה, חוץ מהכפתורים.
 */
import type { AssistantState } from '../../shared/types';
import { he } from '../i18n/he';
import { micChip } from '../state/chips';
import { useController, useUiState } from '../state/controller';
import { ArcCore } from './ArcCore';
import { Chip } from './HeaderBar';
import { IconExpand } from './Icons';
import { MicButton, StopButton } from './VoiceButtons';

export function CompactHud({ state, label, reducedMotion }: { state: AssistantState; label: string; reducedMotion: boolean }) {
  const controller = useController();
  const lastReply = useUiState((s) => s.lastReply);
  const lastUser = useUiState((s) => s.lastUser);
  const engineLabel = useUiState((s) => s.engineLabel);
  const audioPhase = useUiState((s) => s.audioPhase);
  const micStarting = useUiState((s) => s.micStarting);
  const micTest = useUiState((s) => s.micTest);
  const missedCount = useUiState((s) => s.missedReminders.length);
  const mic = micChip({ audioPhase, micStarting, micTest });

  const line = lastReply?.text ?? lastUser?.text ?? he.compact.lastLineEmpty;

  return (
    <div className="compact" data-state={state}>
      <ArcCore state={state} reducedMotion={reducedMotion} size="compact" />
      <div className="compact-info">
        <div className="compact-state" role="status" aria-live="polite">
          {label}
          {engineLabel && (state === 'THINKING' || state === 'EXECUTING') && <span className="compact-sub"> · {engineLabel}</span>}
        </div>
        <p className="compact-line" dir="auto" title={line}>
          {line}
        </p>
        <div className="compact-chips">
          {mic.tone === 'red' && <Chip chip={mic} compact />}
          {missedCount > 0 && (
            <button type="button" className="chip chip-btn" data-tone="amber" data-compact="on" onClick={() => void controller.setViewMode('full')}>
              <span className="chip-dot" aria-hidden="true" />
              <span className="chip-text">{he.missed.title(missedCount)}</span>
            </button>
          )}
        </div>
      </div>
      <div className="compact-actions">
        <MicButton size="small" />
        <StopButton size="small" />
        <button
          type="button"
          className="icon-btn"
          data-size="small"
          aria-label={he.compact.expand}
          title={he.compact.expand}
          onClick={() => void controller.setViewMode('full')}
        >
          <IconExpand size={16} />
        </button>
      </div>
    </div>
  );
}
