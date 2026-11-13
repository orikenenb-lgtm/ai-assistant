import { Scale } from 'lucide-react';
import { useState } from 'react';
import { Button, Callout, useToast } from '@/components/ui';
import { FACTOR_HELP, FACTOR_LABELS, FACTOR_ORDER } from '@/features/offers/labels';
import { rebalance, sumWeights, toWeights, weightsEqual, WEIGHT_PRESETS, type Weights } from '@/features/search/weights';
import { errorMessage } from '@/lib/api';
import type { Settings } from '@/lib/schemas/settings';
import { useSaveSetting } from '../hooks';
import { SettingsSection } from './SettingsSection';

export function RankingWeightsSection({ settings, editable }: { settings: Settings; editable: boolean }) {
  const saved = toWeights(settings.ranking_weights);
  const [draft, setDraft] = useState<Weights | null>(null);
  const weights = draft ?? saved;
  const save = useSaveSetting();
  const { toast } = useToast();
  const dirty = !weightsEqual(weights, saved);
  const total = sumWeights(weights);

  return (
    <SettingsSection
      id="ranking"
      title="משקלות הדירוג"
      description="איך נקבע מקום ההצעה בדירוג. כל ארבעת המשקלות מחוברים וסכומם תמיד 100."
      icon={<Scale />}
      readOnlyReason={editable ? undefined : 'צפייה בלבד'}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2" role="group" aria-label="הגדרות מוכנות">
          {WEIGHT_PRESETS.map((p) => (
            <Button key={p.id} size="sm" variant={weightsEqual(weights, p.weights) ? 'accent' : 'secondary'} disabled={!editable} title={p.description} onClick={() => setDraft({ ...p.weights })}>
              {p.label}
            </Button>
          ))}
        </div>
        <ul className="grid gap-4 md:grid-cols-2">
          {FACTOR_ORDER.map((f) => (
            <li key={f} className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`w-num-${f}`} className="text-sm font-medium text-fg">
                  {FACTOR_LABELS[f]}
                </label>
                <input
                  id={`w-num-${f}`}
                  type="number"
                  min={0}
                  max={100}
                  value={weights[f]}
                  disabled={!editable}
                  dir="ltr"
                  onChange={(e) => setDraft(rebalance(weights, f, Number(e.target.value)))}
                  className="h-9 w-20 rounded-md border border-control bg-surface px-2 text-center text-sm tabular-nums focus-visible:outline-2 focus-visible:outline-focus disabled:bg-ink-50 pointer-coarse:h-touch"
                />
              </div>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={weights[f]}
                disabled={!editable}
                aria-label={`משקל ${FACTOR_LABELS[f]}`}
                onChange={(e) => setDraft(rebalance(weights, f, Number(e.target.value)))}
                className="w-full accent-sea-600 pointer-coarse:h-touch"
              />
              <p className="text-xs text-fg-subtle">{FACTOR_HELP[f]}</p>
            </li>
          ))}
        </ul>
        <p className="text-sm text-fg-muted" aria-live="polite" data-testid="weights-total">
          סה״כ: <strong className={total === 100 ? 'text-fg' : 'text-coral-700'}>{total}</strong> / 100
        </p>
        {save.isError && (
          <Callout tone="danger" role="alert">
            {errorMessage(save.error)}
          </Callout>
        )}
        {editable && (
          <div className="flex gap-2">
            <Button
              loading={save.isPending}
              disabled={!dirty || total !== 100}
              onClick={() =>
                save.mutate(
                  { path: 'ranking-weights', body: { ...weights } },
                  {
                    onSuccess: () => {
                      setDraft(null);
                      toast({ title: 'משקלות הדירוג נשמרו', tone: 'success' });
                    },
                  },
                )
              }
            >
              שמירת משקלות
            </Button>
            {dirty && (
              <Button variant="ghost" onClick={() => setDraft(null)}>
                ביטול שינויים
              </Button>
            )}
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
