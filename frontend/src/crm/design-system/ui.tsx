// רכיבי הבסיס של ה-CRM — כולם RTL, עם וריאנטים, נשענים על tokens.css.
import { useMemo, useState } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react'
import { hexToSoft, darken } from './colors'

// ---------- Button ----------
type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  children,
  className = '',
  ...rest
}: { variant?: BtnVariant; size?: 'sm' | 'md' | 'lg'; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizeCls = size === 'sm' ? 'crm-btn-sm' : size === 'lg' ? 'crm-btn-lg' : ''
  return (
    <button className={`crm-btn crm-btn-${variant} ${sizeCls} ${className}`} disabled={loading || rest.disabled} {...rest}>
      {loading && <span className="crm-spinner" aria-hidden />}
      {children}
    </button>
  )
}

// ---------- Card ----------
export function Card({ children, hover = false, className = '', style }: { children: ReactNode; hover?: boolean; className?: string; style?: React.CSSProperties }) {
  return <div className={`crm-card ${hover ? 'crm-card-hover' : ''} ${className}`} style={style}>{children}</div>
}

// ---------- Badge ----------
export function Badge({ children, color, soft = true }: { children: ReactNode; color?: string; soft?: boolean }) {
  const style = color
    ? soft
      ? { background: hexToSoft(color), color: darken(color) }
      : { background: color, color: '#fff' }
    : undefined
  return (
    <span className="crm-badge" style={style}>
      {color && <span className="crm-badge-dot" style={{ background: color }} />}
      {children}
    </span>
  )
}

// ---------- Input / Select / Field ----------
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="crm-input" {...props} />
}
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="crm-select" {...props} />
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 'var(--crm-s4)' }}>
      <span className="crm-label">{label}</span>
      {children}
    </label>
  )
}

// ---------- Tabs ----------
export function Tabs<T extends string>({ tabs, active, onChange }: { tabs: { id: T; label: string }[]; active: T; onChange: (id: T) => void }) {
  return (
    <div className="crm-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={active === t.id}
          className={`crm-tab ${active === t.id ? 'crm-tab-active' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ---------- StatCard (KPI) ----------
export function StatCard({ label, value, delta, hint }: { label: string; value: ReactNode; delta?: number; hint?: string }) {
  return (
    <Card hover>
      <div className="crm-stat">
        <span className="crm-stat-label">{label}</span>
        <span className="crm-stat-value">{value}</span>
        {delta !== undefined && (
          <span className={`crm-stat-delta ${delta >= 0 ? 'crm-up' : 'crm-down'}`}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(1)}% {hint && <span className="crm-caption">{hint}</span>}
          </span>
        )}
      </div>
    </Card>
  )
}

// ---------- Skeleton / Spinner / EmptyState ----------
export function Skeleton({ h = 16, w = '100%', r = 6 }: { h?: number; w?: number | string; r?: number }) {
  return <div className="crm-skeleton" style={{ height: h, width: w, borderRadius: r }} />
}
export function Spinner() {
  return <span className="crm-spinner" />
}
export function EmptyState({ icon = '📭', title, subtitle, action }: { icon?: string; title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', padding: 'var(--crm-s8) var(--crm-s4)', color: 'var(--crm-text-soft)' }}>
      <div style={{ fontSize: 44, marginBottom: 'var(--crm-s3)' }}>{icon}</div>
      <div className="crm-h3" style={{ color: 'var(--crm-text)' }}>{title}</div>
      {subtitle && <p className="crm-caption" style={{ marginTop: 6 }}>{subtitle}</p>}
      {action && <div style={{ marginTop: 'var(--crm-s4)' }}>{action}</div>}
    </div>
  )
}

// ---------- Modal ----------
export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode }) {
  if (!open) return null
  return (
    <div className="crm-modal-overlay" onClick={onClose}>
      <div className="crm-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--crm-s4)' }}>
          <h2 className="crm-h2">{title}</h2>
          <button className="crm-btn crm-btn-ghost crm-btn-sm" onClick={onClose} aria-label="סגור">✕</button>
        </div>
        {children}
        {footer && <div style={{ display: 'flex', gap: 'var(--crm-s2)', justifyContent: 'flex-start', marginTop: 'var(--crm-s5)' }}>{footer}</div>}
      </div>
    </div>
  )
}

// ---------- Insight card ----------
export function InsightCard({ children }: { children: ReactNode }) {
  return (
    <div className="crm-insight">
      <span style={{ fontSize: 22, lineHeight: 1 }}>💡</span>
      <div className="crm-body" style={{ fontWeight: 600 }}>{children}</div>
    </div>
  )
}

// ---------- Sortable, paginated table ----------
export interface Column<R> { key: string; label: string; sortable?: boolean; render?: (row: R) => ReactNode; value?: (row: R) => string | number }
export function DataTable<R extends Record<string, unknown>>({ columns, rows, pageSize = 10, onRowClick, empty }: {
  columns: Column<R>[]; rows: R[]; pageSize?: number; onRowClick?: (row: R) => void; empty?: ReactNode
}) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [asc, setAsc] = useState(true)
  const [page, setPage] = useState(0)

  const sorted = useMemo(() => {
    if (!sortKey) return rows
    const col = columns.find((c) => c.key === sortKey)
    if (!col) return rows
    const val = (r: R) => (col.value ? col.value(r) : (r[sortKey] as string | number))
    return [...rows].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (va === vb) return 0
      return (va > vb ? 1 : -1) * (asc ? 1 : -1)
    })
  }, [rows, sortKey, asc, columns])

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const slice = sorted.slice(page * pageSize, page * pageSize + pageSize)

  if (rows.length === 0 && empty) return <>{empty}</>

  return (
    <div>
      <div style={{ overflowX: 'auto' }}>
        <table className="crm-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.sortable ? 'crm-sortable' : ''}
                  onClick={() => { if (!c.sortable) return; if (sortKey === c.key) setAsc(!asc); else { setSortKey(c.key); setAsc(true) } }}>
                  {c.label}{c.sortable && sortKey === c.key ? (asc ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slice.map((row, i) => (
              <tr key={i} onClick={() => onRowClick?.(row)} style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
                {columns.map((c) => <td key={c.key}>{c.render ? c.render(row) : String(row[c.key] ?? '—')}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--crm-s4)' }}>
          <span className="crm-caption">עמוד {page + 1} מתוך {pages} · {sorted.length} רשומות</span>
          <div style={{ display: 'flex', gap: 'var(--crm-s2)' }}>
            <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>הקודם</Button>
            <Button variant="secondary" size="sm" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)}>הבא</Button>
          </div>
        </div>
      )}
    </div>
  )
}

