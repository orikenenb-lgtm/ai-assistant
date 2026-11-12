import { Link } from 'react-router';
import { ModeBadge } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { ProviderRun, ProviderRunStatus } from '@/lib/schemas/search';

const DEFAULT_MESSAGES: Partial<Record<ProviderRunStatus, string>> = {
  FAILED: 'הספק לא החזיר תשובה תקינה. תוצאות ממנו אינן מוצגות.',
  TIMEOUT: 'הספק לא ענה בזמן. אפשר לנסות שוב בעוד רגע.',
  NOT_CONFIGURED: 'לא מחובר — חסרים פרטי גישה לספק, ולכן הוא לא נבדק.',
  DISABLED: 'הספק מושבת ולא נבדק.',
  UNSUPPORTED: 'הספק אינו תומך בחיפוש זה.',
};

const PROBLEM: ReadonlySet<ProviderRunStatus> = new Set(['FAILED', 'TIMEOUT', 'NOT_CONFIGURED', 'DISABLED', 'UNSUPPORTED']);

function duration(ms: number): string {
  return ms < 1000 ? `${ms} מ״ש` : `${(ms / 1000).toFixed(1)} שנ׳`;
}

export function runMessage(run: ProviderRun): string | null {
  if (!PROBLEM.has(run.status)) return null;
  return run.message?.trim() || DEFAULT_MESSAGES[run.status] || null;
}

/** One card per provider run: name, mode, status, result count, duration and a Hebrew explanation when it did not answer. */
export function ProviderStatusStrip({ providers, className }: { providers: ProviderRun[]; className?: string }) {
  const answered = providers.filter((p) => p.status === 'OK' || p.status === 'CACHED').length;
  const hasNotConfigured = providers.some((p) => p.status === 'NOT_CONFIGURED');
  return (
    <section aria-labelledby="provider-strip-title" className={cn('flex flex-col gap-3', className)} data-testid="provider-strip">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="provider-strip-title" className="text-sm font-semibold text-fg">
          מקורות החיפוש
          <span className="ms-2 text-xs font-normal text-fg-muted">
            {answered} מתוך {providers.length} ענו
          </span>
        </h2>
        <Link to="/providers" className="text-xs font-medium text-accent underline-offset-4 hover:underline">
          ניהול ספקים ואבחון
        </Link>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {providers.map((run) => {
          const message = runMessage(run);
          const problem = PROBLEM.has(run.status);
          return (
            <li
              key={run.provider_id}
              data-status={run.status}
              className={cn('flex flex-col gap-1.5 rounded-lg border p-3', problem ? 'border-line bg-surface-sunken' : 'border-line bg-surface')}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 text-sm font-medium text-fg">{run.provider_name}</span>
                <span className="flex shrink-0 flex-wrap justify-end gap-1">
                  {(run.status === 'OK' || run.status === 'CACHED') && <ModeBadge mode={run.mode} size="sm" />}
                  <ModeBadge mode={run.status} size="sm" />
                </span>
              </div>
              {(run.status === 'OK' || run.status === 'CACHED') && (
                <p className="text-xs text-fg-muted">
                  {run.result_count} תוצאות{run.duration_ms != null && <> · {duration(run.duration_ms)}</>}
                </p>
              )}
              {message && <p className="text-xs leading-relaxed text-fg-muted">{message}</p>}
              {run.status === 'OK' && run.mode === 'DEMO' && run.message && <p className="text-xs text-fg-subtle">{run.message}</p>}
            </li>
          );
        })}
      </ul>
      {hasNotConfigured && (
        <p className="text-xs leading-relaxed text-fg-muted">
          "לא מחובר" אומר שחסרים פרטי גישה לספק אמיתי, ולכן אין ממנו תוצאות — זה לא תקלה.{' '}
          <Link to="/help#providers" className="font-medium text-accent underline-offset-4 hover:underline">
            איך מחברים ספק?
          </Link>
        </p>
      )}
    </section>
  );
}
