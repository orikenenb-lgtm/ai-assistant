// מסך אבא: רענון הקטלוג מרווחית + סטטוס הסנכרון האחרון.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import '../crm/design-system/tokens.css'
import { CrmThemeProvider, useTheme } from '../crm/design-system/theme'
import { Button, Card, StatCard } from '../crm/design-system/ui'
import { fetchCatalog, syncCatalog } from './api'

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('he-IL')
}

function Panel() {
  const { theme, toggle } = useTheme()
  const [count, setCount] = useState<number | null>(null)
  const [lastSync, setLastSync] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const load = () => fetchCatalog().then((rows) => {
    setCount(rows.length)
    const latest = rows.map((r) => r.last_synced_at).filter(Boolean).sort().at(-1) || null
    setLastSync(latest)
  }).catch(() => setCount(0))

  useEffect(() => { load() }, [])

  const onSync = async () => {
    setSyncing(true); setMsg(null)
    try {
      const res = await syncCatalog()
      setMsg({ ok: true, text: `✅ הסנכרון הצליח — ${res.synced} מוצרים עודכנו מרווחית.` })
      setLastSync(res.last_synced_at)
      await load()
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail
      setMsg({ ok: false, text: `❌ הסנכרון נכשל: ${detail || 'רווחית לא זמינה כרגע'}. הקטלוג הקיים עדיין מוצג ללקוחות.` })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="crm-root" data-theme={theme} style={{ minHeight: '100vh', padding: 'var(--crm-s6)' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 'var(--crm-s5)' }}>
          <h1 className="crm-h1" style={{ marginInlineEnd: 'auto' }}>ניהול הקטלוג</h1>
          <button className="crm-btn crm-btn-secondary crm-btn-sm" onClick={toggle}>{theme === 'dark' ? '☀️' : '🌙'}</button>
          <Link to="/admin" className="crm-btn crm-btn-ghost crm-btn-sm" style={{ textDecoration: 'none', marginInlineStart: 8 }}>← ניהול</Link>
        </div>

        <div className="crm-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', marginBottom: 'var(--crm-s5)' }}>
          <StatCard label="מוצרים בקטלוג" value={count ?? '—'} />
          <StatCard label="סנכרון אחרון" value={<span style={{ fontSize: 16 }}>{fmtTime(lastSync)}</span>} />
        </div>

        <Card>
          <h2 className="crm-h3" style={{ marginBottom: 8 }}>רענון מרווחית</h2>
          <p className="crm-caption" style={{ marginBottom: 'var(--crm-s4)' }}>
            מושך את המוצרים העדכניים מרווחית (קריאה בלבד) ומעדכן את הקטלוג שהלקוחות רואים.
          </p>
          <Button onClick={onSync} loading={syncing}>{syncing ? 'מסנכרן…' : '🔄 רענן קטלוג מרווחית'}</Button>
          {msg && (
            <div style={{ marginTop: 'var(--crm-s4)', padding: 'var(--crm-s3) var(--crm-s4)', borderRadius: 'var(--crm-r-md)',
              background: msg.ok ? 'var(--crm-success-soft)' : 'var(--crm-danger-soft)',
              color: msg.ok ? '#065f46' : '#991b1b', fontSize: 14, fontWeight: 600 }}>
              {msg.text}
            </div>
          )}
        </Card>

        <div style={{ marginTop: 'var(--crm-s5)' }}>
          <Link to="/store" className="crm-btn crm-btn-secondary" style={{ textDecoration: 'none' }}>👁️ צפה בקטלוג כמו לקוח</Link>
        </div>
      </div>
    </div>
  )
}

export function AdminCatalogPage() {
  return (
    <CrmThemeProvider>
      <Panel />
    </CrmThemeProvider>
  )
}
