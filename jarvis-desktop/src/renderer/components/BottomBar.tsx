/**
 * הסרגל התחתון: מיקרופון, עצירה, שדה הקלדה (Enter שולח), וניתוח מסך עם בחירת מסך כשיש יותר מאחד.
 */
import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { MAX_TEXT_INPUT } from '../../shared/ipc-channels';
import type { DisplayInfo } from '../../shared/types';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { he } from '../i18n/he';
import { useController, useUiState } from '../state/controller';
import { IconCamera, IconSend } from './Icons';
import { MicButton, StopButton } from './VoiceButtons';

function DisplayPicker({
  displays,
  onPick,
  onCancel,
}: {
  displays: DisplayInfo[];
  onPick: (id: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  const initial = displays.find((d) => d.primary)?.id ?? displays[0]?.id ?? '';
  const [selected, setSelected] = useState(initial);
  useFocusTrap(ref);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    }
  };

  return (
    <div className="popover frame" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={ref} tabIndex={-1} onKeyDown={onKeyDown}>
      <h3 id={titleId} className="popover-title">
        {he.bottom.pickDisplay}
      </h3>
      <div role="radiogroup" aria-labelledby={titleId} className="radio-list">
        {displays.map((d) => (
          <label key={d.id} className="radio-row">
            <input type="radio" name="screen-pick" value={d.id} checked={selected === d.id} onChange={() => setSelected(d.id)} />
            <span className="radio-main">{d.label}</span>
            <span className="radio-sub" dir="ltr">
              {d.width}×{d.height} · {Math.round(d.scaleFactor * 100)}%
            </span>
            {d.primary && <span className="tag">{he.bottom.displayPrimary}</span>}
          </label>
        ))}
      </div>
      <div className="popover-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {he.bottom.cancel}
        </button>
        <button type="button" className="btn btn-primary" disabled={!selected} onClick={() => onPick(selected)}>
          {he.bottom.analyze}
        </button>
      </div>
    </div>
  );
}

export function BottomBar() {
  const controller = useController();
  const submitting = useUiState((s) => s.submitting);
  const screenPending = useUiState((s) => s.screenRequestPending);
  const [text, setText] = useState('');
  const [displays, setDisplays] = useState<DisplayInfo[] | null>(null);
  const [loadingDisplays, setLoadingDisplays] = useState(false);
  const inputId = useId();

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!text.trim() || submitting) return;
    // הטקסט נמחק רק אחרי ש-main קיבל את הבקשה — אחרת נשאר לתיקון ולשליחה חוזרת
    const ok = await controller.submitText(text);
    if (ok) setText('');
  };

  const analyze = async (displayId?: string) => {
    setDisplays(null);
    const question = text.trim();
    const ok = await controller.analyzeScreen(displayId ? { displayId, question } : { question });
    if (ok && question) setText('');
  };

  const onScreen = async () => {
    if (loadingDisplays || screenPending) return;
    setLoadingDisplays(true);
    const list = await controller.listDisplays();
    setLoadingDisplays(false);
    if (!list) return;
    if (list.length > 1) setDisplays(list);
    else void analyze(list[0]?.id);
  };

  return (
    <footer className="bottombar">
      <MicButton />
      <StopButton />
      <form className="ask" onSubmit={(e) => void onSubmit(e)}>
        <label htmlFor={inputId} className="visually-hidden">
          {he.bottom.inputLabel}
        </label>
        <input
          id={inputId}
          className="ask-input"
          type="text"
          dir="auto"
          autoComplete="off"
          spellCheck={false}
          maxLength={MAX_TEXT_INPUT}
          placeholder={he.bottom.inputPlaceholder}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button type="submit" className="icon-btn" aria-label={he.bottom.send} title={he.bottom.send} disabled={!text.trim() || submitting}>
          <IconSend size={18} />
        </button>
      </form>
      <div className="screen-wrap">
        <button
          type="button"
          className="icon-btn"
          aria-label={he.bottom.screen}
          title={he.bottom.screenHint}
          aria-haspopup="dialog"
          aria-expanded={displays !== null}
          disabled={loadingDisplays || screenPending}
          onClick={() => void onScreen()}
        >
          <IconCamera size={20} />
        </button>
        {displays && <DisplayPicker displays={displays} onPick={(id) => void analyze(id)} onCancel={() => setDisplays(null)} />}
      </div>
    </footer>
  );
}
