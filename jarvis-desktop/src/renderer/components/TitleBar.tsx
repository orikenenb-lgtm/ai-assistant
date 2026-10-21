/**
 * שורת כותרת עצמאית לחלון ללא מסגרת: אזור גרירה, לוגו, ובצד השמאלי (RTL) כפתורי החלון.
 */
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';
import { IconClose, IconCompact, IconGear, IconMinimize, IconPin } from './Icons';

export function TitleBar() {
  const controller = useController();
  const settings = useUiState((s) => s.settings);
  const alwaysOnTop = settings?.ui.alwaysOnTop ?? false;
  const closeToTray = settings?.ui.closeToTray ?? true;

  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <span className="logo-mark" aria-hidden="true" />
        <span className="logo-text" dir="ltr">
          {he.appName}
        </span>
      </div>
      <div className="titlebar-drag" />
      <div className="titlebar-actions">
        <button
          type="button"
          className="tb-btn"
          aria-label={he.titleBar.toCompact}
          title={he.titleBar.toCompact}
          onClick={() => void controller.setViewMode('compact')}
        >
          <IconCompact size={16} />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-pressed={alwaysOnTop}
          aria-label={alwaysOnTop ? he.titleBar.pinOn : he.titleBar.pinOff}
          title={alwaysOnTop ? he.titleBar.pinOn : he.titleBar.pinOff}
          disabled={!settings}
          onClick={() => void controller.setAlwaysOnTop(!alwaysOnTop)}
        >
          <IconPin size={16} />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label={he.titleBar.settings}
          title={he.titleBar.settings}
          onClick={() => controller.openSettings()}
        >
          <IconGear size={16} />
        </button>
        <button
          type="button"
          className="tb-btn"
          aria-label={he.titleBar.minimize}
          title={he.titleBar.minimize}
          onClick={() => controller.minimizeWindow()}
        >
          <IconMinimize size={16} />
        </button>
        <button
          type="button"
          className="tb-btn tb-close"
          aria-label={closeToTray ? he.titleBar.closeToTray : he.titleBar.close}
          title={closeToTray ? he.titleBar.closeToTray : he.titleBar.close}
          onClick={() => controller.closeWindow()}
        >
          <IconClose size={16} />
        </button>
      </div>
    </header>
  );
}
