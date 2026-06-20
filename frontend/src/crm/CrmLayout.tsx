// מעטפת ה-CRM: sidebar ניווט + מתג בהיר/כהה. עוטף הכל ב-.crm-root (סגנון מבודד).
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import './design-system/tokens.css'
import { CrmThemeProvider, useTheme } from './design-system/theme'

const NAV = [
  { to: '/crm', label: 'סקירה', icon: '🏠', exact: true },
  { to: '/crm/customers', label: 'לקוחות', icon: '👥' },
  { to: '/crm/deals', label: 'דילים', icon: '🤝' },
  { to: '/crm/categories', label: 'קטגוריות ותבניות', icon: '🏷️' },
  { to: '/crm/analytics', label: 'אנליטיקס', icon: '📊' },
  { to: '/crm/insights', label: 'תובנות', icon: '🧠' },
]

function Shell({ children }: { children: ReactNode }) {
  const { theme, toggle } = useTheme()
  const loc = useLocation()
  const isActive = (to: string, exact?: boolean) => (exact ? loc.pathname === to : loc.pathname === to || loc.pathname.startsWith(to + '/'))
  return (
    <div className="crm-root" data-theme={theme} style={{ display: 'flex' }}>
      <aside style={{ width: 240, borderInlineEnd: '1px solid var(--crm-border)', background: 'var(--crm-surface)', padding: 'var(--crm-s4)', minHeight: '100vh', position: 'sticky', top: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 'var(--crm-s2) var(--crm-s2) var(--crm-s5)' }}>
          <span style={{ fontSize: 26 }}>🧸</span>
          <div>
            <div className="crm-h3">Kerem CRM</div>
            <div className="crm-caption">ניהול לקוחות ומכירות</div>
          </div>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {NAV.map((n) => (
            <Link key={n.to} to={n.to}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', borderRadius: 'var(--crm-r-md)',
                textDecoration: 'none', fontSize: 14, fontWeight: 600, transition: 'all .15s var(--crm-ease)',
                color: isActive(n.to, n.exact) ? 'var(--crm-primary)' : 'var(--crm-text-soft)',
                background: isActive(n.to, n.exact) ? 'var(--crm-primary-50)' : 'transparent' }}>
              <span style={{ fontSize: 17 }}>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div style={{ marginTop: 'var(--crm-s6)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <button className="crm-btn crm-btn-secondary crm-btn-sm" onClick={toggle}>
            {theme === 'dark' ? '☀️ מצב בהיר' : '🌙 מצב כהה'}
          </button>
          <Link to="/admin" className="crm-btn crm-btn-ghost crm-btn-sm" style={{ textDecoration: 'none' }}>← חזרה למערכת</Link>
        </div>
      </aside>
      <main style={{ flex: 1, padding: 'var(--crm-s6)', maxWidth: 1280, margin: '0 auto', width: '100%' }}>{children}</main>
    </div>
  )
}

export function CrmLayout({ children }: { children: ReactNode }) {
  return (
    <CrmThemeProvider>
      <Shell>{children}</Shell>
    </CrmThemeProvider>
  )
}
