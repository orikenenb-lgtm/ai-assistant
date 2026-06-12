// פרטי הזמנה בודדת — שורות, מחירי snapshot, סטטוס
import { Link, useLocation, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { AppHeader } from '../components/AppHeader'
import { api, extractErrorMessage } from '../lib/api'
import { formatPrice, STATUS_COLORS, STATUS_LABELS } from '../lib/types'
import type { Order } from '../lib/types'

export function OrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const location = useLocation()
  const justCreated = Boolean((location.state as { justCreated?: boolean } | null)?.justCreated)

  const orderQuery = useQuery({
    queryKey: ['order', orderId],
    queryFn: async () => (await api.get<Order>(`/orders/${orderId}`)).data,
    enabled: Boolean(orderId),
  })

  const order = orderQuery.data

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="פרטי הזמנה" />

      <main className="max-w-3xl mx-auto px-4 py-6">
        {justCreated && (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 text-green-800 px-4 py-3">
            🎉 ההזמנה נשלחה! אבא יקבל התראה ויחזור אליך עם הצעת מחיר.
          </div>
        )}

        <Link to="/orders" className="text-sm text-blue-600 hover:underline">← כל ההזמנות</Link>

        {orderQuery.isLoading && <div className="mt-4 bg-white rounded-2xl h-64 animate-pulse" />}

        {orderQuery.isError && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3">
            {extractErrorMessage(orderQuery.error)}
          </div>
        )}

        {order && (
          <div className="mt-4 bg-white rounded-2xl shadow-sm p-6">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h1 className="text-xl font-bold text-gray-900">הזמנה #{order.order_number}</h1>
              <span className={`text-xs rounded-full px-2.5 py-1 font-medium ${STATUS_COLORS[order.status]}`}>
                {STATUS_LABELS[order.status]}
              </span>
            </div>
            <p className="text-sm text-gray-500 mt-1">
              נוצרה ב-{new Date(order.created_at).toLocaleString('he-IL')}
            </p>

            <table className="w-full text-sm mt-6">
              <thead>
                <tr className="text-right text-gray-500 border-b">
                  <th className="py-2">מוצר</th>
                  <th className="py-2">כמות</th>
                  <th className="py-2">מחיר יח'</th>
                  <th className="py-2">סה"כ</th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="py-2.5">{item.product_name ?? item.product_id}</td>
                    <td className="py-2.5">{item.quantity}</td>
                    <td className="py-2.5">{formatPrice(item.unit_price)}</td>
                    <td className="py-2.5 font-medium">{formatPrice(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-4 flex justify-between items-center border-t pt-4">
              <span className="text-gray-600">סה"כ משוער</span>
              <span className="text-xl font-bold text-gray-900">
                {order.total_estimate != null ? formatPrice(order.total_estimate) : '—'}
              </span>
            </div>

            {order.notes && (
              <div className="mt-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700">
                <span className="font-medium">הערות: </span>{order.notes}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
