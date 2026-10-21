/**
 * MOCK של window.jarvis לבדיקות הבקר. כל פונקציה היא vi.fn עם ברירת מחדל סבירה,
 * ואפשר לשלוח אירועים ופקודות כאילו הגיעו מ-main.
 */
import { vi } from 'vitest';
import type { JarvisApi } from '../../../src/shared/api-types';
import { defaultSettings, type Settings, type SettingsPatch } from '../../../src/shared/settings-schema';
import type { AssistantEvent, AssistantSnapshot, SystemStatus, UiCommand } from '../../../src/shared/types';

export interface MockJarvis {
  api: JarvisApi;
  /** ההגדרות ש-settings.get מחזיר (אפשר לשנות לפני init). */
  settings: Settings;
  snapshot: AssistantSnapshot;
  emit(event: AssistantEvent): void;
  command(command: UiCommand): void;
  eventListenerCount(): number;
  commandListenerCount(): number;
  /** רצף הדיווחים של מצב האודיו ל-main. */
  audioPhases(): string[];
}

function mergePatch(settings: Settings, patch: SettingsPatch): Settings {
  const next: Record<string, unknown> = { ...settings };
  for (const [key, value] of Object.entries(patch)) {
    const cur = (settings as Record<string, unknown>)[key];
    next[key] = Array.isArray(value) || typeof value !== 'object' || value === null ? value : { ...(cur as object), ...value };
  }
  return next as Settings;
}

export function mockSystemStatus(): SystemStatus {
  return {
    timestamp: '2026-10-05T10:00:00.000Z',
    cpu: { usagePercent: 12, cores: 8, model: 'MOCK CPU' },
    memory: { totalBytes: 16 * 1024 ** 3, usedBytes: 8 * 1024 ** 3, freeBytes: 8 * 1024 ** 3, usagePercent: 50 },
    disks: [],
    battery: { available: false, source: 'none' },
    services: [{ service: 'llm', provider: 'anthropic', configured: true, state: 'ok' }],
    uptimeSec: 100,
    platform: 'win32',
  };
}

export function mockJarvisApi(initial?: { settings?: Settings; snapshot?: AssistantSnapshot }): MockJarvis {
  const eventListeners = new Set<(e: AssistantEvent) => void>();
  const commandListeners = new Set<(c: UiCommand) => void>();
  const state = {
    settings: initial?.settings ?? defaultSettings(),
    snapshot: initial?.snapshot ?? { phase: 'IDLE', activeTurnId: null, pendingApprovals: [], missedReminders: [] },
  };
  let turnCounter = 0;

  const api: JarvisApi = {
    version: '0.1.0-mock',
    platform: 'win32',
    assistant: {
      submit: vi.fn(async () => ({ ok: true as const, turnId: `turn-${++turnCounter}`, mode: 'ai' as const })),
      cancel: vi.fn(async () => ({ cancelled: true })),
      approve: vi.fn(async (d) => ({ ok: true as const, outcome: d.approved ? ('approved' as const) : ('rejected' as const) })),
      analyzeScreen: vi.fn(async () => ({ ok: true as const, turnId: `turn-${++turnCounter}`, mode: 'ai' as const })),
      snapshot: vi.fn(async () => state.snapshot),
      onEvent: vi.fn((listener: (e: AssistantEvent) => void) => {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      }),
    },
    voice: {
      transcribe: vi.fn(async () => ({ ok: true as const, text: 'תפתח את EPLAN', provider: 'mock', durationMs: 1500 })),
      synthesize: vi.fn(async () => ({ ok: true as const, audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/mpeg', provider: 'mock' })),
      cancel: vi.fn(async () => ({ cancelled: true })),
      reportAudioPhase: vi.fn(async () => undefined),
    },
    settings: {
      get: vi.fn(async () => state.settings),
      update: vi.fn(async (patch: SettingsPatch) => {
        state.settings = mergePatch(state.settings, patch);
        return { ok: true as const, settings: state.settings };
      }),
      validatePath: vi.fn(async () => ({ ok: true, exists: true, detectedKind: 'exe' as const, message_he: 'MOCK' })),
      pickPath: vi.fn(async () => null),
      detectApps: vi.fn(async () => []),
      testOpen: vi.fn(async () => ({ ok: true as const, summary_he: 'MOCK' })),
    },
    secrets: {
      status: vi.fn(async () => ({ secureStorageAvailable: true, entries: [] })),
      set: vi.fn(async () => ({ ok: true as const, status: { secureStorageAvailable: true, entries: [] } })),
      clear: vi.fn(async () => ({ secureStorageAvailable: true, entries: [] })),
    },
    data: {
      listTasks: vi.fn(async () => []),
      completeTask: vi.fn(async () => ({ ok: false as const, code: 'NOT_FOUND' as const, message_he: 'MOCK' })),
      listReminders: vi.fn(async () => []),
      cancelReminder: vi.fn(async () => ({ ok: false as const, code: 'NOT_FOUND' as const, message_he: 'MOCK' })),
      acknowledgeReminders: vi.fn(async (ids: string[]) => ({ acknowledged: ids.length })),
      usageSummary: vi.fn(async () => []),
      clearHistory: vi.fn(async () => ({ cleared: [] })),
    },
    system: {
      status: vi.fn(async () => mockSystemStatus()),
      reportBattery: vi.fn(async () => undefined),
      testService: vi.fn(async (service: 'llm' | 'stt' | 'tts') => ({ service, provider: 'mock', configured: true, state: 'ok' as const })),
      listDisplays: vi.fn(async () => []),
    },
    window: {
      setMode: vi.fn(async () => undefined),
      setAlwaysOnTop: vi.fn(async () => undefined),
      minimize: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      quit: vi.fn(async () => undefined),
    },
    wakeword: {
      startPorcupine: vi.fn(async () => ({ ok: true as const, frameLength: 512, sampleRate: 16000, sessionId: '11111111-1111-4111-8111-111111111111' })),
      stopPorcupine: vi.fn(async () => undefined),
      statusPorcupine: vi.fn(async () => ({ state: 'running' as const })),
      pushFrames: vi.fn(),
    },
    onCommand: vi.fn((listener: (c: UiCommand) => void) => {
      commandListeners.add(listener);
      return () => commandListeners.delete(listener);
    }),
  };

  return {
    api,
    get settings() {
      return state.settings;
    },
    set settings(value: Settings) {
      state.settings = value;
    },
    get snapshot() {
      return state.snapshot;
    },
    set snapshot(value: AssistantSnapshot) {
      state.snapshot = value;
    },
    emit(event) {
      for (const l of [...eventListeners]) l(event);
    },
    command(command) {
      for (const l of [...commandListeners]) l(command);
    },
    eventListenerCount: () => eventListeners.size,
    commandListenerCount: () => commandListeners.size,
    audioPhases: () => vi.mocked(api.voice.reportAudioPhase).mock.calls.map((c) => c[0]),
  };
}
