/**
 * נקודת הכניסה של שכבת האודיו ב-renderer.
 * החתימות כאן קבועות וצוות הממשק נשען עליהן; המימושים בקבצים הסמוכים, עם תלויות מוזרקות
 * (getUserMedia, AudioContext, speechSynthesis, טיימרים) כדי שאפשר לבדוק אותם ב-node.
 */
import { isLikelyEcho as echoCheck } from './echo';
import { createMicCaptureWith } from './mic-capture';
import { browserMicCaptureDeps } from './mic-graph';
import { browserSpeechPlaybackDeps, createSpeechPlaybackWith } from './speech-playback';
import { browserSystemSpeakerDeps, createSystemSpeakerWith } from './system-speaker';
import type { EchoCheck, MicCapture, SpeechPlayback, SystemSpeaker, WakeWordDetector } from './types';
import { createWakeWordDetectorFor } from './wakeword';

export * from './types';

/** הקלטה מהמיקרופון -> WAV 16kHz מונו, עם VAD. אובייקט אחד אפשר להפעיל שוב ושוב (הקלטה אחת בכל רגע). */
export function createMicCapture(): MicCapture {
  return createMicCaptureWith(browserMicCaptureDeps());
}

/** השמעת TTS מוקלט (mp3/wav/ogg) עם עוצמה ו-waveform אמיתיים. */
export function createSpeechPlayback(): SpeechPlayback {
  return createSpeechPlaybackWith(browserSpeechPlaybackDeps());
}

/** קול מערכת של Windows. אין אות אודיו זמין במסלול הזה — אין לצייר waveform בזמן הקראה. */
export function createSystemSpeaker(): SystemSpeaker {
  return createSystemSpeakerWith(browserSystemSpeakerDeps());
}

/** מילת הפעלה מקומית. בגרסה הזו המנוע עוד לא מותקן: start() נכשל עם הודעה ברורה. */
export function createWakeWordDetector(engine: 'openwakeword' | 'porcupine'): WakeWordDetector {
  return createWakeWordDetectorFor(engine);
}

export const isLikelyEcho: EchoCheck = echoCheck;
