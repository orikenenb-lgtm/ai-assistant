// עמוד זמני למודולים שייבנו בשלב הבא (שומר על חוויה תקינה, לא דף שבור).
import { EmptyState } from '../design-system/ui'

export function Placeholder({ title }: { title: string }) {
  return (
    <div>
      <h1 className="crm-h1" style={{ marginBottom: 'var(--crm-s5)' }}>{title}</h1>
      <div className="crm-card">
        <EmptyState icon="🚧" title="בבנייה" subtitle="המודול הזה נבנה בשלב הבא — הבסיס העיצובי כבר מוכן." />
      </div>
    </div>
  )
}
