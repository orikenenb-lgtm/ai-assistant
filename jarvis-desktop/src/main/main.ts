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
import { systemClock, type EventSink } from './core/contracts';
import { createFileLogger } from './app/logger';
import { APP_SCHEME, developmentCsp, serveAppRequest } from './app/protocol';
import { hardenSession, hardenWebContentsCreation } from './app/security';
import { applyWindowMode, createMainWindow, preloadPathFor, rendererRootFor } from './app/windows';
import { createJarvisTray, type JarvisTray } from './app/tray';
import { registerIpc } from './app/ipc';
import { createSettingsStore } from './settings/settings-store';
import { createSecretStore } from './secrets/secret-store';
import { describeChangesForDialog, launcherChangesRequiringConfirmation, pathKey } from './settings/launcher-guard';
import { createVoiceService } from './voice/voice-service';
import { openDatabase, openDatabaseWithRetry, type DataDatabase } from './db/database';
import { ACTION_LOG_RETENTION_MS } from './db/action-log-repository';
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

// שרת פיתוח רק כשהאפליקציה לא ארוזה — בגרסה המותקנת משתנה סביבה לא יכול להחליף את הממשק
const devServerUrl = !app.isPackaged ? (process.env.JARVIS_DEV_SERVER_URL ?? null) : null;
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

// הפעלה שנייה (קליק כפול נוסף על האייקון) מציגה את החלון הקיים.
// נרשם מיד, כדי שגם הפעלה שנייה בזמן העלייה לא תלך לאיבוד.
let showWindowHandler: (() => void) | null = null;
let showRequestedDuringStartup = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (showWindowHandler) showWindowHandler();
    else showRequestedDuringStartup = true;
  });
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();
  const clock = systemClock;
  const appStartedAt = clock.now().toISOString();
  const userData = app.getPath('userData');

  let verbose = false;
  const logger = createFileLogger({ dir: join(userData, 'logs'), clock, isVerbose: () => verbose, mirrorToConsole: isDev });
  logger.info('app.starting', { version: app.getVersion(), packaged: app.isPackaged, platform: process.platform });

  const settings = createSettingsStore({ file: join(userData, 'settings.json'), logger });
  verbose = settings.get().privacy.verboseLogs;

  const secrets = createSecretStore({ file: join(userData, 'secrets.json'), safeStorage, logger, env: process.env });
  await secrets.init();

  // מסד הנתונים המקומי. אם הקובץ לא נפתח — ממשיכים בזיכרון ומודיעים למשתמש (בלי לאבד את JARVIS כולו).
  let db: DataDatabase;
  let dbWarning: string | null = null;
  try {
    // קובץ נעול לרגע (אנטי-וירוס, גיבוי, מופע קודם שנסגר) — כמה ניסיונות קצרים לפני מעבר לזיכרון
    db = await openDatabaseWithRetry(
      join(userData, 'jarvis.db'),
      { clock },
      { onRetry: ({ attempt, error }) => logger.warn('db.open_retry', { attempt, code: error.code }) },
    );
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
    // בקשת אישור חייבת להיות גלויה — גם כש-JARVIS במגש או מאחורי EPLAN
    if (event.type === 'approval-required') {
      showWindow();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.flashFrame(true);
    }
  };
  const sendCommand = (cmd: UiCommand): void => sendToRenderer(IPC.evtCommand, cmd);

  const showWindow = (): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
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

  /** נתיבים שהמשתמש בחר בבורר הקבצים / ש-main זיהה בסשן הזה (לא דורשים אישור נוסף). */
  const trustedPaths = new Set<string>();

  const porcupine = createPorcupineService({ getAccessKey: () => secrets.get('picovoiceAccessKey'), logger });

  // ---------- קיצור מקשים גלובלי ----------
  let registeredHotkey: string | null = null;
  const tryRegisterHotkey = (accelerator: string): boolean => {
    try {
      const ok = globalShortcut.register(accelerator, () => {
        sendCommand({ type: 'toggle-listen', source: 'hotkey' });
      });
      if (!ok) logger.warn('hotkey.register_failed', { accelerator });
      return ok;
    } catch (err) {
      logger.warn('hotkey.invalid', { accelerator, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  };
  // לפני ששומרים קיצור חדש — רושמים אותו ב-Windows. אם Windows מסרב (צירוף תפוס או לא תקין),
  // ההגדרה לא נשמרת, מוצגת שגיאה במסך ההגדרות, והקיצור הקודם ממשיך לעבוד.
  settings.addCommitGuard((next, prev) => {
    const accelerator = next.voice.pushToTalkHotkey;
    if (accelerator === registeredHotkey) return null;
    if (tryRegisterHotkey(accelerator)) {
      if (registeredHotkey) globalShortcut.unregister(registeredHotkey);
      registeredHotkey = accelerator;
      return null;
    }
    // הקיצור לא השתנה (ורק נכשל ברישום קודם) — לא חוסמים שמירה של הגדרות אחרות
    if (accelerator === prev.voice.pushToTalkHotkey) return null;
    return `לא ניתן להגדיר את קיצור המקשים "${accelerator}": הוא לא תקין או תפוס ע"י תוכנה אחרת. בחר צירוף אחר.`;
  });

  // ---------- חלון ראשי ----------
  const s0 = settings.get();
  const iconPath = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'icon.png');
  // ב-Windows: ICO עם כמה גדלים, כדי שהאייקון במגש יהיה חד גם בקנה מידה 150%–200%
  const trayIconPath = join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    'resources',
    process.platform === 'win32' ? 'tray.ico' : 'tray.png',
  );

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
      return;
    }
    // "סגירה למגש" כבויה: סגירת החלון = יציאה מלאה
    isQuitting = true;
    app.quit();
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  mainWindow.on('focus', () => mainWindow?.flashFrame(false));

  // תזכורת שהופעלה בזמן שהממשק עוד נטען (למשל בהפעלה) — האירוע לא הגיע אליו, ולכן מציגים אותה שוב כשהוא מוכן
  let rendererLoadStartedAt = appStartedAt;
  mainWindow.webContents.on('did-start-loading', () => {
    rendererLoadStartedAt = clock.now().toISOString();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (dbWarning) emit({ type: 'error', code: 'INTERNAL', message_he: dbWarning, retryable: false });
    for (const reminder of scheduler.firedSince(rendererLoadStartedAt)) emit({ type: 'reminder-fired', reminder });
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
      stop: () => sendCommand({ type: 'stop' }),
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
    { mode: s0.ui.mode, alwaysOnTop: s0.ui.alwaysOnTop, hotkey: '', phase: 'IDLE', micActive: false, wakeListening: false },
    logger,
  );

  if (tryRegisterHotkey(s0.voice.pushToTalkHotkey)) registeredHotkey = s0.voice.pushToTalkHotkey;
  tray.update({ hotkey: registeredHotkey ?? '' });

  // הפעלה אוטומטית עם Windows — רק בגרסה המותקנת (בפיתוח זה היה רושם את electron.exe)
  const applyOpenAtLogin = (enabled: boolean): void => {
    if (!app.isPackaged || process.platform !== 'win32') return;
    try {
      app.setLoginItemSettings({ openAtLogin: enabled });
    } catch (err) {
      logger.warn('login_item.failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };
  applyOpenAtLogin(s0.ui.openAtLogin);

  let lastSettings: Settings = s0;
  settings.onChange((next) => {
    verbose = next.privacy.verboseLogs;
    tray?.update({ hotkey: registeredHotkey ?? '' });
    if (next.ui.openAtLogin !== lastSettings.ui.openAtLogin) applyOpenAtLogin(next.ui.openAtLogin);
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
    onAudioPhase: (phase, wakeWordListening) => {
      audioPhase = phase;
      tray?.update({ micActive: phase === 'LISTENING', ...(wakeWordListening !== undefined ? { wakeListening: wakeWordListening } : {}) });
      logger.debug('audio.phase', { phase, enginePhase });
    },
    onSecretsChanged: () => {
      llmStatus.value = null;
      emit({ type: 'data-changed', scope: 'secrets' });
    },
    onRemindersChanged: () => {
      scheduler.checkNow('created');
      emit({ type: 'data-changed', scope: 'reminders' });
    },
    onTasksChanged: () => emit({ type: 'data-changed', scope: 'tasks' }),
    onHistoryCleared: (scope) => {
      engine.clearHistory();
      emit({ type: 'data-changed', scope: 'history' });
      if (scope === 'all') emit({ type: 'data-changed', scope: 'usage' });
    },
    missedReminders: () => scheduler.missedUnacknowledged(),
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
    trustPath: (p) => trustedPaths.add(pathKey(p)),
    async confirmSettingsPatch(patch) {
      const changes = launcherChangesRequiringConfirmation(settings.get(), patch, trustedPaths);
      if (changes.length === 0) return true;
      const options: Electron.MessageBoxOptions = {
        type: 'warning',
        title: 'JARVIS — אישור תוכנה מאושרת',
        message: 'לאשר ל-JARVIS להפעיל את התוכנות הבאות לפי בקשה?',
        detail: `${describeChangesForDialog(changes)}\n\nאשר רק אם אתה הוספת את זה עכשיו בהגדרות.`,
        buttons: ['אשר', 'בטל'],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      };
      const { response } = mainWindow ? await dialog.showMessageBox(mainWindow, options) : await dialog.showMessageBox(options);
      logger.info('settings.launcher_change_confirmation', { count: changes.length, approved: response === 0 });
      return response === 0;
    },
    async pickPath(purpose) {
      if (!mainWindow) return null;
      const result = await dialog.showOpenDialog(mainWindow, {
        title: purpose === 'app-exe' ? 'בחר תוכנה' : purpose === 'project-file' ? 'בחר קובץ פרויקט' : 'בחר תיקיית פרויקט',
        properties: purpose === 'project-folder' ? ['openDirectory'] : ['openFile'],
        filters:
          purpose === 'app-exe'
            ? // Windows פותר קיצורי דרך בבורר הקבצים, לכן ‎.lnk לא יכול לחזור מכאן — מדביקים את הנתיב שלו ידנית
              [{ name: 'תוכנות (‎.exe)', extensions: ['exe'] }]
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

  // שמירת היסטוריה לפי מדיניות השמירה, ויומן הפעולות ליום אחד בלבד (הוא משמש רק למניעת כפילות) — פעם ביום
  const prune = (): void => {
    try {
      const removed = db.history.prune(settings.get().privacy.historyRetentionDays, clock.now());
      if (removed) logger.info('history.pruned', { removed });
      const actions = db.actions.prune(new Date(clock.now().getTime() - ACTION_LOG_RETENTION_MS).toISOString());
      if (actions) logger.info('actions.pruned', { removed: actions });
    } catch (err) {
      logger.warn('history.prune_failed', { error: err instanceof Error ? err.message : String(err) });
    }
  };
  prune();
  const pruneTimer = setInterval(prune, 24 * 3600 * 1000);

  showWindowHandler = showWindow;
  if (showRequestedDuringStartup) showWindow();
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
