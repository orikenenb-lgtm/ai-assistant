import { ChevronDown, ChevronUp, Clock, Pause, Pencil, Play, RefreshCw, Target, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';
import { Badge, Button, Callout, Card, ConfirmDialog, DataTable, DateText, IconButton, ModeBadge, MoneyText, useToast } from '@/components/ui';
import { describeSearchParams } from '@/features/search/describe';
import { isApiError } from '@/lib/api';
import { CATEGORY_SINGULAR } from '@/lib/labels';
import type { Alert, Snapshot } from '@/lib/schemas/alerts';
import { useCheckAlert, useDeleteAlert, useSnapshots, useUpdateAlert } from '../hooks';
import { ALERT_STATUS_TONES, alertStatusLabel, SNAPSHOT_STATUS_LABELS } from '../labels';
import { intervalLabel } from '../paramsForm';
import { Sparkline } from './Sparkline';

export interface AlertCardProps {
  alert: Alert;
  editable: boolean;
  showOwner: boolean;
  onEdit: (alert: Alert) => void;
}

export function AlertCard({ alert, editable, showOwner, onEdit }: AlertCardProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [cooldown, setCooldown] = useState<string | null>(null);
  const panelId = useId();
  const check = useCheckAlert();
  const update = useUpdateAlert();
  const del = useDeleteAlert();
  const snapshots = useSnapshots(alert.id, open);

  function runCheck() {
    setCooldown(null);
    check.mutate(alert.id, {
      onSuccess: (r) => {
        if (r.status !== 'OK') {
          toast({ title: 'הבדיקה הסתיימה', description: r.alert.last_error ?? alertStatusLabel(r.status), tone: 'warn' });
        } else if (r.target_reached) {
          toast({ title: 'יעד המחיר הושג', description: 'המחיר הטוב ביותר שווה או נמוך ממחיר היעד.', tone: 'success' });
        } else {
          toast({ title: 'הבדיקה הושלמה', description: 'עדיין לא הגענו למחיר היעד.', tone: 'info' });
        }
        setOpen(true);
      },
      onError: (e) => {
        if (isApiError(e) && e.status === 429) {
          setCooldown(e.message);
          toast({ title: 'אפשר לבדוק שוב בעוד כמה דקות', description: e.message, tone: 'warn' });
        } else {
          toast({ title: 'הבדיקה נכשלה', description: isApiError(e) ? e.message : 'נסו שוב.', tone: 'danger' });
        }
      },
    });
  }

  const columns = [
    { id: 'when', header: 'מתי', cell: (s: Snapshot) => <DateText value={s.captured_at} preset="datetime" /> },
    { id: 'price', header: 'מחיר', cell: (s: Snapshot) => <MoneyText value={s.price} /> },
    { id: 'mode', header: 'מקור', cell: (s: Snapshot) => (s.mode ? <ModeBadge mode={s.mode} size="sm" /> : <span className="text-fg-subtle">—</span>) },
    {
      id: 'status',
      header: 'סטטוס',
      cell: (s: Snapshot) => (
        <span>
          {SNAPSHOT_STATUS_LABELS[s.status] ?? s.status}
          {s.error_message && <span className="block text-xs text-fg-subtle">{s.error_message}</span>}
        </span>
      ),
    },
  ];

  return (
    <Card as="article" padding="none" data-testid="alert-card" data-alert-id={alert.id} aria-label={alert.name}>
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-fg">{alert.name}</h3>
            <p className="mt-0.5 text-sm text-fg-muted">
              {CATEGORY_SINGULAR[alert.category]} · {describeSearchParams(alert.category, alert.search_params)}
            </p>
            {showOwner && alert.owner_name && <p className="text-xs text-fg-subtle">נוצרה על ידי {alert.owner_name}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={alert.is_active ? 'success' : 'muted'}>{alert.is_active ? 'פעילה' : 'מושהית'}</Badge>
            <Badge tone={ALERT_STATUS_TONES[alert.last_status] ?? 'neutral'}>{alertStatusLabel(alert.last_status)}</Badge>
          </div>
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="flex items-center gap-1 text-xs text-fg-subtle">
              <Target className="size-3.5" aria-hidden="true" />
              מחיר יעד
            </dt>
            <dd className="font-semibold text-fg">{alert.target_price ? <MoneyText value={alert.target_price} /> : <span className="font-normal text-fg-muted">לא הוגדר</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">המחיר הטוב ביותר בבדיקה האחרונה</dt>
            <dd className="flex flex-wrap items-center gap-1.5 font-semibold text-fg">
              {alert.last_best_price ? <MoneyText value={alert.last_best_price} /> : <span className="font-normal text-fg-muted">אין עדיין</span>}
              {alert.last_best_price && alert.last_best_mode && <ModeBadge mode={alert.last_best_mode} size="sm" />}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-xs text-fg-subtle">
              <Clock className="size-3.5" aria-hidden="true" />
              בדיקה אחרונה
            </dt>
            <dd className="text-fg">{alert.last_checked_at ? <DateText value={alert.last_checked_at} preset="datetime" /> : <span className="text-fg-muted">טרם נבדקה</span>}</dd>
          </div>
          <div>
            <dt className="text-xs text-fg-subtle">בדיקה אוטומטית הבאה ({intervalLabel(alert.check_interval_minutes)})</dt>
            <dd className="text-fg">{alert.is_active && alert.next_check_at ? <DateText value={alert.next_check_at} preset="datetime" /> : <span className="text-fg-muted">{alert.is_active ? 'אחרי הבדיקה הראשונה' : '—'}</span>}</dd>
          </div>
        </dl>

        {alert.last_error && alert.last_status !== 'OK' && (
          <Callout tone={alert.last_status === 'FAILED' ? 'danger' : 'warn'}>{alert.last_error}</Callout>
        )}
        {cooldown && (
          <Callout tone="warn" role="status">
            {cooldown}
          </Callout>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {editable && (
            <>
              <Button size="sm" variant="accent" leadingIcon={<RefreshCw aria-hidden="true" />} loading={check.isPending} disabled={!alert.is_active} onClick={runCheck}>
                בדוק עכשיו
              </Button>
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={alert.is_active ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
                loading={update.isPending}
                onClick={() =>
                  update.mutate(
                    { id: alert.id, body: { is_active: !alert.is_active } },
                    { onError: (e) => toast({ title: 'לא ניתן לעדכן', description: isApiError(e) ? e.message : undefined, tone: 'danger' }) },
                  )
                }
              >
                {alert.is_active ? 'השהיה' : 'הפעלה'}
              </Button>
              <IconButton label="עריכת שם, יעד ותדירות" icon={<Pencil />} size="sm" onClick={() => onEdit(alert)} />
              <IconButton label="מחיקת התראה" icon={<Trash2 />} size="sm" onClick={() => setDeleting(true)} />
            </>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ms-auto"
            aria-expanded={open}
            aria-controls={panelId}
            trailingIcon={open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
            onClick={() => setOpen((o) => !o)}
          >
            היסטוריית מחירים
          </Button>
        </div>

        {!alert.is_active && editable && <p className="text-xs text-fg-subtle">התראה מושהית לא נבדקת — לא ידנית ולא אוטומטית — עד שתופעל מחדש.</p>}
      </div>

      {open && (
        <div id={panelId} className="border-t border-line bg-surface-sunken p-4 sm:p-5">
          {snapshots.isPending ? (
            <p className="text-sm text-fg-muted">טוען היסטוריה…</p>
          ) : snapshots.isError ? (
            <Callout tone="danger">{isApiError(snapshots.error) ? snapshots.error.message : 'לא ניתן לטעון את ההיסטוריה'}</Callout>
          ) : (
            <div className="flex flex-col gap-4">
              <Sparkline snapshots={snapshots.data} currency={alert.currency} target={alert.target_price?.amount} />
              <DataTable
                caption={`היסטוריית בדיקות — ${alert.name}`}
                columns={columns}
                rows={snapshots.data.slice(0, 30)}
                getRowKey={(s) => s.id}
                dense
                empty={<p className="text-sm text-fg-muted">עוד לא בוצעו בדיקות. לחצו "בדוק עכשיו" כדי להתחיל.</p>}
              />
              {snapshots.data.length > 30 && <p className="text-xs text-fg-subtle">מוצגות 30 הבדיקות האחרונות.</p>}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="מחיקת התראה"
        description={`למחוק את ההתראה "${alert.name}" ואת היסטוריית המחירים שלה?`}
        confirmLabel="מחיקה"
        tone="danger"
        onConfirm={async () => {
          await del.mutateAsync(alert.id);
        }}
      />
    </Card>
  );
}
