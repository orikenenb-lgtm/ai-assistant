import { RotateCcw, SendHorizontal, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Button, Callout, Spinner, Textarea } from '@/components/ui';
import { OfferDetailDialog } from '@/features/offers';
import { errorMessage } from '@/lib/api';
import { AI_MESSAGE_MAX_CHARS } from '@/lib/schemas/ai';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import {
  clearConversation,
  loadConversation,
  newMessageId,
  saveConversation,
  toHistory,
  trimMessages,
  type ChatMessage,
} from '../conversation';
import { useSendChat } from '../hooks';
import { EXAMPLE_PROMPTS } from '../labels';
import { ChatMessageView } from './AssistantMessage';

/** The conversation: list + composer. History is kept in sessionStorage only (never on the server). */
export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadConversation());
  const [draft, setDraft] = useState('');
  const [failed, setFailed] = useState<{ text: string; error: string } | null>(null);
  const [details, setDetails] = useState<CanonicalOffer | null>(null);
  const send = useSendChat();
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pending = send.isPending;

  useEffect(() => {
    saveConversation(messages);
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages.length, pending, failed]);

  function submit(raw: string, appendUser: boolean) {
    const text = raw.trim();
    if (!text || pending) return;
    const history = toHistory(messages);
    setFailed(null);
    if (appendUser) {
      setMessages((prev) => trimMessages([...prev, { id: newMessageId(), role: 'user', text }]));
      setDraft('');
    }
    send.mutate(
      { message: text, history },
      {
        onSuccess: (data) => {
          setMessages((prev) =>
            trimMessages([
              ...prev,
              { id: newMessageId(), role: 'assistant', text: data.reply.text, reply: data.reply, toolCalls: data.tool_calls },
            ]),
          );
        },
        onError: (err) => setFailed({ text, error: errorMessage(err, 'לא ניתן לקבל תשובה מהעוזר. נסו שוב.') }),
      },
    );
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit(draft, true);
    }
  }

  function newConversation() {
    clearConversation();
    setMessages([]);
    setFailed(null);
    setDraft('');
    inputRef.current?.focus();
  }

  const remaining = AI_MESSAGE_MAX_CHARS - draft.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-fg-muted">
          השיחה נשמרת רק בדפדפן הזה (עד 20 סבבים אחרונים) ואינה נשמרת בשרת. סגירת הלשונית או &quot;שיחה חדשה&quot; מוחקות אותה.
        </p>
        <Button size="sm" variant="secondary" leadingIcon={<RotateCcw aria-hidden="true" />} onClick={newConversation} disabled={messages.length === 0 && !draft}>
          שיחה חדשה
        </Button>
      </div>

      <section
        aria-label="השיחה עם העוזר"
        className="flex min-h-[18rem] flex-col rounded-2xl border border-line bg-surface-sunken p-3 sm:p-5"
      >
        {messages.length === 0 && !pending ? (
          <div className="m-auto flex max-w-xl flex-col items-center gap-4 py-8 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-ink-900 text-sun-400" aria-hidden="true">
              <Sparkles className="size-6" />
            </span>
            <p className="text-sm leading-relaxed text-fg-muted">
              כתבו בעברית מה אתם מחפשים — יעד, תאריכים ומי נוסע — והעוזר יפעיל חיפוש במערכת ויציג את ההצעות שנמצאו, עם תג המקור של כל אחת (הדגמה / חי / מטמון).
            </p>
          </div>
        ) : (
          <ol
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="הודעות"
            className="flex flex-col gap-5"
            data-testid="chat-log"
          >
            {messages.map((m) => (
              <ChatMessageView key={m.id} message={m} onOpenDetails={setDetails} />
            ))}
          </ol>
        )}
        {pending && (
          <p className="mt-4 flex items-center gap-2 text-sm text-fg-muted" role="status">
            <Spinner className="size-4" /> העוזר מחפש וחושב…
          </p>
        )}
        {failed && (
          <Callout
            tone="danger"
            className="mt-4"
            role="alert"
            title="לא התקבלה תשובה"
            action={
              <Button size="sm" variant="secondary" onClick={() => submit(failed.text, false)}>
                ניסיון חוזר
              </Button>
            }
          >
            {failed.error}
          </Callout>
        )}
        <div ref={endRef} />
      </section>

      <div className="flex flex-wrap gap-2" aria-label="דוגמאות לבקשות">
        {EXAMPLE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            disabled={pending}
            onClick={() => {
              setDraft(p);
              inputRef.current?.focus();
            }}
            className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-sand-400 hover:bg-sand-50 hover:text-fg disabled:opacity-55"
          >
            {p}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft, true);
        }}
      >
        <label htmlFor="assistant-composer" className="sr-only">
          הודעה לעוזר
        </label>
        <Textarea
          id="assistant-composer"
          ref={inputRef}
          rows={3}
          maxLength={AI_MESSAGE_MAX_CHARS}
          value={draft}
          disabled={pending}
          placeholder="לדוגמה: טיסה לרומא ב-12 בדצמבר לשני מבוגרים וילד בן 6"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-describedby="assistant-composer-hint"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id="assistant-composer-hint" className="text-xs text-fg-subtle">
            Enter לשליחה · Shift+Enter לשורה חדשה ·{' '}
            <span className={remaining < 100 ? 'font-semibold text-coral-700' : undefined} data-testid="char-counter">
              {draft.length}/{AI_MESSAGE_MAX_CHARS}
            </span>
          </p>
          <Button type="submit" loading={pending} disabled={!draft.trim()} trailingIcon={<SendHorizontal className="rtl:-scale-x-100" aria-hidden="true" />}>
            שליחה
          </Button>
        </div>
      </form>

      <p className="rounded-lg border border-line bg-surface px-4 py-3 text-xs leading-relaxed text-fg-muted" data-testid="cannot-book-note">
        העוזר אינו יכול להזמין, לשלם או לאשר דבר. הוא רק מחפש ומציג הצעות. הכנת הזמנה נעשית בנפרד, בעמוד &quot;סקירת הזמנות&quot;, באישור מפורש שלכם.
      </p>

      <OfferDetailDialog offer={details} onOpenChange={(open) => !open && setDetails(null)} />
    </div>
  );
}
