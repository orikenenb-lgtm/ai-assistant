import { Menu, Tray, nativeImage, type NativeImage } from 'electron';
import type { Logger } from '../core/contracts';
import type { EnginePhase } from '../../shared/types';

/**
 * מגש המערכת: JARVIS ממשיך לפעול (תזכורות, קיצור מקשים) גם כשהחלון סגור.
 * "יציאה מלאה" היא הדרך היחידה לסגור את התהליך לגמרי.
 */

export interface TrayActions {
  show(): void;
  toggleListen(): void;
  stop(): void;
  setMode(mode: 'full' | 'compact'): void;
  setAlwaysOnTop(value: boolean): void;
  openSettings(): void;
  quit(): void;
}

export interface TrayState {
  mode: 'full' | 'compact';
  alwaysOnTop: boolean;
  hotkey: string;
  phase: EnginePhase;
  micActive: boolean;
  /** מילת ההפעלה מאזינה (מיקרופון פתוח מקומית, בלי הקלטה) */
  wakeListening: boolean;
}

const PHASE_LABEL: Record<EnginePhase, string> = {
  IDLE: 'מוכן',
  THINKING: 'חושב…',
  EXECUTING: 'מבצע…',
  AWAITING_APPROVAL: 'ממתין לאישור',
  ERROR: 'שגיאה',
};

export interface JarvisTray {
  update(state: Partial<TrayState>): void;
  destroy(): void;
}

export function createJarvisTray(iconPath: string, actions: TrayActions, initial: TrayState, logger: Logger): JarvisTray {
  let state = { ...initial };
  let icon: NativeImage = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    logger.warn('tray.icon_missing');
    icon = nativeImage.createEmpty();
  }
  // ICO (ב-Windows) נטען בגודל המדויק לפי קנה המידה של המסך; PNG מוקטן ל-16px
  const tray = new Tray(iconPath.toLowerCase().endsWith('.ico') ? icon : icon.resize({ width: 16, height: 16 }));

  const render = (): void => {
    // ריק = קיצור המקשים לא נרשם (תפוס או לא תקין)
    const hotkeyLabel = state.hotkey ? state.hotkey.replace('CommandOrControl', 'Ctrl') : 'קיצור מקשים לא פעיל';
    const mic = state.micActive ? 'מיקרופון פעיל — מקליט' : state.wakeListening ? 'מאזין למילת הפעלה (מקומית)' : PHASE_LABEL[state.phase];
    tray.setToolTip(`JARVIS — ${mic}`);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'הצג את JARVIS', click: () => actions.show() },
        { label: `התחל/סיים האזנה (${hotkeyLabel})`, click: () => actions.toggleListen() },
        { label: 'עצור (הקראה / בקשה)', click: () => actions.stop() },
        { type: 'separator' },
        {
          label: state.mode === 'full' ? 'מעבר ל-HUD קומפקטי' : 'מעבר לחלון מלא',
          click: () => actions.setMode(state.mode === 'full' ? 'compact' : 'full'),
        },
        {
          label: 'תמיד מעל חלונות',
          type: 'checkbox',
          checked: state.alwaysOnTop,
          click: (item) => actions.setAlwaysOnTop(item.checked),
        },
        { label: 'הגדרות', click: () => actions.openSettings() },
        { type: 'separator' },
        { label: 'יציאה מלאה', click: () => actions.quit() },
      ]),
    );
  };

  tray.on('click', () => actions.show());
  render();

  return {
    update(next) {
      state = { ...state, ...next };
      render();
    },
    destroy() {
      tray.destroy();
    },
  };
}
