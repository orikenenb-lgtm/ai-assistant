import { ChevronDown, Scale, Search, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, ButtonLink, Callout, Card, Checkbox, EmptyState, ErrorState, FreshnessText, PageHeader, Skeleton } from '@/components/ui';
import { ComparisonTable } from '@/features/compare/ComparisonTable';
import { useComparison, useFxRates } from '@/features/compare/hooks';
import { COMPARE_MAX, COMPARE_MIN, compareSelection, useCompareSelection } from '@/features/offers';
import { RerankPanel } from '@/features/search/components/RerankPanel';
import { toWeights, type Weights } from '@/features/search/weights';
import { isApiError } from '@/lib/api';
import { CATEGORY_LABELS, CATEGORY_SEARCH_PATH } from '@/lib/labels';
import { CATEGORIES } from '@/lib/schemas/common';
import { formatDate } from '@/lib/format';

function SearchLinks() {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {CATEGORIES.map((c) => (
        <ButtonLink key={c} to={CATEGORY_SEARCH_PATH[c]} variant={c === 'flight' ? 'accent' : 'secondary'} size="sm" leadingIcon={<Search aria-hidden="true" />}>
          חיפוש {CATEGORY_LABELS[c]}
        </ButtonLink>
      ))}
    </div>
  );
}

export default function ComparePage() {
  const selection = useCompareSelection();
  const [weights, setWeights] = useState<Weights | undefined>(undefined);
  const [showFx, setShowFx] = useState(false);
  const [weightsOpen, setWeightsOpen] = useState(false);
  const comparison = useComparison(selection.ids, weights);
  const fx = useFxRates(showFx);
  const data = comparison.data;
  const hasFxData = !!data?.groups.some((g) => Object.keys(g.display_conversions).length > 0);

  const actions =
    selection.count > 0 ? (
      <Button variant="secondary" leadingIcon={<Trash2 aria-hidden="true" />} onClick={selection.clear}>
        ניקוי הבחירה ({selection.count})
      </Button>
    ) : null;

  return (
    <>
      <PageHeader
        title="השוואת הצעות"
        icon={<Scale />}
        description={`השוואה של ${COMPARE_MIN}–${COMPARE_MAX} הצעות זו לצד זו, עם הסבר לניקוד. הצעות מקטגוריות או מטבעות שונים מוצגות בנפרד.`}
        actions={actions}
      />

      {selection.count < COMPARE_MIN ? (
        <EmptyState
          icon={<Scale />}
          title={selection.count === 0 ? 'עוד לא נבחרו הצעות להשוואה' : 'נבחרה הצעה אחת — צריך לפחות שתיים'}
          description="בתוצאות החיפוש לחצו על ״השוואה״ בכרטיס ההצעה כדי להוסיף אותה לכאן. הבחירה נשמרת בלשונית הזו."
          action={<SearchLinks />}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {comparison.isPending ? (
            <div className="flex flex-col gap-4" aria-busy="true">
              <span className="sr-only" role="status">
                מחשבים השוואה…
              </span>
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-96 w-full" />
            </div>
          ) : comparison.isError || !data ? (
            <ErrorState
              title="לא ניתן להשוות את ההצעות"
              error={comparison.error}
              onRetry={() => void comparison.refetch()}
              retrying={comparison.isFetching}
              message={
                isApiError(comparison.error) && comparison.error.status === 404
                  ? 'אחת ההצעות שנבחרו כבר לא קיימת במערכת (ייתכן שפג תוקפה). נקו את הבחירה וחפשו מחדש.'
                  : undefined
              }
            />
          ) : (
            <>
              {data.groups.length > 1 && (
                <Callout tone="info" title="ההצעות חולקו לקבוצות">
                  לא משווים טיסה למלון, ולא משווים מחירים במטבעות שונים. כל קבוצה (קטגוריה + מטבע) מדורגת בנפרד, ואין המרת מטבע שקטה.
                </Callout>
              )}
              {data.notes.length > 0 && (
                <Callout tone="neutral" title="לשים לב">
                  <ul className="list-disc ps-5">
                    {data.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </Callout>
              )}

              <div className="flex flex-col gap-6">
                <div className="flex min-w-0 flex-col gap-6">
                  {hasFxData && (
                    <Card padding="sm" className="flex flex-col gap-2">
                      <Checkbox
                        label="הצגת המרה למטבע התצוגה (לצורכי תצוגה בלבד)"
                        description="ההמרה אינה משפיעה על הדירוג או על המחיר. שערי ההדגמה קבועים ואינם שערי שוק."
                        checked={showFx}
                        onChange={(e) => setShowFx(e.target.checked)}
                      />
                      {showFx && fx.data && (
                        <p className="flex flex-wrap items-center gap-2 text-xs text-fg-muted" data-testid="fx-note">
                          <Badge tone={fx.data.mode === 'DEMO' ? 'demo' : 'info'} size="sm">
                            שערים: {fx.data.mode === 'DEMO' ? 'הדגמה' : fx.data.mode === 'LIVE' ? 'חי' : 'שמור'}
                          </Badge>
                          <span>
                            {fx.data.source} · נכון ל-{formatDate(fx.data.as_of, 'date')} <FreshnessText value={fx.data.as_of} prefix="(" /> )
                          </span>
                          <span>{fx.data.note}</span>
                        </p>
                      )}
                      {showFx && fx.isError && <p className="text-xs text-coral-700">לא ניתן לטעון את פרטי השערים; ההמרות מהשרת מוצגות עם התווית שלהן.</p>}
                    </Card>
                  )}

                  <Card padding="sm" className="flex flex-col gap-3">
                    <button
                      type="button"
                      className="flex items-center justify-between gap-2 text-start text-sm font-semibold text-fg"
                      aria-expanded={weightsOpen}
                      aria-controls="compare-weights"
                      onClick={() => setWeightsOpen((v) => !v)}
                    >
                      התאמת משקלי הדירוג
                      <ChevronDown className={weightsOpen ? 'size-4 rotate-180' : 'size-4'} aria-hidden="true" />
                    </button>
                    <div id="compare-weights" hidden={!weightsOpen} className="max-w-md">
                      <RerankPanel key={JSON.stringify(data.weights)} applied={toWeights(data.weights)} pending={comparison.isFetching} onApply={(w) => setWeights(w)} />
                    </div>
                  </Card>

                  <div className={comparison.isFetching ? 'flex flex-col gap-8 opacity-60 transition-opacity' : 'flex flex-col gap-8'} aria-busy={comparison.isFetching}>
                    {data.groups.map((g) => (
                      <section key={`${g.category}-${g.currency}`} aria-labelledby={`grp-${g.category}-${g.currency}`} className="flex flex-col gap-3">
                        <div className="flex flex-wrap items-baseline gap-x-3">
                          <h2 id={`grp-${g.category}-${g.currency}`} className="text-lg font-bold text-fg">
                            {CATEGORY_LABELS[g.category]} · <span dir="ltr">{g.currency}</span>
                          </h2>
                          <span className="text-sm text-fg-muted">{g.offers.length} הצעות</span>
                        </div>
                        {g.offers.length === 1 && (
                          <Callout tone="neutral">יש כאן הצעה אחת בלבד בקבוצה הזו — אין מול מה לדרג אותה. הוסיפו עוד הצעות מאותה קטגוריה ובאותו מטבע.</Callout>
                        )}
                        <ComparisonTable
                          group={g}
                          showFx={showFx}
                          caption={`טבלת השוואה: ${CATEGORY_LABELS[g.category]} במטבע ${g.currency}`}
                          onRemove={compareSelection.remove}
                        />
                      </section>
                    ))}
                  </div>
                </div>

              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
