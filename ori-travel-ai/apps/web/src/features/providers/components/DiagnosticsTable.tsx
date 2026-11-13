import { DataTable, FreshnessText, ModeBadge, type DataTableColumn } from '@/components/ui';
import type { ProviderDiagnostics } from '@/lib/schemas/providers';

const columns: DataTableColumn<ProviderDiagnostics>[] = [
  {
    id: 'provider',
    header: 'ספק',
    cell: (r) => <span className="font-medium text-fg">{r.display_name}</span>,
  },
  { id: 'mode', header: 'מצב נתונים', cell: (r) => <ModeBadge mode={r.mode} size="sm" /> },
  { id: 'status', header: 'מצב ספק', cell: (r) => <ModeBadge mode={r.status} size="sm" /> },
  { id: 'runs', header: 'ריצות', align: 'end', cell: (r) => <span className="tabular-nums">{r.runs}</span> },
  {
    id: 'breakdown',
    header: 'תקין / נכשל / פג זמן',
    hideOnMobile: true,
    cell: (r) => (
      <span className="tabular-nums text-fg-muted">
        {r.ok_runs} / {r.failed_runs} / {r.timeout_runs}
      </span>
    ),
  },
  {
    id: 'skipped',
    header: 'מטמון / דולגו',
    hideOnMobile: true,
    cell: (r) => (
      <span className="tabular-nums text-fg-muted">
        {r.cached_runs} / {r.skipped_runs}
      </span>
    ),
  },
  {
    id: 'rate',
    header: 'הצלחה',
    align: 'end',
    cell: (r) => (r.success_rate != null ? <span className="tabular-nums">{r.success_rate}%</span> : <span className="text-fg-subtle">—</span>),
  },
  {
    id: 'latency',
    header: 'זמן ממוצע',
    align: 'end',
    hideOnMobile: true,
    cell: (r) => (r.avg_latency_ms != null ? <span className="tabular-nums">{r.avg_latency_ms} מ״ש</span> : <span className="text-fg-subtle">—</span>),
  },
  {
    id: 'error',
    header: 'שגיאה אחרונה',
    hideOnMobile: true,
    cell: (r) =>
      r.last_error ? (
        <span className="text-xs text-fg-muted">
          {r.last_error.message ?? r.last_error.code ?? 'שגיאה'} · <FreshnessText value={r.last_error.at} prefix="" />
        </span>
      ) : (
        <span className="text-fg-subtle">אין</span>
      ),
  },
  {
    id: 'last',
    header: 'ריצה אחרונה',
    cell: (r) => (r.last_run_at ? <FreshnessText value={r.last_run_at} prefix="" /> : <span className="text-fg-subtle">עדיין לא רצה</span>),
  },
];

export function DiagnosticsTable({ rows, windowDays }: { rows: ProviderDiagnostics[]; windowDays: number }) {
  return <DataTable columns={columns} rows={rows} getRowKey={(r) => r.provider_id} caption={`אבחון ספקים ב-${windowDays} הימים האחרונים`} dense />;
}
