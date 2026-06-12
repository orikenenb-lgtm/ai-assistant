// דשבורד אדמין — תמונת מצב: הזמנות לפי סטטוס, לקוחות, מוצרים, סנכרון אחרון
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppHeader } from '../../components/AppHeader'
import { api, extractErrorMessage } from '../../lib/api'
import { STATUS_LABELS } from '../../lib/types'
import type { OrderStatus } from '../../lib/types'

interface DashboardStats {
  orders_by_status: Record<string, number>
  total_customers: number
  total_products: number
  last_sync_at: string | null
}

function StatCard({ label, value, to, highlight }: {
  label: string; value: number | string; to?: string; highlight?: boolean
}) {
  const card = (
    <div className={`rounded-2xl p-5 text-center shadow-sm border ${
      highlight ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}>
      <div className={`text-3xl font-bold ${highlight ? 'text-amber-700' : 'text-gray-900'}`}>
        {value}
      </div>
      <div className="mt-1 text-sm text-gray-600">{label}</div>
    </div>
  )
  return to ? <Link to={to} className="block hover:opacity-80">{card}</Link> : card
}

export function AdminDashboardPage() {
  const statsQuery = useQuery({
    queryKey: ['admin-stats'],
    queryFn: async () => (await api.get<DashboardStats>('/admin/stats')).data,
    refetchInterval: 60_000,    // מתרענן כל דקה
  })

  const stats = statsQuery.data
  const pending = stats?.orders_by_status['pending'] ?? 0

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="דשבורד" />

      <main className="max-w-5xl mx-auto px-4 py-6">
        <h1 className="text-xl font-bold text-gray-900 mb-6">דשבורד ניהול</h1>

        {statsQuery.isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3 mb-4">
            {extractErrorMessage(statsQuery.error)}
          </div>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="הזמנות ממתינות" value={pending}
            to="/admin/orders?status=pending" highlight={pending > 0} />
          <StatCard label="הצעות מחיר פתוחות"
            value={stats?.orders_by_status['quoted'] ?? 0}
            to="/admin/orders?status=quoted" />
          <StatCard label="לקוחות" value={stats?.total_customers ?? '—'} to="/admin/customers" />
          <StatCard label="מוצרים בקטלוג" value={stats?.total_products ?? '—'} />
        </div>

        <div className="mt-6 grid sm:grid-cols-3 gap-4">
          <Link to="/admin/orders"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center hover:border-blue-300">
            <span className="text-3xl block">📋</span>
            <span className="block mt-2 font-bold text-gray-900">כל ההזמנות</span>
          </Link>
          <Link to="/admin/customers"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center hover:border-blue-300">
            <span className="text-3xl block">🏪</span>
            <span className="block mt-2 font-bold text-gray-900">לקוחות</span>
          </Link>
          <Link to="/admin/sync"
            className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 text-center hover:border-blue-300">
            <span className="text-3xl block">🔄</span>
            <span className="block mt-2 font-bold text-gray-900">סנכרון Rivhit</span>
            <span className="block mt-1 text-xs text-gray-500">
              {stats?.last_sync_at
                ? `אחרון: ${new Date(stats.last_sync_at).toLocaleString('he-IL')}`
                : 'טרם בוצע'}
            </span>
          </Link>
        </div>

        <div className="mt-8">
          <h2 className="text-sm font-medium text-gray-500 mb-3">הזמנות לפי סטטוס</h2>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y">
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <Link key={key} to={`/admin/orders?status=${key}`}
                className="flex justify-between px-4 py-2.5 text-sm hover:bg-gray-50">
                <span>{label}</span>
                <span className="font-medium">{stats?.orders_by_status[key as OrderStatus] ?? 0}</span>
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
