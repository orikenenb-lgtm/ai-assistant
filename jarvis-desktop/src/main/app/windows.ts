import { BrowserWindow, screen } from 'electron';
import { join } from 'node:path';
import type { Logger } from '../core/contracts';
import { APP_ORIGIN } from './protocol';

/**
 * החלון הראשי: ללא מסגרת (שורת כותרת עצמאית ב-HUD), עם webPreferences מוקשחים.
 * שני מצבים: מלא וקומפקטי. "תמיד מעל חלונות" לפי בחירת המשתמש.
 */

export const FULL_SIZE = { width: 960, height: 680, minWidth: 720, minHeight: 520 };
export const COMPACT_SIZE = { width: 420, height: 156, minWidth: 380, minHeight: 140 };

export interface MainWindowOptions {
  preloadPath: string;
  devServerUrl: string | null;
  isDev: boolean;
  mode: 'full' | 'compact';
  alwaysOnTop: boolean;
  startHidden: boolean;
  iconPath?: string;
  logger: Logger;
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const size = options.mode === 'compact' ? COMPACT_SIZE : FULL_SIZE;
  const win = new BrowserWindow({
    width: size.width,
    height: size.height,
    minWidth: size.minWidth,
    minHeight: size.minHeight,
    frame: false,
    show: false,
    title: 'JARVIS',
    backgroundColor: '#03070c',
    autoHideMenuBar: true,
    alwaysOnTop: options.alwaysOnTop,
    ...(options.iconPath ? { icon: options.iconPath } : {}),
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: options.isDev,
      // השמעת תשובה קולית בלי מחווה של המשתמש בכל פעם
      autoplayPolicy: 'no-user-gesture-required',
      // זיהוי מילת הפעלה ומדידת מיקרופון ממשיכים כשהחלון ממוזער
      backgroundThrottling: false,
    },
  });

  if (options.alwaysOnTop) win.setAlwaysOnTop(true, 'floating');
  win.removeMenu();

  win.once('ready-to-show', () => {
    if (!options.startHidden) win.show();
  });

  const url = options.devServerUrl ?? `${APP_ORIGIN}/index.html`;
  win.loadURL(url).catch((err: unknown) => {
    options.logger.error('window.load_failed', { error: err instanceof Error ? err.message : String(err) });
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    options.logger.error('window.renderer_gone', { reason: details.reason, exitCode: details.exitCode });
  });

  return win;
}

export function applyWindowMode(win: BrowserWindow, mode: 'full' | 'compact'): void {
  const size = mode === 'compact' ? COMPACT_SIZE : FULL_SIZE;
  win.setMinimumSize(size.minWidth, size.minHeight);
  const bounds = win.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const work = display.workArea;
  // מצב קומפקטי: מצמידים לפינה הימנית-עליונה של אזור העבודה (שימושי כ-HUD מעל עבודה ב-EPLAN)
  if (mode === 'compact') {
    win.setBounds({
      x: work.x + work.width - size.width - 24,
      y: work.y + 24,
      width: size.width,
      height: size.height,
    });
  } else {
    const width = Math.min(size.width, work.width);
    const height = Math.min(size.height, work.height);
    win.setBounds({
      x: Math.round(work.x + (work.width - width) / 2),
      y: Math.round(work.y + (work.height - height) / 2),
      width,
      height,
    });
  }
}

export function preloadPathFor(appPath: string): string {
  return join(appPath, 'dist', 'preload', 'preload.cjs');
}

export function rendererRootFor(appPath: string): string {
  return join(appPath, 'dist', 'renderer');
}
