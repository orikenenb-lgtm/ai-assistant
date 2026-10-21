import { describe, expect, it } from 'vitest';
import { AUDIO_PHASES, ENGINE_PHASES, type AssistantState, type AudioPhase, type EnginePhase } from '../../../src/shared/types';
import { deriveDisplayState, describeDisplayState, displayLabel } from '../../../src/renderer/state/derive';

/** מימוש ייחוס עצמאי לסדר העדיפויות מהמפרט, לבדיקה מלאה של כל הצירופים. */
function expected(engine: EnginePhase, audio: AudioPhase, approval: boolean, error: boolean): AssistantState {
  if (approval || engine === 'AWAITING_APPROVAL') return 'AWAITING_APPROVAL';
  if (audio === 'LISTENING') return 'LISTENING';
  if (engine === 'EXECUTING') return 'EXECUTING';
  if (engine === 'THINKING' || audio === 'TRANSCRIBING') return 'THINKING';
  if (audio === 'SPEAKING') return 'SPEAKING';
  if (error || engine === 'ERROR') return 'ERROR';
  return 'IDLE';
}

describe('deriveDisplayState', () => {
  it('matches the priority table for every combination (7 engine x 4 audio x 2 x 2)', () => {
    let count = 0;
    for (const enginePhase of ENGINE_PHASES) {
      for (const audioPhase of AUDIO_PHASES) {
        for (const pendingApproval of [false, true]) {
          for (const errorActive of [false, true]) {
            expect(deriveDisplayState({ enginePhase, audioPhase, pendingApproval, errorActive }), `${enginePhase}/${audioPhase}/${pendingApproval}/${errorActive}`).toBe(
              expected(enginePhase, audioPhase, pendingApproval, errorActive),
            );
            count++;
          }
        }
      }
    }
    expect(count).toBe(ENGINE_PHASES.length * AUDIO_PHASES.length * 4);
  });

  it.each([
    // [engine, audio, approval, error, expected]
    ['IDLE', 'IDLE', false, false, 'IDLE'],
    ['IDLE', 'LISTENING', false, false, 'LISTENING'],
    ['THINKING', 'LISTENING', false, false, 'LISTENING'],
    ['EXECUTING', 'LISTENING', false, false, 'LISTENING'],
    ['EXECUTING', 'SPEAKING', false, false, 'EXECUTING'],
    ['EXECUTING', 'TRANSCRIBING', false, false, 'EXECUTING'],
    ['THINKING', 'SPEAKING', false, false, 'THINKING'],
    ['IDLE', 'TRANSCRIBING', false, false, 'THINKING'],
    ['IDLE', 'SPEAKING', false, true, 'SPEAKING'],
    ['ERROR', 'SPEAKING', false, false, 'SPEAKING'],
    ['ERROR', 'IDLE', false, false, 'ERROR'],
    ['IDLE', 'IDLE', false, true, 'ERROR'],
    ['IDLE', 'LISTENING', true, false, 'AWAITING_APPROVAL'],
    ['AWAITING_APPROVAL', 'IDLE', false, false, 'AWAITING_APPROVAL'],
    ['EXECUTING', 'SPEAKING', true, true, 'AWAITING_APPROVAL'],
  ] as const)('%s + %s (approval=%s, error=%s) -> %s', (enginePhase, audioPhase, pendingApproval, errorActive, state) => {
    expect(deriveDisplayState({ enginePhase, audioPhase, pendingApproval, errorActive })).toBe(state);
  });
});

describe('display labels (Hebrew)', () => {
  it('uses the exact Hebrew labels', () => {
    expect(displayLabel('IDLE', 'IDLE')).toBe('מוכן');
    expect(displayLabel('LISTENING', 'LISTENING')).toBe('מקשיב…');
    expect(displayLabel('THINKING', 'IDLE')).toBe('חושב…');
    expect(displayLabel('EXECUTING', 'IDLE')).toBe('מבצע…');
    expect(displayLabel('SPEAKING', 'SPEAKING')).toBe('מדבר…');
    expect(displayLabel('AWAITING_APPROVAL', 'IDLE')).toBe('ממתין לאישורך');
    expect(displayLabel('ERROR', 'IDLE')).toBe('שגיאה');
  });

  it('shows "מתמלל…" while transcribing', () => {
    expect(describeDisplayState({ enginePhase: 'IDLE', audioPhase: 'TRANSCRIBING', pendingApproval: false, errorActive: false })).toEqual({
      state: 'THINKING',
      label: 'מתמלל…',
    });
  });
});
