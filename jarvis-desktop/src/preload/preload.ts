import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc-channels';
import type { JarvisApi } from '../shared/api-types';
import type { AssistantEvent, UiCommand } from '../shared/types';

/**
 * ה-preload רץ ב-sandbox ומעביר ל-renderer רק את window.jarvis.
 * כל פונקציה ממופה לערוץ IPC קבוע; אין חשיפה של ipcRenderer, require או process.
 * האימות האמיתי (zod + מקור השולח) מתבצע ב-main.
 */

const invoke = <T>(channel: string, payload?: unknown): Promise<T> => ipcRenderer.invoke(channel, payload) as Promise<T>;

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T): void => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: JarvisApi = {
  version: '0.1.0',
  platform: process.platform,
  assistant: {
    submit: (input) => invoke(IPC.assistantSubmit, input),
    cancel: (turnId) => invoke(IPC.assistantCancel, turnId ? { turnId } : {}),
    approve: (decision) => invoke(IPC.assistantApprove, decision),
    analyzeScreen: (input) => invoke(IPC.assistantAnalyzeScreen, input),
    snapshot: () => invoke(IPC.assistantSnapshot),
    onEvent: (listener) => subscribe<AssistantEvent>(IPC.evtAssistant, listener),
  },
  voice: {
    transcribe: (input) => invoke(IPC.voiceTranscribe, input),
    synthesize: (input) => invoke(IPC.voiceSynthesize, input),
    reportAudioPhase: (phase) => invoke(IPC.voiceReportAudioPhase, { phase }),
  },
  settings: {
    get: () => invoke(IPC.settingsGet),
    update: (patch) => invoke(IPC.settingsUpdate, patch),
    validatePath: (input) => invoke(IPC.settingsValidatePath, input),
    pickPath: (purpose) => invoke(IPC.settingsPickPath, { purpose }),
    detectApps: () => invoke(IPC.settingsDetectApps),
    testOpen: (input) => invoke(IPC.settingsTestOpen, input),
  },
  secrets: {
    status: () => invoke(IPC.secretsStatus),
    set: (name, value) => invoke(IPC.secretsSet, { name, value }),
    clear: (name) => invoke(IPC.secretsClear, { name }),
  },
  data: {
    listTasks: (filter) => invoke(IPC.dataListTasks, { filter }),
    completeTask: (id) => invoke(IPC.dataCompleteTask, { id }),
    listReminders: (filter) => invoke(IPC.dataListReminders, { filter }),
    cancelReminder: (id) => invoke(IPC.dataCancelReminder, { id }),
    acknowledgeReminders: (ids) => invoke(IPC.dataAcknowledgeReminders, { ids }),
    usageSummary: () => invoke(IPC.dataUsageSummary),
    clearHistory: (scope) => invoke(IPC.dataClearHistory, { scope }),
  },
  system: {
    status: () => invoke(IPC.systemStatus),
    reportBattery: (report) => invoke(IPC.systemReportBattery, report),
    testService: (service) => invoke(IPC.systemTestService, { service }),
    listDisplays: () => invoke(IPC.systemListDisplays),
  },
  window: {
    setMode: (mode) => invoke(IPC.windowSetMode, { mode }),
    setAlwaysOnTop: (value) => invoke(IPC.windowSetAlwaysOnTop, { value }),
    minimize: () => invoke(IPC.windowMinimize),
    close: () => invoke(IPC.windowClose),
    quit: () => invoke(IPC.appQuit),
  },
  wakeword: {
    startPorcupine: (sensitivity) => invoke(IPC.wakewordStart, { sensitivity }),
    stopPorcupine: () => invoke(IPC.wakewordStop),
    pushFrames: (samples) => {
      ipcRenderer.send(IPC.wakewordFrames, samples);
    },
  },
  onCommand: (listener) => subscribe<UiCommand>(IPC.evtCommand, listener),
};

contextBridge.exposeInMainWorld('jarvis', Object.freeze(api));
