/**
 * Thin, promise-based wrappers around the browser Web Speech API.
 * Speech-to-text: SpeechRecognition (Chrome, Edge, Safari). Text-to-speech:
 * speechSynthesis with a Hebrew voice when the OS has one. Everything degrades
 * to text chat when a piece is missing.
 */

type RecognitionAlternative = { transcript: string };
type RecognitionResult = { isFinal: boolean; 0: RecognitionAlternative };
type RecognitionEvent = { resultIndex: number; results: ArrayLike<RecognitionResult> };
type RecognitionErrorEvent = { error: string };

export type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function canRecognize(): boolean {
  return Boolean(recognitionCtor());
}

export function canSpeak(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickHebrewVoice(): SpeechSynthesisVoice | null {
  const voices = window.speechSynthesis.getVoices();
  const hebrew = voices.filter((v) => /^(he|iw)([-_]|$)/i.test(v.lang));
  if (hebrew.length === 0) return null;
  // Prefer natural/online voices, then female-sounding names common on each OS.
  const score = (v: SpeechSynthesisVoice) =>
    (/natural|online|neural|google/i.test(v.name) ? 4 : 0) + (/carmit|hila|avri|asaf/i.test(v.name) ? 1 : 0) + (v.localService ? 0 : 1);
  return hebrew.sort((a, b) => score(b) - score(a))[0];
}

/** Resolves the best Hebrew voice, waiting briefly for voices to load. */
export async function hebrewVoice(): Promise<SpeechSynthesisVoice | null> {
  if (!canSpeak()) return null;
  if (cachedVoice !== undefined) return cachedVoice;
  const now = pickHebrewVoice();
  if (now || window.speechSynthesis.getVoices().length > 0) {
    cachedVoice = now;
    return now;
  }
  return new Promise((resolve) => {
    const done = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", done);
      cachedVoice = pickHebrewVoice();
      resolve(cachedVoice);
    };
    window.speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, 1500);
  });
}

/** Speak text in Hebrew. Resolves when done, cancelled, or after a safety timeout. */
export function speak(text: string, voice: SpeechSynthesisVoice | null, opts: { pitch?: number } = {}): Promise<void> {
  if (!canSpeak() || !voice) return Promise.resolve();
  const synth = window.speechSynthesis;
  synth.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(text.replace(/₪/g, " שקל "));
    utterance.lang = voice.lang;
    utterance.voice = voice;
    utterance.rate = 1.05;
    if (opts.pitch) utterance.pitch = opts.pitch;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(guard);
      resolve();
    };
    // Some browsers never fire `end` for long utterances; never hang the call.
    const guard = setTimeout(finish, Math.max(4000, text.length * 110));
    utterance.onend = finish;
    utterance.onerror = finish;
    synth.speak(utterance);
  });
}

export function stopSpeaking(): void {
  if (canSpeak()) window.speechSynthesis.cancel();
}

export type ListenOutcome =
  | { kind: "text"; text: string }
  | { kind: "silence" }
  | { kind: "aborted" }
  | { kind: "denied" }
  | { kind: "unavailable" };

/**
 * Listen for one utterance. `onInterim` receives the live partial transcript.
 * Returns a handle so the caller can abort (e.g. when the visitor types).
 */
export function listenOnce(onInterim: (text: string) => void): { promise: Promise<ListenOutcome>; abort: () => void } {
  const Ctor = recognitionCtor();
  if (!Ctor) return { promise: Promise.resolve({ kind: "unavailable" }), abort: () => {} };

  const rec = new Ctor();
  rec.lang = "he-IL";
  rec.continuous = false;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  let finalText = "";
  let outcome: ListenOutcome | null = null;
  let aborted = false;

  const promise = new Promise<ListenOutcome>((resolve) => {
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      onInterim((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") outcome = { kind: "denied" };
      else if (e.error === "network" || e.error === "language-not-supported") outcome = { kind: "unavailable" };
      else if (e.error === "aborted") outcome = { kind: "aborted" };
      else outcome = { kind: "silence" };
    };
    rec.onend = () => {
      if (aborted) return resolve({ kind: "aborted" });
      const text = finalText.trim();
      if (text) return resolve({ kind: "text", text });
      resolve(outcome ?? { kind: "silence" });
    };
    try {
      rec.start();
    } catch {
      resolve({ kind: "unavailable" });
    }
  });

  return {
    promise,
    abort: () => {
      aborted = true;
      try {
        rec.abort();
      } catch {}
    },
  };
}
