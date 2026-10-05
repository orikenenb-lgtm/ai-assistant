/**
 * נקודת הכניסה של ה-renderer: גופנים מקומיים (בלי רשת), סגנונות, יצירת הבקר עם שכבת האודיו
 * האמיתית ו-window.jarvis, והרכבת React. אם ה-preload לא נטען — מסך שגיאה ברור בעברית.
 */
import '@fontsource-variable/heebo';
import '@fontsource/orbitron/500.css';
import '@fontsource/orbitron/700.css';
import './styles/index.css';

import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import {
  createMicCapture,
  createSpeechPlayback,
  createSystemSpeaker,
  createWakeWordDetector,
  isLikelyEcho,
} from './audio';
import { he } from './i18n/he';
import { ControllerContext, JarvisController, type BatteryLike, type ControllerDeps } from './state/controller';
import { uuidV4 } from './state/ids';

function FatalScreen({ message, canReload }: { message: string; canReload: boolean }) {
  return (
    <div className="fatal" role="alert">
      <h1>{he.fatal.title}</h1>
      <p>{message}</p>
      {canReload && (
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          {he.fatal.reload}
        </button>
      )}
    </div>
  );
}

/** תופס קריסה של רכיב, כדי שלא יישאר חלון שחור בלי הסבר. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('renderer crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.failed) return <FatalScreen message={he.fatal.crashed} canReload />;
    return this.props.children;
  }
}

function browserDeps(): ControllerDeps {
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryLike> };
  return {
    api: window.jarvis,
    audio: { createMicCapture, createSpeechPlayback, createSystemSpeaker, createWakeWordDetector, isLikelyEcho },
    now: () => Date.now(),
    timers: {
      setTimeout: (fn, ms) => window.setTimeout(fn, ms),
      clearTimeout: (h) => window.clearTimeout(h as number | undefined),
      setInterval: (fn, ms) => window.setInterval(fn, ms),
      clearInterval: (h) => window.clearInterval(h as number | undefined),
    },
    randomId: () => uuidV4(),
    getBattery: typeof nav.getBattery === 'function' ? () => nav.getBattery?.() : undefined,
  };
}

const container = document.getElementById('root');
if (!container) throw new Error('#root missing');
const root = createRoot(container);

if (!window.jarvis) {
  root.render(<FatalScreen message={he.fatal.noBridge} canReload={false} />);
} else {
  const controller = new JarvisController(browserDeps());
  void controller.init();
  // טעינה מחדש / סגירה: משחררים מיקרופון, עוצרים השמעה ומבטלים מאזינים
  window.addEventListener('pagehide', () => controller.dispose(), { once: true });

  root.render(
    <StrictMode>
      <ErrorBoundary>
        <ControllerContext.Provider value={controller}>
          <App />
        </ControllerContext.Provider>
      </ErrorBoundary>
    </StrictMode>,
  );
}
