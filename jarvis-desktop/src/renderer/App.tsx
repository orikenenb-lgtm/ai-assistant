/**
 * שורש הממשק: גוזר את מצב התצוגה מהפעילות האמיתית, בוחר תצוגה מלאה/קומפקטית,
 * ומטפל בקיצורי המקלדת הגלובליים (רווח, Esc, Ctrl+,).
 */
import { useEffect } from 'react';
import { ApprovalDialog } from './components/ApprovalDialog';
import { CompactHud } from './components/CompactHud';
import { FullHud } from './components/FullHud';
import { ScreenCaptureIndicator, Toasts } from './components/Notices';
import { usePrefersReducedMotion } from './hooks/environment';
import { SettingsView } from './settings/SettingsView';
import { useController, useUiState, type JarvisController } from './state/controller';
import { describeDisplayState } from './state/derive';

const INTERACTIVE =
  'input, textarea, select, button, a[href], summary, [contenteditable=""], [contenteditable="true"], [role="button"], [role="tab"], [role="radio"], [role="switch"], [role="checkbox"], [role="slider"], [role="menuitem"]';

/** האם המקש נלחץ בתוך רכיב שמשתמש ברווח בעצמו (שדה טקסט, כפתור וכו'). */
function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE) !== null;
}

function useGlobalKeys(controller: JarvisController): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const s = controller.state;
      // Ctrl+, — לפי מיקום המקש (e.code), כדי שיעבוד גם בפריסת מקלדת עברית
      if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === 'Comma' || e.key === ',')) {
        e.preventDefault();
        controller.openSettings();
        return;
      }
      const space = (e.code === 'Space' || e.key === ' ') && !e.repeat && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
      // כשיש דיאלוג אישור — הוא מטפל במקשים שלו (Esc = דחייה). רווח מחוץ לכפתורים = לחיצה לדיבור,
      // כדי לענות "כן"/"לא" בקול (זה לא מאשר בעצמו — רק פותח את המיקרופון).
      if (s.pendingApprovals.length > 0) {
        if (space && !isInteractiveTarget(e.target)) {
          e.preventDefault();
          void controller.toggleListen('keyboard');
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        if (s.settingsOpen) controller.closeSettings();
        else controller.stop();
        return;
      }
      if (space) {
        if (s.settingsOpen || isInteractiveTarget(e.target)) return;
        e.preventDefault();
        void controller.toggleListen('keyboard');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);
}

export function App() {
  const controller = useController();
  const enginePhase = useUiState((s) => s.enginePhase);
  const audioPhase = useUiState((s) => s.audioPhase);
  const pendingCount = useUiState((s) => s.pendingApprovals.length);
  const errorActive = useUiState((s) => s.errorActive);
  const viewMode = useUiState((s) => s.viewMode);
  const settingsOpen = useUiState((s) => s.settingsOpen);
  const motionPref = useUiState((s) => s.settings?.ui.reducedMotion ?? 'system');
  const systemReduced = usePrefersReducedMotion();
  const reducedMotion = motionPref === 'on' || (motionPref === 'system' && systemReduced);

  const { state, label } = describeDisplayState({
    enginePhase,
    audioPhase,
    pendingApproval: pendingCount > 0,
    errorActive,
  });

  useEffect(() => {
    document.documentElement.dataset.reducedMotion = reducedMotion ? 'on' : 'off';
  }, [reducedMotion]);

  useEffect(() => {
    // כותרת החלון (שורת המשימות / Alt+Tab) משקפת את המצב
    document.title = state === 'IDLE' ? 'JARVIS' : `JARVIS — ${label}`;
  }, [state, label]);

  useGlobalKeys(controller);

  const approvalOpen = pendingCount > 0;
  const showSettings = settingsOpen && viewMode === 'full';

  // דיאלוג אישור פתוח: כל השאר inert (גם שורת הכותרת וההודעות) — Tab לא יוצא מהדיאלוג.
  // הודעות: בתצוגה מלאה — ערימה צפה; בהגדרות — פס בתחתית המסגרת; בקומפקטית — פס בתוך ה-HUD.
  return (
    <div className="app" data-view={viewMode} data-state={state}>
      {viewMode === 'full' ? (
        <FullHud state={state} label={label} reducedMotion={reducedMotion} obscured={showSettings || approvalOpen} inert={approvalOpen} />
      ) : (
        <CompactHud state={state} label={label} reducedMotion={reducedMotion} inert={approvalOpen} />
      )}
      {showSettings && <SettingsView inert={approvalOpen} />}
      <ScreenCaptureIndicator />
      <ApprovalDialog />
      {viewMode === 'full' && !showSettings && <Toasts inert={approvalOpen} />}
    </div>
  );
}
