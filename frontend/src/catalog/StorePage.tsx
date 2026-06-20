// עמוד החנות ללקוחות — קטלוג יפה מתוך ה-cache. RTL, רספונסיבי, מצב כהה/בהיר.
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import '../crm/design-system/tokens.css'
import { CrmThemeProvider, useTheme } from '../crm/design-system/theme'
import { Badge, Card, EmptyState, Input, Select, Skeleton } from '../crm/design-system/ui'
import { fetchCatalog, type CatalogProduct } from './api'

const shekel = (n: number) => new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS', maximumFractionDigits: 2 }).format(n)

function ProductCard({ p }: { p: CatalogProduct }) {
  const inStock = Number(p.quantity) > 0
  return (
    <Card hover className="" style={{ padding: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ aspectRatio: '1 / 1', background: 'var(--crm-surface-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {p.image_url
          ? <img src={p.image_url} alt={p.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          : <span style={{ fontSize: 56 }}>🧸</span>}
      </div>
      <div style={{ padding: 'var(--crm-s4)', display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
        {p.category && <span className="crm-caption">{p.category}</span>}
        <div className="crm-h3" style={{ lineHeight: 1.3, flex: 1 }}>{p.name}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <span style={{ fontSize: 18, fontWeight: 800, color: 'var(--crm-primary)' }}>{shekel(Number(p.price))}</span>
          <Badge color={inStock ? '#10b981' : '#94a3b8'}>{inStock ? 'במלאי' : 'אזל'}</Badge>
        </div>
      </div>
    </Card>
  )
}

function Store() {
  const { theme, toggle } = useTheme()
  const [products, setProducts] = useState<CatalogProduct[] | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')

  useEffect(() => {
    fetchCatalog().then(setProducts).catch(() => setError(true))
  }, [])

  const categories = useMemo(
    () => Array.from(new Set((products || []).map((p) => p.category).filter(Boolean))) as string[],
    [products],
  )
  const filtered = useMemo(() => (products || []).filter((p) =>
    (!q || p.name.toLowerCase().includes(q.toLowerCase())) && (!cat || p.category === cat)), [products, q, cat])

  return (
    <div className="crm-root" data-theme={theme} style={{ minHeight: '100vh' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--crm-surface)', borderBottom: '1px solid var(--crm-border)', padding: 'var(--crm-s4) var(--crm-s5)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 'var(--crm-s4)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginInlineEnd: 'auto' }}>
            <span style={{ fontSize: 26 }}>🧸</span>
            <div>
              <div className="crm-h2">הקטלוג שלנו</div>
              <div className="crm-caption">צעצועים בסיטונאות — מעודכן ישירות מהמלאי</div>
            </div>
          </div>
          <div style={{ minWidth: 200, flex: '1 1 200px', maxWidth: 320 }}>
            <Input placeholder="🔍 חיפוש מוצר…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {categories.length > 0 && (
            <div style={{ minWidth: 150 }}>
              <Select value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="">כל הקטגוריות</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
          )}
          <button className="crm-btn crm-btn-secondary crm-btn-sm" onClick={toggle} aria-label="החלף מצב תצוגה">
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <Link to="/" className="crm-btn crm-btn-ghost crm-btn-sm" style={{ textDecoration: 'none' }}>← לאזור האישי</Link>
        </div>
      </header>

      <main style={{ maxWidth: 1200, margin: '0 auto', padding: 'var(--crm-s6) var(--crm-s5)' }}>
        {error ? (
          <Card><EmptyState icon="😕" title="לא הצלחנו לטעון את הקטלוג" subtitle="נסה לרענן את העמוד בעוד רגע." /></Card>
        ) : products === null ? (
          <div className="crm-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <Card key={i} style={{ padding: 0, overflow: 'hidden' }}>
                <Skeleton h={180} r={0} />
                <div style={{ padding: 'var(--crm-s4)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <Skeleton h={14} w="70%" /><Skeleton h={20} w="40%" />
                </div>
              </Card>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <Card><EmptyState icon="📦" title={products.length === 0 ? 'הקטלוג עוד ריק' : 'לא נמצאו מוצרים'}
            subtitle={products.length === 0 ? 'אבא עוד לא סנכרן מוצרים מרווחית.' : 'נסה חיפוש או קטגוריה אחרת.'} /></Card>
        ) : (
          <>
            <p className="crm-caption" style={{ marginBottom: 'var(--crm-s4)' }}>{filtered.length} מוצרים</p>
            <div className="crm-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
              {filtered.map((p) => <ProductCard key={p.id} p={p} />)}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

export function StorePage() {
  return (
    <CrmThemeProvider>
      <Store />
    </CrmThemeProvider>
  )
}
