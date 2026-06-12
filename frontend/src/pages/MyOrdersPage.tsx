// "ההזמנות שלי" — רשימת ההזמנות של הלקוח עם סטטוס בעברית
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppHeader } from '../components/AppHeader'
import { api, extractErrorMessage } from '../lib/api'
import { formatPrice, STATUS_COLORS, STATUS_LABELS } from '../lib/types'
import type { Order } from '../lib/types'

export function MyOrdersPage() {
  const ordersQuery = useQuery({
    queryKey: ['my-orders'],
    queryFn: async () => (await api.get<Order[]>('/orders')).data,
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="ההזמנות שלי" />

      <main className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-gray-900">ההזמנות שלי</h1>
          <Link
            to="/catalog"
            className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            + הזמנה חדשה
          </Link>
        </div>

        {ordersQuery.isLoading && (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl h-20 animate-pulse" />
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
            <span className="text-4xl block mb-2">📦</span>
            עוד אין הזמנות — בוא נתחיל!
            <div className="mt-4">
              <Link to="/catalog" className="text-blue-600 hover:underline font-medium">
                לקטלוג ←
              </Link>
            </div>
          </div>
        )}

        <div className="space-y-3">
          {ordersQuery.data?.map((order) => (
            <Link
              key={order.id}
              to={`/orders/${order.id}`}
              className="block bg-white rounded-xl shadow-sm border border-gray-100 p-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <span className="font-bold text-gray-900">הזמנה #{order.order_number}</span>
                  <span className="text-sm text-gray-500 ms-3">
                    {new Date(order.created_at).toLocaleDateString('he-IL')}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  {order.total_estimate != null && (
                    <span className="text-sm text-gray-700">{formatPrice(order.total_estimate)}</span>
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
