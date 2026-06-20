// עמוד הסקירה של ה-CRM — שער כניסה מעוצב לכל המודולים.
import { Link } from 'react-router-dom'
import { Card } from '../design-system/ui'

const SECTIONS = [
  { to: '/crm/customers', icon: '👥', title: 'לקוחות ואנשי קשר', desc: 'ניהול לקוחות, אנשי קשר ומקור ההגעה.' },
  { to: '/crm/deals', icon: '🤝', title: 'דילים', desc: 'מעקב עסקאות: סטטוס, סכום, ערוץ וסיבת רכישה.' },
  { to: '/crm/categories', icon: '🏷️', title: 'קטגוריות ותבניות', desc: 'קטגוריות צבעוניות ותבניות לשימוש חוזר.' },
  { to: '/crm/analytics', icon: '📊', title: 'אנליטיקס', desc: 'גרף עוגה, טרנדים, חיתוך לפי ערוץ וסיבה.' },
  { to: '/crm/insights', icon: '🧠', title: 'תובנות', desc: 'לידים, נציגים וגבייה — עם מסקנות אוטומטיות.' },
]

export function CrmOverviewPage() {
  return (
    <div>
      <div style={{ marginBottom: 'var(--crm-s6)' }}>
        <h1 className="crm-display">ברוך הבא ל-Kerem CRM 🚀</h1>
        <p className="crm-body" style={{ color: 'var(--crm-text-soft)', marginTop: 8 }}>
          שכבת ניהול לקוחות, מכירות ותובנות — בנויה על מערכת ההזמנות הקיימת, בלי לגעת בה.
        </p>
      </div>

      <div className="crm-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {SECTIONS.map((s) => (
          <Link key={s.to} to={s.to} style={{ textDecoration: 'none', color: 'inherit' }}>
            <Card hover style={{ height: '100%' }}>
              <div style={{ fontSize: 30, marginBottom: 'var(--crm-s3)' }}>{s.icon}</div>
              <div className="crm-h3" style={{ marginBottom: 6 }}>{s.title}</div>
              <p className="crm-caption">{s.desc}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
