/**
 * השיחה האחרונה: הבקשה של המשתמש (עם אייקון קול/הקלדה) והתשובה של JARVIS.
 * הטקסט של המודל מוצג כטקסט בלבד (בלי HTML) ובנפרד מסטטוס הפעולות.
 */
import type { ReactNode } from 'react';
import type { InputSource } from '../../shared/types';
import { he } from '../i18n/he';
import { useUiState } from '../state/controller';
import { IconCamera, IconKeyboard, IconMic } from './Icons';

function sourceMeta(source: InputSource): { label: string; icon: ReactNode } {
  switch (source) {
    case 'voice':
      return { label: he.transcript.viaVoice, icon: <IconMic size={14} /> };
    case 'wakeword':
      return { label: he.transcript.viaWake, icon: <IconMic size={14} /> };
    case 'text':
      return { label: he.transcript.viaText, icon: <IconKeyboard size={14} /> };
    case 'ui':
      return { label: he.transcript.viaUi, icon: <IconCamera size={14} /> };
  }
}

export function Transcript() {
  const lastUser = useUiState((s) => s.lastUser);
  const lastReply = useUiState((s) => s.lastReply);
  const awaitingReply = useUiState((s) => s.awaitingReply);

  if (!lastUser && !lastReply) {
    return (
      <section className="transcript frame" aria-label={he.transcript.regionLabel}>
        <div className="transcript-scroll">
          <p className="transcript-empty">{he.transcript.empty}</p>
        </div>
      </section>
    );
  }
  const meta = lastUser ? sourceMeta(lastUser.source) : null;

  return (
    <section className="transcript frame" aria-label={he.transcript.regionLabel} aria-live="polite">
      <div className="transcript-scroll">
      {lastUser && meta && (
        <div className="line line-user">
          <span className="line-who">
            {meta.icon}
            <span>{he.transcript.you}</span>
            <span className="line-via">· {meta.label}</span>
          </span>
          <p className="line-text" dir="auto">
            {lastUser.text}
          </p>
        </div>
      )}
      {lastReply ? (
        <div className="line line-jarvis">
          <span className="line-who">
            <span className="line-name" dir="ltr">
              {he.transcript.jarvis}
            </span>
            {lastReply.mode === 'local' && <span className="line-via">· {he.transcript.localMode}</span>}
          </span>
          <p className="line-text">{lastReply.text}</p>
        </div>
      ) : (
        awaitingReply && <p className="line-waiting">{he.transcript.waitingReply}</p>
      )}
      </div>
    </section>
  );
}
