import { cn } from '@/lib/cn';
import type { ScoreBreakdown } from '@/lib/schemas/offers';
import { scoreNumber } from '../decimal';
import { FACTOR_HELP, FACTOR_LABELS, FACTOR_ORDER } from '../labels';

function barTone(v: number): string {
  if (v >= 75) return 'bg-moss-600';
  if (v >= 50) return 'bg-sea-600';
  if (v >= 30) return 'bg-amber-500';
  return 'bg-coral-500';
}

export function ScoreBadge({ score, className }: { score: ScoreBreakdown; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1 rounded-full bg-ink-900 px-2.5 py-0.5 text-xs font-semibold text-white tabular-nums',
        !score.comparable && 'bg-ink-500',
        className,
      )}
      dir="ltr"
      title={score.comparable ? 'ציון כולל (0–100)' : 'לא ניתן לדרג מול הצעות אחרות'}
    >
      <span className="sr-only">ציון כולל:</span>
      <bdi dir="ltr" className="inline-flex items-baseline gap-0.5">
        {score.total}
        <span className="text-2xs font-normal text-ink-200">/100</span>
      </bdi>
    </span>
  );
}

export interface ScoreExplanationProps {
  score: ScoreBreakdown;
  className?: string;
}

/** Transparent score: four weighted factors (0–100), their weights, and the Hebrew reasons from the server. */
export function ScoreExplanation({ score, className }: ScoreExplanationProps) {
  const values: Record<string, string> = {
    cost: score.cost,
    convenience: score.convenience,
    flexibility: score.flexibility,
    quality: score.quality,
  };
  return (
    <section className={cn('flex flex-col gap-3', className)} aria-label="הסבר הניקוד">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-fg">ציון כולל</p>
        <ScoreBadge score={score} />
      </div>
      {!score.comparable && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-700">
          ההצעה לא ניתנת להשוואה מלאה מול הצעות אחרות (למשל מטבעות שונים), ולכן רכיב העלות לא דורג.
        </p>
      )}
      <ul className="flex flex-col gap-2.5">
        {FACTOR_ORDER.map((f) => {
          const v = scoreNumber(values[f]);
          const weight = score.weights[f] ?? 0;
          return (
            <li key={f} className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className="text-fg-muted" title={FACTOR_HELP[f]}>
                {FACTOR_LABELS[f]}
                <span className="ms-1 text-xs text-fg-subtle">({weight}%)</span>
              </span>
              <div
                role="meter"
                aria-label={`${FACTOR_LABELS[f]}: ${values[f]} מתוך 100, משקל ${weight}%`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={v}
                className="h-2 overflow-hidden rounded-full bg-ink-100"
              >
                <div className={cn('h-full rounded-full', barTone(v))} style={{ width: `${v}%` }} />
              </div>
              <span className="w-10 text-end font-medium tabular-nums text-fg">{values[f]}</span>
            </li>
          );
        })}
      </ul>
      {score.reasons.length > 0 && (
        <ul className="flex list-disc flex-col gap-1 ps-5 text-sm leading-relaxed text-fg-muted marker:text-sea-500">
          {score.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
      <p className="text-xs leading-relaxed text-fg-subtle">
        הציון הכולל = סכום (משקל × ציון הגורם) ÷ 100. הציון נועד לעזור למיין — לא מחליף את שיקול הדעת שלכם.
      </p>
    </section>
  );
}
