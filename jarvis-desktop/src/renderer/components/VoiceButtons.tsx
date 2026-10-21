/**
 * כפתור המיקרופון וכפתור העצירה — משותפים לתצוגה המלאה ולקומפקטית.
 * הכפתור משקף את המצב האמיתי: aria-pressed רק כשהמיקרופון באמת מקליט.
 */
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';
import { IconMic, IconStop } from './Icons';

export function MicButton({ size = 'large' }: { size?: 'large' | 'small' }) {
  const controller = useController();
  const audioPhase = useUiState((s) => s.audioPhase);
  const micStarting = useUiState((s) => s.micStarting);

  const listening = audioPhase === 'LISTENING';
  const transcribing = audioPhase === 'TRANSCRIBING';
  const label = listening
    ? he.bottom.micStop
    : micStarting
      ? he.bottom.micBusy
      : transcribing
        ? he.bottom.micTranscribing
        : audioPhase === 'SPEAKING'
          ? he.bottom.micBargeIn
          : he.bottom.micStart;

  return (
    <button
      type="button"
      className="mic-btn"
      data-size={size}
      data-listening={listening ? 'on' : undefined}
      data-busy={micStarting || transcribing ? 'on' : undefined}
      aria-pressed={listening}
      aria-busy={micStarting || transcribing}
      aria-disabled={transcribing || micStarting}
      aria-label={label}
      title={label}
      onClick={() => void controller.toggleListen('ui')}
    >
      <span className="mic-ring" aria-hidden="true" />
      <IconMic size={size === 'large' ? 26 : 18} />
    </button>
  );
}

export function StopButton({ size = 'large' }: { size?: 'large' | 'small' }) {
  const controller = useController();
  const canStop = useUiState((s) => controller.canStop(s));
  return (
    <button
      type="button"
      className="icon-btn stop-btn"
      data-size={size}
      aria-label={he.bottom.stop}
      title={he.bottom.stop}
      disabled={!canStop}
      onClick={() => controller.stop()}
    >
      <IconStop size={size === 'large' ? 20 : 16} />
    </button>
  );
}
