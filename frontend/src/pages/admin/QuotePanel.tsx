// פאנל הצעת מחיר: dry-run → תצוגה מקדימה → אישור מפורש → push ל-Rivhit
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api, extractErrorMessage } from '../../lib/api'
import { formatPrice } from '../../lib/types'

interface QuotePreview {
  order_number: number
  customer_name: string
  lines: { product_name: string | null; quantity: number; unit_price: number; line_total: number }[]
  total: number
  confirmation_token: string
}

export function QuotePanel({ orderId, status, rivhitQuoteId }: {
  orderId: string
  status: string
  rivhitQuoteId: number | null
}) {
  const queryClient = useQueryClient()
  const [preview, setPreview] = useState<QuotePreview | null>(null)

  const dryRunMutation = useMutation({
    mutationFn: async () =>
      (await api.post<QuotePreview>(`/admin/orders/${orderId}/quote`)).data,
    onSuccess: setPreview,
  })

  const confirmMutation = useMutation({
    mutationFn: async (token: string) =>
      (await api.post(`/admin/orders/${orderId}/quote/confirm`, {
        confirmation_token: token,
      })).data,
    onSuccess: () => {
      setPreview(null)
      queryClient.invalidateQueries({ queryKey: ['admin-order', orderId] })
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] })
      queryClient.invalidateQueries({ queryKey: ['admin-stats'] })
    },
  })

  // כבר יש הצעה — מציגים אותה בלבד
  if (rivhitQuoteId) {
    return (
      <div className="mt-4 bg-purple-50 border border-purple-200 rounded-2xl p-4 text-sm text-purple-900">
        📄 הצעת מחיר קיימת ב-Rivhit — מסמך מספר <b>{rivhitQuoteId}</b>
      </div>
    )
  }

  // הצעה אפשרית רק מהסטטוסים האלה (תואם לבקנד)
  if (status !== 'pending' && status !== 'reviewed') return null

  return (
    <div className="mt-4 bg-white rounded-2xl shadow-sm p-6">
      <h2 className="font-bold text-gray-900 mb-1">הצעת מחיר ל-Rivhit</h2>
      <p className="text-sm text-gray-500 mb-4">
        קודם תצוגה מקדימה — שום דבר לא נשלח בלי אישור שלך.
      </p>

      {dryRunMutation.isError && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {extractErrorMessage(dryRunMutation.error)}
        </div>
      )}
      {confirmMutation.isError && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {extractErrorMessage(confirmMutation.error)}
        </div>
      )}
      {confirmMutation.isSuccess && (
        <div className="mb-3 rounded-lg bg-green-50 border border-green-200 text-green-800 px-3 py-2 text-sm">
          ✅ {(confirmMutation.data as { message: string }).message}
        </div>
      )}

      {!preview ? (
        <button
          onClick={() => dryRunMutation.mutate()}
          disabled={dryRunMutation.isPending}
          className="rounded-lg bg-purple-600 text-white px-5 py-2.5 font-medium hover:bg-purple-700 disabled:opacity-50"
        >
          {dryRunMutation.isPending ? 'מכין תצוגה…' : '📄 צור הצעת מחיר (תצוגה מקדימה)'}
        </button>
      ) : (
        <div className="border border-purple-200 rounded-xl p-4 bg-purple-50/50">
          <h3 className="font-bold text-gray-900">
            תצוגה מקדימה — הצעה ל{preview.customer_name}
          </h3>
          <table className="w-full text-sm mt-3 bg-white rounded-lg overflow-hidden">
            <thead>
              <tr className="text-right text-gray-500 border-b">
                <th className="py-2 px-3">מוצר</th>
                <th className="py-2 px-3">כמות</th>
                <th className="py-2 px-3">מחיר</th>
                <th className="py-2 px-3">סה"כ</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((line, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-2 px-3">{line.product_name ?? '—'}</td>
                  <td className="py-2 px-3">{line.quantity}</td>
                  <td className="py-2 px-3">{formatPrice(line.unit_price)}</td>
                  <td className="py-2 px-3 font-medium">{formatPrice(line.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between items-center mt-3 px-1">
            <span className="text-sm text-gray-600">סה"כ ההצעה</span>
            <span className="text-lg font-bold">{formatPrice(preview.total)}</span>
          </div>

          <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-3 py-2 text-sm">
            ⚠️ אישור ייצור מסמך אמיתי בחשבון Rivhit — פעולה שאינה הפיכה מכאן.
          </div>

          <div className="mt-4 flex items-center justify-between">
            <button
              onClick={() => setPreview(null)}
              className="text-sm text-gray-500 hover:underline"
            >
              ביטול
            </button>
            <button
              onClick={() => confirmMutation.mutate(preview.confirmation_token)}
              disabled={confirmMutation.isPending}
              className="rounded-lg bg-green-600 text-white px-6 py-2.5 font-medium hover:bg-green-700 disabled:opacity-50"
            >
              {confirmMutation.isPending ? 'שולח ל-Rivhit…' : '✅ אישור ושליחה ל-Rivhit'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
