import { AlertTriangle, Ban, Check, CircleHelp, Clock } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { ExecutionMode, HistoryEntry } from '@/lib/schemas/bookings';
import { STATE_LABELS, isBookingState } from '../labels';
import { buildStepper, type SideState } from '../stepper';

const SIDE_STYLE: Record<SideState, { cls: string; Icon: typeof Ban }> = {
  EXPIRED: { cls: 'border-ink-300 bg-ink-50 text-ink-700', Icon: Clock },
  FAILED: { cls: 'border-coral-200 bg-coral-50 text-coral-700', Icon: AlertTriangle },
  UNKNOWN: { cls: 'border-coral-300 bg-coral-50 text-coral-700', Icon: CircleHelp },
  CANCELLED: { cls: 'border-ink-300 bg-ink-50 text-ink-700', Icon: Ban },
};

/** State-machine stepper: the main flow plus a clearly separate side-state chip (expired / failed / unknown / cancelled). */
export function BookingStepper({ state, history, mode }: { state: string; history: HistoryEntry[]; mode?: ExecutionMode }) {
  const model = buildStepper(state, history, mode);
  return (
    <div className="flex flex-col gap-3" data-testid="booking-stepper">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" aria-label="שלבי ההזמנה">
        {model.steps.map((s, i) => (
          <li
            key={s.key}
            data-status={s.status}
            aria-current={s.status === 'current' ? 'step' : undefined}
            className={cn(
              'flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm',
              s.status === 'done' && 'border-moss-200 bg-moss-50 text-moss-700',
              s.status === 'current' && 'border-sea-500 bg-sea-50 font-semibold text-sea-700 ring-1 ring-sea-500',
              s.status === 'todo' && 'border-line bg-surface text-fg-subtle',
              s.status === 'problem' && 'border-coral-300 bg-coral-50 font-semibold text-coral-700',
            )}
          >
            <span
              className={cn(
                'grid size-6 shrink-0 place-items-center rounded-full text-xs font-bold tabular-nums',
                s.status === 'done' && 'bg-moss-600 text-white',
                s.status === 'current' && 'bg-sea-600 text-white',
                s.status === 'todo' && 'bg-ink-100 text-ink-600',
                s.status === 'problem' && 'bg-coral-600 text-white',
              )}
              aria-hidden="true"
            >
              {s.status === 'done' ? <Check className="size-3.5" /> : s.status === 'problem' ? '!' : i + 1}
            </span>
            <span className="min-w-0 leading-snug">
              {s.label}
              <span className="sr-only">
                {s.status === 'done' ? ' — הושלם' : s.status === 'current' ? ' — השלב הנוכחי' : s.status === 'problem' ? ' — כאן נעצר התהליך' : ' — טרם'}
              </span>
            </span>
          </li>
        ))}
      </ol>
      {model.side && (
        <p
          className={cn('flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold', SIDE_STYLE[model.side].cls)}
          data-testid="side-state"
          data-state={model.side}
        >
          {(() => {
            const Icon = SIDE_STYLE[model.side].Icon;
            return <Icon className="size-4 shrink-0" aria-hidden="true" />;
          })()}
          מצב סופי: {isBookingState(model.side) ? STATE_LABELS[model.side] : model.side}
        </p>
      )}
    </div>
  );
}
