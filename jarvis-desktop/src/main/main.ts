/**
 * JARVIS Desktop — נקודת הכניסה של תהליך main (composition root).
 * כאן מרכיבים את כל המודולים: הגדרות, מפתחות, מסד נתונים, כלים, מנוע שיחה, קול,
 * תזכורות, מגש מערכת, קיצור מקשים וחלון ה-HUD.
 */
import {
  app,
  type BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  Notification,
  powerMonitor,
  protocol,
  safeStorage,
  screen,
  session,
} from 'electron';
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { IPC } from '../shared/ipc-channels';
import type { AssistantEvent, AudioPhase, EnginePhase, ServiceStatus, UiCommand } from '../shared/types';
import type { Settings } from '../shared/settings-schema';
import { systemClock, type Database, type EventSink } from './core/contracts';
import { createFileLogger } from './app/logger';
import { APP_SCHEME, developmentCsp, serveAppRequest } from './app/protocol';
import { hardenSession, hardenWebContentsCreation } from './app/security';
import { applyWindowMode, createMainWindow, preloadPathFor, rendererRootFor } from './app/windows';
import { createJarvisTray, type JarvisTray } from './app/tray';
import { registerIpc } from './app/ipc';
import { createSettingsStore } from './settings/settings-store';
import { createSecretStore } from './secrets/secret-store';
import { createVoiceService } from './voice/voice-service';
import { openDatabase } from './db/database';
import { todayLocal } from './time/time';
import { createReminderScheduler } from './reminders/scheduler';
import { createElectronNotifier } from './reminders/notifier';
import { createLauncherService } from './launcher/launcher';
import { createElectronLauncherAdapter } from './launcher/electron-adapter';
import { createSystemStatusService } from './system/system-status';
import { createScreenCaptureService } from './screen/capture';
import { createLauncherTools } from './tools/launcher-tools';
import { createSystemTool } from './tools/system-tools';
import { createScreenTool } from './tools/screen-tools';
import { createTaskTools } from './tools/task-tools';
import { createReminderTools } from './tools/reminder-tools';
import { createToolRegistry } from './tools/registry';
import { createApprovalService } from './permissions/approvals';
import { createAnthropicLlmClient, createAnthropicVisionAnalyzer } from './ai/llm-client';
import { createConversationEngine } from './conversation/engine';
import { createPorcupineService } from './wakeword/porcupine-service';

const devServerUrl = process.env.JARVIS_DEV_SERVER_URL ?? null;
const devOrigin = devServerUrl ? new URL(devServerUrl).origin : null;
const isDev = Boolean(devServerUrl) || process.env.JARVIS_BUILD_MODE === 'development';

// בדיקות E2E מריצות עותק נקי עם תיקיית נתונים זמנית (רק כשהאפליקציה לא ארוזה)
if (!app.isPackaged && process.env.JARVIS_USER_DATA_DIR) {
  app.setPath('userData', process.env.JARVIS_USER_DATA_DIR);
}

// app:// חייב להירשם לפני ready
protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
]);

// מזהה האפליקציה ב-Windows — נדרש להתראות (toast) ולקיבוץ בשורת המשימות
app.setAppUserModelId('com.ori.jarvis');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const clock = systemClock;
  const userData = app.getPath('userData');

  let verbose = false;
  const logger = createFileLogger({ dir: join(userData, 'logs'), clock, isVerbose: () => verbose, mirrorToConsole: isDev });
  logger.info('app.starting', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform });

  const settings = createSettingsStore({ file: join(userData, 'settings.json'), logger });
  verbose = settings.get().privacy.verboseLogs;

  const secrets = createSecretStore({ file: join(userData, 'secrets.json'), safeStorage, logger, env: process.env });
  await secrets.init();

  // מסד הנתונים המקומי. אם הקובץ לא נפתח — ממשיכים בזיכרון ומודיעים למשתמש (בלי לאבד את JARVIS כולו).
  let db: Database;
  let dbWarning: string | null = null;
  try {
    db = openDatabase(join(userData, 'jarvis.db'), { clock });
  } catch (err) {
    logger.error('db.open_failed', { error: err instanceof Error ? err.message : String(err) });
    db = openDatabase(':memory:', { clock });
    dbWarning = 'לא הצלחתי לפתוח את קובץ הנתונים. משימות ותזכורות יישמרו רק עד סגירת JARVIS.';
  }

  // ---------- חלון ואירועים ----------
  let mainWindow: BrowserWindow | null = null;
  let isQuitting = false;
  let tray: JarvisTray | null = null;
  let enginePhase: EnginePhase = 'IDLE';
  let audioPhase: AudioPhase = 'IDLE';

  const sendToRenderer = (channel: string, payload: unknown): void => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  };
  const emit: EventSink = (event: AssistantEvent) => {
    if (event.type === 'phase') {
      enginePhase = event.phase;
      tray?.update({ phase: enginePhase });
    }
    sendToRenderer(IPC.evtAssistant, event);
  };
  const sendCommand = (cmd: UiCommand): void => sendToRenderer(IPC.evtCommand, cmd);

  const showWindow = (): void => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  // ---------- שירותים ----------
  const voice = createVoiceService({ getSettings: () => settings.get(), secrets, usage: db.usage, logger, clock });
  const llm = createAnthropicLlmClient({
    getApiKey: () => secrets.get('anthropicApiKey'),
    getModel: () => settings.get().ai.model,
    logger,
    usage: db.usage,
    clock,
  });
  const vision = createAnthropicVisionAnalyzer({
    getApiKey: () => secrets.get('anthropicApiKey'),
    getModel: () => settings.get().ai.model,
    logger,
    usage: db.usage,
    clock,
  });
  const llmStatus: { value: ServiceStatus | null } = { value: null };

  const configuredServices = (): ServiceStatus[] => {
    const s = settings.get();
    const hasKey = Boolean(secrets.get('anthropicApiKey'));
    const llmEntry: ServiceStatus =
      llmStatus.value && llmStatus.value.provider === s.ai.model
        ? llmStatus.value
        : {
            service: 'llm',
            provider: s.ai.model,
            configured: hasKey,
            state: s.ai.brainMode === 'local-only' ? 'local' : hasKey ? 'unknown' : 'not_configured',
          };
    return [llmEntry, ...voice.configuredStatuses()];
  };

  const system = createSystemStatusService({
    logger,
    clock,
    getConfiguredServices: configuredServices,
    diskRoots: () => {
      // כוננים של הפרויקטים המוגדרים (למשל D:\) בנוסף לכונן המערכת
      const roots = new Set<string>();
      for (const p of settings.get().launcher.projects) {
        const m = p.path.match(/^([A-Za-z]:)[\\/]/);
        if (m) roots.add(`${m[1]!.toUpperCase()}\\`);
      }
      return [...roots];
    },
  });

  const launcher = createLauncherService({
    adapter: createElectronLauncherAdapter(),
    stat: (p) => stat(p),
    readdir: (p) => readdir(p),
    logger,
    env: process.env,
  });

  const screenCapture = createScreenCaptureService({ desktopCapturer, screen, logger });

  const notifier = createElectronNotifier({ onClick: showWindow, logger });
  const scheduler = createReminderScheduler({ db, clock, notifier, emit, logger, getSettings: () => settings.get() });

  const registry = createToolRegistry([
    ...createLauncherTools(launcher, () => settings.get()),
    createSystemTool(system),
    ...createTaskTools({ db, clock }),
    ...createReminderTools({ db, clock, onCreated: () => scheduler.checkNow('created') }),
    createScreenTool({ screen: screenCapture, vision, getSettings: () => settings.get() }),
  ]);

  const approvals = createApprovalService({ clock, emit });

  const engine = createConversationEngine({
    settings,
    secrets,
    db,
    registry,
    llm,
    approvals,
    screen: screenCapture,
    emit,
    logger,
    clock,
  });

  const porcupine = createPorcupineService({ getAccessKey: () => secrets.get('picovoiceAccessKey'), logger });

  // ---------- קיצור מקשים גלובלי ----------
  let registeredHotkey: string | null = null;
  const registerHotkey = (accelerator: string): void => {
    if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
    registeredHotkey = null;
    try {
      const ok = globalShortcut.register(accelerator, () => {
        sendCommand({ type: 'toggle-listen', source: 'hotkey' });
      });
      if (ok) registeredHotkey = accelerator;
      else logger.warn('hotkey.register_failed', { accelerator });
    } catch (err) {
      logger.warn('hotkey.invalid', { accelerator, error: err instanceof Error ? err.message : String(err) });
    }
  };

  // ---------- חלון ראשי ----------
  const s0 = settings.get();
  const iconPath = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'icon.png');
  const trayIconPath = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'tray.png');

  if (!devServerUrl) {
    const rendererRoot = rendererRootFor(app.getAppPath());
    protocol.handle(APP_SCHEME, (request) => serveAppRequest(rendererRoot, request.url));
  } else {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [developmentCsp(devOrigin!)] },
      });
    });
  }
  hardenSession(session.defaultSession, devOrigin, logger);
  hardenWebContentsCreation(app, devOrigin, logger);

  mainWindow = createMainWindow({
    preloadPath: preloadPathFor(app.getAppPath()),
    devServerUrl,
    isDev,
    mode: s0.ui.mode,
    alwaysOnTop: s0.ui.alwaysOnTop,
    startHidden: s0.ui.startHidden,
    iconPath,
    logger,
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    if (settings.get().ui.closeToTray) {
      event.preventDefault();
      mainWindow?.hide();
      if (!settings.get().ui.trayHintShown && Notification.isSupported()) {
        new Notification({ title: 'JARVIS ממשיך לפעול', body: 'JARVIS ממוזער למגש המערכת. יציאה מלאה: קליק ימני על האייקון ← "יציאה מלאה".' }).show();
        try {
          settings.update({ ui: { trayHintShown: true } });
        } catch {
          // לא קריטי
        }
      }
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (dbWarning) emit({ type: 'error', code: 'INTERNAL', message_he: dbWarning, retryable: false });
    const missed = scheduler.missedUnacknowledged();
    if (missed.length) emit({ type: 'missed-reminders', reminders: missed });
  });

  const windowControl = {
    // נקרא מה-renderer (IPC): רק משנה את גודל החלון. השמירה להגדרות באחריות ה-renderer,
    // כי הרחבה זמנית (אישור/הגדרות במצב קומפקטי) לא אמורה להישמר. לא שולחים פקודה חזרה — זה היה יוצר לולאה.
    setMode(mode: 'full' | 'compact') {
      if (!mainWindow) return;
      applyWindowMode(mainWindow, mode);
      tray?.update({ mode });
    },
    setAlwaysOnTop(value: boolean) {
      mainWindow?.setAlwaysOnTop(value, 'floating');
      try {
        settings.update({ ui: { alwaysOnTop: value } });
      } catch {
        // לא קריטי
      }
      tray?.update({ alwaysOnTop: value });
    },
    minimize() {
      mainWindow?.minimize();
    },
    close() {
      mainWindow?.close();
    },
    quit() {
      isQuitting = true;
      app.quit();
    },
  };

  tray = createJarvisTray(
    trayIconPath,
    {
      show: showWindow,
      toggleListen: () => {
        showWindow();
        sendCommand({ type: 'toggle-listen', source: 'tray' });
      },
      // מהמגש: מבקשים מה-renderer להחליף מצב (הוא ישנה את החלון וישמור את ההעדפה)
      setMode: (mode) => {
        showWindow();
        sendCommand({ type: 'view-mode', mode });
      },
      setAlwaysOnTop: (value) => windowControl.setAlwaysOnTop(value),
      openSettings: () => {
        showWindow();
        sendCommand({ type: 'open-settings' });
      },
      quit: () => windowControl.quit(),
    },
    { mode: s0.ui.mode, alwaysOnTop: s0.ui.alwaysOnTop, hotkey: s0.voice.pushToTalkHotkey, phase: 'IDLE', micActive: false },
    logger,
  );

  registerHotkey(s0.voice.pushToTalkHotkey);

  let lastSettings: Settings = s0;
  settings.onChange((next) => {
    verbose = next.privacy.verboseLogs;
    if (next.voice.pushToTalkHotkey !== lastSettings.voice.pushToTalkHotkey) {
      registerHotkey(next.voice.pushToTalkHotkey);
      tray?.update({ hotkey: next.voice.pushToTalkHotkey });
    }
    lastSettings = next;
    emit({ type: 'data-changed', scope: 'settings' });
  });

  // ---------- IPC ----------
  registerIpc({
    devOrigin,
    getWebContents: () => (mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null),
    logger,
    clock,
    engine,
    approvals,
    voice,
    settings,
    secrets,
    launcher,
    db,
    system,
    screen: screenCapture,
    todayLocal: () => todayLocal(clock.now()),
    clearAllLogs: () => logger.clearAll(),
    onAudioPhase: (phase) => {
      audioPhase = phase;
      tray?.update({ micActive: phase === 'LISTENING' });
      logger.debug('audio.phase', { phase, enginePhase });
    },
    onSecretsChanged: () => {
      llmStatus.value = null;
      emit({ type: 'data-changed', scope: 'secrets' });
    },
    onRemindersChanged: () => scheduler.checkNow('created'),
    onTasksChanged: () => emit({ type: 'data-changed', scope: 'tasks' }),
    wakeword: porcupine,
    onWakeDetected: () => {
      logger.info('wakeword.detected', { engine: 'porcupine' });
      sendCommand({ type: 'toggle-listen', source: 'wakeword' });
    },
    async testService(service) {
      if (service === 'llm') {
        const model = settings.get().ai.model;
        const now = clock.now().toISOString();
        if (!secrets.get('anthropicApiKey')) {
          const st: ServiceStatus = { service: 'llm', provider: model, configured: false, state: 'not_configured', lastCheckedAt: now, lastError_he: 'אין מפתח Claude.' };
          llmStatus.value = st;
          return st;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15_000);
        try {
          await llm.ping(controller.signal, model);
          llmStatus.value = { service: 'llm', provider: model, configured: true, state: 'ok', lastCheckedAt: now };
        } catch (err) {
          const message = err && typeof err === 'object' && 'message_he' in err ? String((err as { message_he: unknown }).message_he) : 'החיבור ל-Claude נכשל.';
          llmStatus.value = { service: 'llm', provider: model, configured: true, state: 'error', lastCheckedAt: now, lastError_he: message };
        } finally {
          clearTimeout(timer);
        }
        system.setServiceStatus(llmStatus.value);
        return llmStatus.value;
      }
      const st = await voice.test(service);
      system.setServiceStatus(st);
      return st;
    },
    async pickPath(purpose) {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: purpose === 'app-exe' ? 'בחר תוכנה' : purpose === 'project-file' ? 'בחר קובץ פרויקט' : 'בחר תיקיית פרויקט',
        properties: purpose === 'project-folder' ? ['openDirectory'] : ['openFile'],
        filters:
          purpose === 'app-exe'
            ? [{ name: 'תוכנות וקיצורי דרך', extensions: ['exe', 'lnk'] }]
            : purpose === 'project-file'
              ? [
                  { name: 'פרויקט EPLAN', extensions: ['elk', 'elp', 'els', 'ell', 'elr', 'elx'] },
                  { name: 'כל הקבצים', extensions: ['*'] },
                ]
              : [],
      });
      return result.canceled || result.filePaths.length === 0 ? null : (result.filePaths[0] ?? null);
    },
    window: windowControl,
  });

  // ---------- תזכורות, שינה והפעלה מחדש ----------
  scheduler.start();
  scheduler.checkNow('startup');
  powerMonitor.on('resume', () => scheduler.checkNow('resume'));
  powerMonitor.on('unlock-screen', () => scheduler.checkNow('unlock'));
  system.start();

  // שמירת היסטוריה לפי מדיניות השמירה — פעם ביום
  const prune = (): void => {
    try {
      const removed = db.history.prune(settings.get().privacy.historyRetentionDays, clock.now());
      if (removed) logger.info('history.pruned', { removed });
    } catch (err) {
      logger.warn('history.prune_failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };
  prune();
  const pruneTimer = setInterval(prune, 24 * 3600 * 1000);

  app.on('second-instance', showWindow);
  app.on('activate', showWindow);
  app.on('window-all-closed', () => {
    // נשארים במגש — יציאה רק מ"יציאה מלאה"
  });
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    clearInterval(pruneTimer);
    scheduler.stop();
    system.stop();
    engine.dispose();
    approvals.dispose();
    porcupine.stop();
    tray?.destroy();
    try {
      db.close();
    } catch {
      // כבר סגור
    }
    logger.info('app.quit');
  });

  logger.info('app.ready', { audioPhase });
}
