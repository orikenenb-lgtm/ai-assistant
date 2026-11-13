import { RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { FACTOR_HELP, FACTOR_LABELS, FACTOR_ORDER } from '@/features/offers/labels';
import { DEFAULT_WEIGHTS, WEIGHT_PRESETS, rebalance, sumWeights, weightsEqual, type Weights } from '../weights';

export interface RerankPanelProps {
  /** Weights currently applied to the shown ranking (from the server). */
  applied: Weights;
  pending: boolean;
  onApply: (weights: Weights) => void;
}

/** Four linked sliders (always sum to 100) + presets. Applying calls GET /api/search/{id}?weights=… */
export function RerankPanel({ applied, pending, onApply }: RerankPanelProps) {
  const [draft, setDraft] = useState<Weights>(applied);
  const unchanged = weightsEqual(draft, applied);
  const sum = sumWeights(draft);

  return (
    <section aria-labelledby="rerank-title" className="flex flex-col gap-4">
      <div>
        <h3 id="rerank-title" className="text-sm font-bold text-fg">
          דירוג לפי העדפות שלכם
        </h3>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
          קבעו כמה כל גורם חשוב. שינוי משקל אחד מחלק מחדש את השאר, והסכום תמיד 100%.
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="הגדרות מוכנות">
        {WEIGHT_PRESETS.map((p) => {
          const on = weightsEqual(draft, p.weights);
          return (
            <button
              key={p.id}
              type="button"
              title={p.description}
              aria-pressed={on}
              onClick={() => setDraft({ ...p.weights })}
              className={
                on
                  ? 'h-8 rounded-full border border-sea-600 bg-sea-600 px-3 text-xs font-medium text-white'
                  : 'h-8 rounded-full border border-line-strong bg-surface px-3 text-xs font-medium text-fg-muted hover:bg-sand-50'
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>
      <ul className="flex flex-col gap-3.5">
        {FACTOR_ORDER.map((f) => (
          <li key={f}>
            <div className="flex items-baseline justify-between text-sm">
              <label htmlFor={`weight-${f}`} className="font-medium text-fg">
                {FACTOR_LABELS[f]}
              </label>
              <output htmlFor={`weight-${f}`} className="tabular-nums text-fg-muted">
                {draft[f]}%
              </output>
            </div>
            <input
              id={`weight-${f}`}
              type="range"
              min={0}
              max={100}
              step={1}
              value={draft[f]}
              aria-valuetext={`${draft[f]} אחוז`}
              aria-describedby={`weight-${f}-help`}
              onChange={(e) => setDraft(rebalance(draft, f, Number(e.target.value)))}
              className="mt-1 h-2 w-full cursor-pointer accent-sea-600"
            />
            <p id={`weight-${f}-help`} className="text-xs text-fg-subtle">
              {FACTOR_HELP[f]}
            </p>
          </li>
        ))}
      </ul>
      <p className={sum === 100 ? 'text-xs text-fg-muted' : 'text-xs font-semibold text-coral-700'}>סה״כ: {sum}%</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={pending} disabled={unchanged || sum !== 100} onClick={() => onApply(draft)}>
          החלת הדירוג
        </Button>
        <Button
          size="sm"
          variant="ghost"
          leadingIcon={<RotateCcw aria-hidden="true" />}
          disabled={weightsEqual(draft, DEFAULT_WEIGHTS) && weightsEqual(applied, DEFAULT_WEIGHTS)}
          onClick={() => {
            setDraft({ ...DEFAULT_WEIGHTS });
            if (!weightsEqual(applied, DEFAULT_WEIGHTS)) onApply({ ...DEFAULT_WEIGHTS });
          }}
        >
          איפוס
        </Button>
      </div>
    </section>
  );
}
