// גרפים ב-SVG טהור — בלי תלות חיצונית. RTL-friendly, עם hover ו-legend.
import { useState } from 'react'
import { CRM_PALETTE } from './colors'

export interface Slice { label: string; value: number; color?: string }

function fmt(n: number): string {
  return new Intl.NumberFormat('he-IL').format(Math.round(n))
}

// ---------- Donut / Pie ----------
export function DonutChart({ data, size = 200, thickness = 30, title }: { data: Slice[]; size?: number; thickness?: number; title?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const r = (size - thickness) / 2
  const cx = size / 2, cy = size / 2
  const arcs = data.map((d, i) => {
    const startFrac = data.slice(0, i).reduce((s, x) => s + x.value, 0) / total
    const endFrac = startFrac + d.value / total
    const start = startFrac * 2 * Math.PI
    const end = endFrac * 2 * Math.PI
    const large = end - start > Math.PI ? 1 : 0
    const x1 = cx + r * Math.sin(start), y1 = cy - r * Math.cos(start)
    const x2 = cx + r * Math.sin(end), y2 = cy - r * Math.cos(end)
    const color = d.color || CRM_PALETTE[i % CRM_PALETTE.length]
    return { d: `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`, color, frac: d.value / total, i }
  })
  const active = hover !== null ? data[hover] : null
  return (
    <div style={{ display: 'flex', gap: 'var(--crm-s5)', alignItems: 'center', flexWrap: 'wrap' }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {arcs.map((a) => (
          <path key={a.i} d={a.d} fill="none" stroke={a.color} strokeWidth={hover === a.i ? thickness + 6 : thickness}
            strokeLinecap="butt" style={{ transition: 'stroke-width .15s', cursor: 'pointer' }}
            onMouseEnter={() => setHover(a.i)} onMouseLeave={() => setHover(null)} />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" style={{ fontSize: 22, fontWeight: 800, fill: 'var(--crm-text)' }}>
          {active ? `${Math.round((active.value / total) * 100)}%` : fmt(total)}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" style={{ fontSize: 12, fill: 'var(--crm-text-soft)' }}>
          {active ? active.label : title || 'סה"כ'}
        </text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>
        {data.map((d, i) => (
          <div key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, opacity: hover === null || hover === i ? 1 : 0.5, transition: 'opacity .15s', cursor: 'pointer' }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: d.color || CRM_PALETTE[i % CRM_PALETTE.length] }} />
            <span style={{ color: 'var(--crm-text)', flex: 1 }}>{d.label}</span>
            <span style={{ color: 'var(--crm-text-soft)', fontWeight: 600 }}>{fmt(d.value)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------- Bar ----------
export function BarChart({ data, height = 220, color = '#5b5bd6', unit = '' }: { data: Slice[]; height?: number; color?: string; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(...data.map((d) => d.value), 1)
  const barH = height - 40
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, padding: '0 4px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, height: '100%', justifyContent: 'flex-end' }}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <span className="crm-caption" style={{ fontWeight: 700, color: hover === i ? 'var(--crm-text)' : 'var(--crm-text-soft)' }}>
            {hover === i ? fmt(d.value) + unit : ''}
          </span>
          <div title={`${d.label}: ${fmt(d.value)}${unit}`}
            style={{ width: '100%', maxWidth: 46, height: Math.max(4, (d.value / max) * barH), background: d.color || color,
              borderRadius: '6px 6px 0 0', transition: 'all .2s var(--crm-ease)', opacity: hover === null || hover === i ? 1 : 0.55 }} />
          <span className="crm-caption" style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{d.label}</span>
        </div>
      ))}
    </div>
  )
}

// ---------- Line ----------
export function LineChart({ data, height = 220, color = '#5b5bd6', unit = '' }: { data: Slice[]; height?: number; color?: string; unit?: string }) {
  const w = 560, pad = 28
  const max = Math.max(...data.map((d) => d.value), 1)
  const stepX = data.length > 1 ? (w - pad * 2) / (data.length - 1) : 0
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2)
  const pts = data.map((d, i) => ({ x: pad + i * stepX, y: y(d.value), d }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const area = `${path} L ${pts[pts.length - 1]?.x ?? pad} ${height - pad} L ${pad} ${height - pad} Z`
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${height}`} style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id="crm-line-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#crm-line-grad)" />
      <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={3.5} fill={color}>
            <title>{`${p.d.label}: ${fmt(p.d.value)}${unit}`}</title>
          </circle>
          <text x={p.x} y={height - 8} textAnchor="middle" style={{ fontSize: 11, fill: 'var(--crm-text-soft)' }}>{p.d.label}</text>
        </g>
      ))}
    </svg>
  )
}

// ---------- Funnel ----------
export function Funnel({ steps }: { steps: { label: string; value: number; color?: string }[] }) {
  const max = Math.max(...steps.map((s) => s.value), 1)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {steps.map((s, i) => {
        const pct = (s.value / max) * 100
        const conv = i > 0 && steps[i - 1].value > 0 ? Math.round((s.value / steps[i - 1].value) * 100) : null
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 'var(--crm-s3)' }}>
            <span className="crm-caption" style={{ width: 90, textAlign: 'left' }}>{s.label}</span>
            <div style={{ flex: 1, background: 'var(--crm-surface-2)', borderRadius: 'var(--crm-r-sm)', overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, minWidth: 40, background: s.color || CRM_PALETTE[i % CRM_PALETTE.length],
                color: '#fff', padding: '8px 12px', fontSize: 13, fontWeight: 700, borderRadius: 'var(--crm-r-sm)', transition: 'width .3s var(--crm-ease)' }}>
                {fmt(s.value)}
              </div>
            </div>
            <span className="crm-caption" style={{ width: 54, fontWeight: 700, color: conv !== null ? 'var(--crm-text)' : 'transparent' }}>
              {conv !== null ? `${conv}%` : '—'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
