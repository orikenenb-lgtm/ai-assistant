// כל ההזמנות (אדמין) — טבלה עם סינון לפי סטטוס
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppHeader } from '../../components/AppHeader'
import { api, extractErrorMessage } from '../../lib/api'
import { formatPrice, STATUS_COLORS, STATUS_LABELS } from '../../lib/types'
import type { Order, OrderStatus } from '../../lib/types'

interface AdminOrder extends Order {
  customer_name: string | null
}

export function AdminOrdersPage() {
  const [params, setParams] = useSearchParams()
  const statusFilter = params.get('status') ?? ''

  const ordersQuery = useQuery({
    queryKey: ['admin-orders', statusFilter],
    queryFn: async () => {
      const query = statusFilter ? { status: statusFilter } : {}
      return (await api.get<AdminOrder[]>('/admin/orders', { params: query })).data
    },
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="הזמנות" />

      <main className="max-w-5xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-6">
          <h1 className="text-xl font-bold text-gray-900">כל ההזמנות</h1>
          <select
            value={statusFilter}
            onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
          >
            <option value="">כל הסטטוסים</option>
            {Object.entries(STATUS_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {ordersQuery.isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl h-16 animate-pulse" />
            ))}
          </div>
        )}

        {ordersQuery.isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3">
            {extractErrorMessage(ordersQuery.error)}
          </div>
        )}

        {ordersQuery.data?.length === 0 && (
          <div className="text-center py-16 text-gray-500 bg-white rounded-2xl">
            <span className="text-4xl block mb-2">📭</span>
            אין הזמנות {statusFilter && `בסטטוס "${STATUS_LABELS[statusFilter as OrderStatus]}"`}
          </div>
        )}

        <div className="space-y-2">
          {ordersQuery.data?.map((order) => (
            <Link
              key={order.id}
              to={`/admin/orders/${order.id}`}
              className="block bg-white rounded-xl shadow-sm border border-gray-100 px-4 py-3 hover:border-blue-300"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-gray-900">#{order.order_number}</span>
                  <span className="text-gray-700">{order.customer_name ?? 'לקוח לא ידוע'}</span>
                  <span className="text-xs text-gray-400">
                    {new Date(order.created_at).toLocaleDateString('he-IL')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {order.total_estimate != null && (
                    <span className="text-sm">{formatPrice(order.total_estimate)}</span>
                  )}
                  <span className={`text-xs rounded-full px-2.5 py-1 font-medium ${STATUS_COLORS[order.status]}`}>
                    {STATUS_LABELS[order.status]}
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
