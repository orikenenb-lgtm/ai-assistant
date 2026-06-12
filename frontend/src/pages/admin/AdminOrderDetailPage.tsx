// פרטי הזמנה (אדמין): שורות, שינוי סטטוס, הערות פנימיות
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppHeader } from '../../components/AppHeader'
import { api, extractErrorMessage } from '../../lib/api'
import { formatPrice, STATUS_COLORS, STATUS_LABELS } from '../../lib/types'
import type { Order, OrderStatus } from '../../lib/types'

interface AdminOrder extends Order {
  customer_name: string | null
  admin_notes: string | null
  rivhit_quote_id: number | null
}

// המעברים החוקיים — תואם ל-admin_service.py בבקנד
const NEXT_STATUSES: Record<OrderStatus, OrderStatus[]> = {
  pending: ['reviewed', 'quoted', 'cancelled'],
  reviewed: ['quoted', 'cancelled', 'pending'],
  quoted: ['confirmed', 'cancelled', 'reviewed'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['closed'],
  closed: [],
  cancelled: [],
}

export function AdminOrderDetailPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const queryClient = useQueryClient()
  const [notesDraft, setNotesDraft] = useState<string | null>(null)

  const orderQuery = useQuery({
    queryKey: ['admin-order', orderId],
    queryFn: async () => (await api.get<AdminOrder>(`/admin/orders/${orderId}`)).data,
    enabled: Boolean(orderId),
  })

  const updateMutation = useMutation({
    mutationFn: async (body: { status?: string; admin_notes?: string }) =>
      (await api.patch<AdminOrder>(`/admin/orders/${orderId}`, body)).data,
    onSuccess: () => {
      setNotesDraft(null)
      queryClient.invalidateQueries({ queryKey: ['admin-order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
  })

  const order = orderQuery.data
  const notes = notesDraft ?? order?.admin_notes ?? ''

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="פרטי הזמנה" />

      <main className="max-w-4xl mx-auto px-4 py-6">
        <Link to="/admin/orders" className="text-sm text-blue-600 hover:underline">← כל ההזמנות</Link>

        {orderQuery.isLoading && <div className="mt-4 bg-white rounded-2xl h-72 animate-pulse" />}
        {orderQuery.isError && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3">
            {extractErrorMessage(orderQuery.error)}
          </div>
        )}

        {order && (
          <>
            <div className="mt-4 bg-white rounded-2xl shadow-sm p-6">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h1 className="text-xl font-bold text-gray-900">
                    הזמנה #{order.order_number} · {order.customer_name ?? 'לקוח לא ידוע'}
                  </h1>
                  <p className="text-sm text-gray-500 mt-1">
                    {new Date(order.created_at).toLocaleString('he-IL')}
                    {order.rivhit_quote_id && ` · הצעה ב-Rivhit: ${order.rivhit_quote_id}`}
                  </p>
                </div>
                <span className={`text-xs rounded-full px-2.5 py-1 font-medium ${STATUS_COLORS[order.status]}`}>
                  {STATUS_LABELS[order.status]}
                </span>
              </div>

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
                <span className="text-xl font-bold">
                  {order.total_estimate != null ? formatPrice(order.total_estimate) : '—'}
                </span>
              </div>

              {order.notes && (
                <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-900">
                  <span className="font-medium">הערות הלקוח: </span>{order.notes}
                </div>
              )}
            </div>

            <div className="mt-4 bg-white rounded-2xl shadow-sm p-6">
              <h2 className="font-bold text-gray-900 mb-3">עדכון סטטוס</h2>
              {updateMutation.isError && (
                <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
                  {extractErrorMessage(updateMutation.error)}
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {NEXT_STATUSES[order.status].length === 0 && (
                  <span className="text-sm text-gray-500">ההזמנה בסטטוס סופי</span>
                )}
                {NEXT_STATUSES[order.status].map((next) => (
                  <button
                    key={next}
                    onClick={() => updateMutation.mutate({ status: next })}
                    disabled={updateMutation.isPending}
                    className={`rounded-lg px-4 py-2 text-sm font-medium border disabled:opacity-50 ${
                      next === 'cancelled'
                        ? 'border-red-300 text-red-700 hover:bg-red-50'
                        : 'border-blue-300 text-blue-700 hover:bg-blue-50'}`}
                  >
                    {STATUS_LABELS[next]}
                  </button>
                ))}
              </div>

              <h2 className="font-bold text-gray-900 mt-6 mb-2">הערות פנימיות (רק לך)</h2>
              <textarea
                value={notes}
                onChange={(e) => setNotesDraft(e.target.value)}
                rows={3}
                placeholder="הערות שהלקוח לא רואה…"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              {notesDraft !== null && notesDraft !== (order.admin_notes ?? '') && (
                <button
                  onClick={() => updateMutation.mutate({ admin_notes: notesDraft })}
                  disabled={updateMutation.isPending}
                  className="mt-2 rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  שמור הערות
                </button>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
