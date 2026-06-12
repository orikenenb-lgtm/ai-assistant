// דף הבית: ללקוח — הזמנה חדשה / ההזמנות שלי; לאדמין — קיצורי ניהול
import { Link } from 'react-router-dom'
import { AppHeader } from '../components/AppHeader'
import { useAuth } from '../lib/auth-context'

function BigLink({ to, icon, label, sub }: { to: string; icon: string; label: string; sub: string }) {
  return (
    <Link
      to={to}
      className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center hover:border-blue-300 hover:shadow transition-all"
    >
      <span className="text-4xl block">{icon}</span>
      <span className="block mt-3 text-lg font-bold text-gray-900">{label}</span>
      <span className="block mt-1 text-sm text-gray-500">{sub}</span>
    </Link>
  )
}

export function HomePage() {
  const { user } = useAuth()
  const linked = Boolean(user?.rivhit_customer_id)

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader />

      <main className="max-w-4xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-gray-900 text-center">
          שלום, {user?.full_name ?? user?.email} 👋
        </h1>

        {user?.role === 'customer' && !linked && (
          <div className="mt-6 max-w-lg mx-auto rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 text-sm text-center">
            החשבון שלך נוצר אך עדיין לא קושר ללקוח במערכת.
            מנהל המערכת יקשר אותו בקרוב — ואז תוכל להזמין.
          </div>
        )}

        <div className="mt-8 grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
          <BigLink to="/catalog" icon="🛒" label="הזמנה חדשה"
            sub="עיון בקטלוג ובחירת מוצרים" />
          <BigLink to="/orders" icon="📦" label="ההזמנות שלי"
            sub="מעקב אחרי סטטוס הזמנות" />
          {user?.role === 'admin' && (
            <BigLink to="/admin/sync" icon="🔄" label="סנכרון Rivhit"
              sub="משיכת מוצרים ולקוחות" />
          )}
        </div>
      </main>
    </div>
  )
}
