import { Link } from 'react-router';
import { Bot, ExternalLink, ShieldAlert, User } from 'lucide-react';
import { Badge, Callout } from '@/components/ui';
import { OfferCard } from '@/features/offers';
import { cn } from '@/lib/cn';
import { CATEGORY_SEARCH_PATH } from '@/lib/labels';
import type { CanonicalOffer } from '@/lib/schemas/offers';
import { TOOL_LABELS, TOOL_STATUS_LABELS } from '../labels';
import type { ChatMessage } from '../conversation';
import { PlainText } from './PlainText';

export function searchHref(searchId: string, cards: CanonicalOffer[]): string {
  const categories = new Set(cards.map((c) => c.category));
  const base = categories.size === 1 ? CATEGORY_SEARCH_PATH[[...categories][0]!] : CATEGORY_SEARCH_PATH.flight;
  // The search page redirects to the right category if the search belongs to another one.
  return `${base}?search_id=${encodeURIComponent(searchId)}`;
}

export interface MessageProps {
  message: ChatMessage;
  onOpenDetails: (offer: CanonicalOffer) => void;
}

export function ChatMessageView({ message, onOpenDetails }: MessageProps) {
  if (message.role === 'user') {
    return (
      <li className="flex items-start gap-2.5 self-start" data-testid="chat-user-message">
        <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-ink-900 text-white" aria-hidden="true">
          <User className="size-4" />
        </span>
        <div className="max-w-[min(34rem,85vw)] rounded-2xl rounded-ss-sm bg-sea-50 px-4 py-3 text-sm leading-relaxed text-fg ring-1 ring-sea-200">
          <span className="sr-only">אתם: </span>
          <PlainText text={message.text} />
        </div>
      </li>
    );
  }
  const reply = message.reply;
  return (
    <li className="flex items-start gap-2.5" data-testid="chat-assistant-message">
      <span className="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-sun-400 text-ink-950" aria-hidden="true">
        <Bot className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="rounded-2xl rounded-ss-sm border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-fg shadow-xs">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <span className="sr-only">העוזר: </span>
            {reply && (
              <Badge tone={reply.mode === 'model' ? 'accent' : 'muted'} size="sm" data-testid="reply-mode">
                {reply.mode === 'model' ? 'תשובת מודל AI' : 'מצב בסיסי'}
              </Badge>
            )}
          </div>
          <PlainText text={message.text} />
        </div>

        {reply?.clarifying_question && (
          <Callout tone="info" title="שאלה להבהרה" data-testid="clarifying-question">
            <PlainText text={reply.clarifying_question} />
          </Callout>
        )}

        {reply && reply.warnings.length > 0 && (
          <Callout tone="warn" title="שימו לב">
            <ul className="list-disc ps-5">
              {reply.warnings.map((w, i) => (
                <li key={i}>
                  <PlainText text={w} className="inline" />
                </li>
              ))}
            </ul>
          </Callout>
        )}

        {reply && !reply.grounding.ok && (
          <Callout tone="warn" icon={<ShieldAlert />} title="הוסרו מחירים שלא אומתו מול תוצאות החיפוש" data-testid="grounding-notice">
            העוזר מציג מחירים רק מתוך תוצאות החיפוש של המערכת. טענות שלא נמצאה להן תמיכה הוסרו מהתשובה.
          </Callout>
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <ul className="flex flex-wrap items-center gap-1.5" aria-label="פעולות שהעוזר ביצע">
            {message.toolCalls.map((t, i) => (
              <li key={`${t.name}-${i}`}>
                <Badge tone={t.status === 'ok' ? 'info' : 'warn'} size="sm" data-testid="tool-chip">
                  {TOOL_LABELS[t.name] ?? t.name} · {TOOL_STATUS_LABELS[t.status] ?? t.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {reply && reply.cards.length > 0 && (
          <div className="flex flex-col gap-3" data-testid="chat-cards">
            <p className="text-xs text-fg-muted">המחירים מוצגים אך ורק מתוצאות החיפוש של המערכת, עם המקור והמצב שלהן.</p>
            <div className="grid gap-3 xl:grid-cols-2">
              {reply.cards.map((offer) => (
                <OfferCard key={offer.id} offer={offer} onOpenDetails={onOpenDetails} className={cn('h-full')} />
              ))}
            </div>
          </div>
        )}

        {reply && reply.search_ids.length > 0 && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {reply.search_ids.map((id, i) => (
              <li key={id}>
                <Link
                  to={searchHref(id, reply.cards)}
                  className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  {reply.search_ids.length > 1 ? `פתיחת החיפוש המלא (${i + 1})` : 'פתיחת החיפוש המלא'}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
