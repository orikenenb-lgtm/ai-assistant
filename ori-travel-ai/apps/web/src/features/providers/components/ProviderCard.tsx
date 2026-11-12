import { ExternalLink, KeyRound, ShieldCheck, Stethoscope } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, Button, Card, ConfirmDialog, FreshnessText, ModeBadge, Switch } from '@/components/ui';
import { CATEGORY_LABELS } from '@/lib/labels';
import { providerCategories, providerDisplayName, providerDocsUrl, providerMode, providerRateLimitNote, type ProviderStatus } from '@/lib/schemas/providers';
import { useHealthCheck, useUpdateProvider } from '../hooks';

function safeUrl(u: string | null): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface ProviderCardProps {
  provider: ProviderStatus;
  canCheck: boolean;
  isOwner: boolean;
}

export function ProviderCard({ provider: p, canCheck, isOwner }: ProviderCardProps) {
  const name = providerDisplayName(p);
  const mode = providerMode(p);
  const docs = safeUrl(providerDocsUrl(p));
  const rate = providerRateLimitNote(p);
  const check = useHealthCheck();
  const update = useUpdateProvider();
  const [confirm, setConfirm] = useState<boolean | null>(null);
  const credentials = p.requires_credentials;
  const checking = check.isPending && check.variables === p.provider_id;

  return (
    <Card as="article" aria-labelledby={`prov-${p.provider_id}`} className="flex flex-col gap-4" padding="sm" data-testid="provider-card" data-provider={p.provider_id}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`prov-${p.provider_id}`} className="text-base font-semibold text-fg">
            {name}
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-1.5">
            {mode && (p.status === 'NOT_CONFIGURED' || p.status === 'DISABLED') && mode === 'LIVE' ? (
              <Badge tone="neutral">ספק אמיתי (חי)</Badge>
            ) : (
              mode && <ModeBadge mode={mode} />
            )}
            <ModeBadge mode={p.status} />
            {providerCategories(p).map((c) => (
              <Badge key={c} tone="neutral" size="sm">
                {CATEGORY_LABELS[c]}
              </Badge>
            ))}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCheck && (
            <Button size="sm" variant="secondary" loading={checking} leadingIcon={<Stethoscope aria-hidden="true" />} onClick={() => check.mutate(p.provider_id)}>
              בדיקת תקינות
            </Button>
          )}
        </div>
      </header>

      {p.status === 'NOT_CONFIGURED' && (
        <p className="rounded-lg bg-surface-sunken p-3 text-sm leading-relaxed text-fg-muted">
          <strong className="font-semibold text-fg">לא מחובר:</strong> הספק מחכה לפרטי גישה בשרת, ולכן הוא לא משתתף בחיפושים. זה לא תקלה.{' '}
          <Link to="/help#connect-providers" className="font-medium text-accent underline-offset-4 hover:underline">
            איך מחברים ספק?
          </Link>
        </p>
      )}

      {p.notes && <p className="text-sm leading-relaxed text-fg-muted">{p.notes}</p>}

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-fg-subtle">מחובר</dt>
          <dd className="text-fg">{p.configured ? 'כן' : 'לא'}</dd>
        </div>
        <div>
          <dt className="text-xs text-fg-subtle">מופעל לחיפושים</dt>
          <dd className="text-fg">{p.enabled ? 'כן' : 'לא'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="flex items-center gap-1 text-xs text-fg-subtle">
            <KeyRound className="size-3" aria-hidden="true" />
            פרטי גישה נדרשים (שמות משתני סביבה בלבד)
          </dt>
          <dd className="mt-1">
            {credentials.length === 0 ? (
              <span className="text-fg-muted">לא נדרשים</span>
            ) : (
              <ul className="flex flex-wrap gap-1.5">
                {credentials.map((c) => (
                  <li key={c}>
                    <code dir="ltr" className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-xs text-fg">
                      {c}
                    </code>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
        {p.last_health && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-fg-subtle">בדיקת תקינות אחרונה</dt>
            <dd className="flex flex-wrap items-center gap-x-2 text-fg-muted">
              <ModeBadge mode={p.last_health.status} size="sm" />
              <span>{p.last_health.message}</span>
              {p.last_health.latency_ms != null && <span className="text-xs">{p.last_health.latency_ms} מ״ש</span>}
              <FreshnessText value={p.last_health.checked_at} className="text-xs text-fg-subtle" />
            </dd>
          </div>
        )}
        {rate && (
          <div className="sm:col-span-2">
            <dt className="text-xs text-fg-subtle">מגבלות קצב</dt>
            <dd className="text-fg-muted">{rate}</dd>
          </div>
        )}
      </dl>

      {p.setup_instructions && (
        <details className="group rounded-lg border border-line p-3 text-sm">
          <summary className="cursor-pointer font-medium text-fg">הוראות הגדרה</summary>
          <p className="mt-2 leading-relaxed text-fg-muted">{p.setup_instructions}</p>
        </details>
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
        {docs ? (
          <a href={docs} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-medium text-accent underline-offset-4 hover:underline">
            תיעוד רשמי <ExternalLink className="size-3.5" aria-hidden="true" />
            <span className="sr-only">(נפתח בלשונית חדשה)</span>
          </a>
        ) : (
          <span className="text-xs text-fg-subtle">אין תיעוד חיצוני (ספק מובנה)</span>
        )}
        {isOwner ? (
          <Switch
            className="min-w-48"
            label={p.enabled ? 'מופעל' : 'מושבת'}
            description="בעלים בלבד"
            checked={p.enabled}
            onCheckedChange={(next) => setConfirm(next)}
          />
        ) : (
          <Badge tone={p.enabled ? 'success' : 'muted'}>
            <ShieldCheck aria-hidden="true" />
            {p.enabled ? 'מופעל' : 'מושבת'} · שינוי — בעלים בלבד
          </Badge>
        )}
      </footer>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `להפעיל את ${name}?` : `להשבית את ${name}?`}
        description={
          confirm
            ? 'הספק ישתתף בחיפושים הבאים של כל המשפחה (אם הוא מחובר).'
            : 'הספק לא ישתתף יותר בחיפושים של כל המשפחה, עד שתפעילו אותו שוב. תוצאות שכבר נשמרו לא ייפגעו.'
        }
        confirmLabel={confirm ? 'הפעלה' : 'השבתה'}
        tone={confirm ? 'default' : 'danger'}
        onConfirm={async () => {
          await update.mutateAsync({ providerId: p.provider_id, enabled: !!confirm });
        }}
      />
    </Card>
  );
}

