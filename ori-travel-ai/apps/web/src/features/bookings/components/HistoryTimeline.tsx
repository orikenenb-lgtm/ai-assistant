import { History } from 'lucide-react';
import { Card, CardHeader, DateText } from '@/components/ui';
import type { ExecutionMode, HistoryEntry } from '@/lib/schemas/bookings';
import { STATE_LABELS, isBookingState } from '../labels';
import { PlainTextLine } from './PlainTextLine';

/** Hosted checkout: "approved" means the TERMS were approved — it must not read as an approved booking. */
const HOSTED: Record<string, string> = { APPROVED: 'תנאים אושרו — ממתין לספק', SUBMITTING: 'הושלם באתר הספק' };

const labelFor = (mode?: ExecutionMode) => (s: string | null | undefined) =>
  s ? ((mode === 'HOSTED_CHECKOUT' ? HOSTED[s] : undefined) ?? (isBookingState(s) ? STATE_LABELS[s] : s)) : 'התחלה';

export function HistoryTimeline({ history, mode }: { history: HistoryEntry[]; mode?: ExecutionMode }) {
  const label = labelFor(mode);
  return (
    <Card as="section" padding="md">
      <CardHeader title="היסטוריה" icon={<History />} />
      {history.length === 0 ? (
        <p className="text-sm text-fg-muted">אין עדיין אירועים.</p>
      ) : (
        <ol className="flex flex-col gap-0 border-s-2 border-line ps-5" data-testid="history">
          {history.map((h, i) => (
            <li key={`${h.at}-${i}`} className="relative pb-5 last:pb-0">
              <span className="absolute -start-[1.6rem] top-1.5 size-2.5 rounded-full bg-sea-600 ring-4 ring-surface" aria-hidden="true" />
              <p className="text-sm font-semibold text-fg">
                {label(h.from)} ← {label(h.to)}
              </p>
              <p className="text-xs text-fg-muted">
                <DateText value={h.at} preset="datetime" />
                {h.by_name ? ` · ${h.by_name}` : ''}
              </p>
              {h.reason && (
                <p className="mt-0.5 text-sm text-fg-muted">
                  <PlainTextLine text={h.reason} />
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
