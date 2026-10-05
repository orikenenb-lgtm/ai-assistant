/**
 * גזירת מצב התצוגה של JARVIS מתוך הפעילות האמיתית בלבד:
 * מצב המנוע (main), מצב האודיו (מיקרופון/השמעה ב-renderer), בקשת אישור ממתינה ושגיאה פעילה.
 * אין כאן "מצבי ראווה" — כל מצב חייב להתאים למשהו שקורה בפועל.
 */
import type { AssistantState, AudioPhase, EnginePhase } from '../../shared/types';
import { STATE_LABELS, TRANSCRIBING_LABEL } from '../i18n/he';

export interface DisplayStateInput {
  enginePhase: EnginePhase;
  audioPhase: AudioPhase;
  pendingApproval: boolean;
  errorActive: boolean;
}

/**
 * סדר עדיפויות: AWAITING_APPROVAL > LISTENING > EXECUTING > THINKING > SPEAKING > ERROR > IDLE.
 * THINKING כולל גם תמלול (האודיו נשלח ומחכים לטקסט).
 */
export function deriveDisplayState(input: DisplayStateInput): AssistantState {
  const { enginePhase, audioPhase, pendingApproval, errorActive } = input;
  if (pendingApproval || enginePhase === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
  if (audioPhase === 'LISTENING') return 'LISTENING';
  if (enginePhase === 'EXECUTING') return 'EXECUTING';
  if (enginePhase === 'THINKING' || audioPhase === 'TRANSCRIBING') return 'THINKING';
  if (audioPhase === 'SPEAKING') return 'SPEAKING';
  if (errorActive || enginePhase === 'ERROR') return 'ERROR';
  return 'IDLE';
}

/** התווית בעברית למצב — "מתמלל…" כשהחשיבה היא בעצם תמלול. */
export function displayLabel(state: AssistantState, audioPhase: AudioPhase): string {
  if (state === 'THINKING' && audioPhase === 'TRANSCRIBING') return TRANSCRIBING_LABEL;
  return STATE_LABELS[state];
}

export interface DisplayInfoResult {
  state: AssistantState;
  label: string;
}

export function describeDisplayState(input: DisplayStateInput): DisplayInfoResult {
  const state = deriveDisplayState(input);
  return { state, label: displayLabel(state, input.audioPhase) };
}
