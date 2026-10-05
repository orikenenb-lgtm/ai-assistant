/**
 * חישוב "צ'יפים" של מצב (מיקרופון, מילת הפעלה, חיבור AI) — טהור, כדי שיהיה קל לבדוק
 * שהמיקרופון מוצג כפעיל אך ורק כשהוא באמת פתוח.
 */
import type { Settings } from '../../shared/settings-schema';
import type { AudioPhase, ServiceStatus } from '../../shared/types';
import { he } from '../i18n/he';
import type { MicTestState, WakeView } from './controller';

export type ChipTone = 'red' | 'cyan' | 'amber' | 'green' | 'dim';

export interface ChipView {
  tone: ChipTone;
  text: string;
  title?: string;
  pulse?: boolean;
}

export function micChip(input: { audioPhase: AudioPhase; micStarting: boolean; micTest: MicTestState }): ChipView {
  if (input.audioPhase === 'LISTENING') return { tone: 'red', text: he.header.micActive, pulse: true };
  if (input.micTest === 'meter' || input.micTest === 'recording') return { tone: 'red', text: he.header.micTest, pulse: true };
  if (input.micStarting) return { tone: 'amber', text: he.header.micStarting };
  return { tone: 'dim', text: he.header.micOff };
}

/** null = מילת ההפעלה כבויה בהגדרות (לא מציגים צ'יפ). */
export function wakeChip(wake: WakeView): ChipView | null {
  switch (wake.status) {
    case 'off':
      return null;
    case 'listening':
      return { tone: 'cyan', text: he.header.wakeListening };
    case 'paused':
      return { tone: 'dim', text: he.header.wakePaused };
    case 'loading':
      return { tone: 'dim', text: he.header.wakeLoading };
    case 'stopped':
      return { tone: 'dim', text: he.header.wakeOff };
    case 'error':
      return { tone: 'amber', text: he.header.wakeError, title: wake.error ?? undefined };
  }
}

export function aiChip(settings: Settings | null, services: readonly ServiceStatus[]): ChipView {
  const model = settings?.ai.model;
  if (settings?.ai.brainMode === 'local-only') return { tone: 'dim', text: he.header.aiLocalOnly };
  const llm = services.find((s) => s.service === 'llm');
  if (!llm) return { tone: 'dim', text: he.header.aiUnknown, title: model };
  switch (llm.state) {
    case 'ok':
      return { tone: 'green', text: he.header.aiOk, title: model };
    case 'not_configured':
      return { tone: 'amber', text: he.header.aiNotConfigured, title: llm.lastError_he ?? model };
    case 'error':
      return { tone: 'red', text: he.header.aiError, title: llm.lastError_he ?? model };
    case 'local':
      return { tone: 'dim', text: he.header.aiLocalOnly };
    case 'unknown':
      return { tone: 'dim', text: he.header.aiUnknown, title: model };
  }
}
