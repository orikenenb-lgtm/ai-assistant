// נקודת הכניסה ל-CRM: ניתוב פנימי תחת /crm, עטוף במעטפת המעוצבת.
import { Route, Routes } from 'react-router-dom'
import { CrmLayout } from './CrmLayout'
import { CrmOverviewPage } from './pages/CrmOverviewPage'
import { Placeholder } from './pages/Placeholder'

export function CrmApp() {
  return (
    <CrmLayout>
      <Routes>
        <Route path="/" element={<CrmOverviewPage />} />
        <Route path="/customers" element={<Placeholder title="לקוחות ואנשי קשר" />} />
        <Route path="/deals" element={<Placeholder title="דילים" />} />
        <Route path="/categories" element={<Placeholder title="קטגוריות ותבניות" />} />
        <Route path="/analytics" element={<Placeholder title="אנליטיקס" />} />
        <Route path="/insights" element={<Placeholder title="תובנות" />} />
      </Routes>
    </CrmLayout>
  )
}
