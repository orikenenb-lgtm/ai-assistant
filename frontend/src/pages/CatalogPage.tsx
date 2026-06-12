// דף הקטלוג: חיפוש, סינון קטגוריה, בחירת כמויות וסל מתעדכן בזמן אמת
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { AppHeader } from '../components/AppHeader'
import { api, extractErrorMessage } from '../lib/api'
import { useAuth } from '../lib/auth-context'
import { useCart } from '../lib/cart-context'
import { formatPrice } from '../lib/types'
import type { Product } from '../lib/types'

function QuantityStepper({ product }: { product: Product }) {
  const { getQuantity, setQuantity } = useCart()
  const qty = getQuantity(product.id)

  return (
    <div className="flex items-center justify-center gap-2" dir="ltr">
      <button
        onClick={() => setQuantity(product, Math.max(0, qty - 1))}
        className="w-9 h-9 rounded-lg border border-gray-300 text-lg font-bold hover:bg-gray-50"
        aria-label={`הפחת כמות עבור ${product.name}`}
      >
        −
      </button>
      <input
        type="number"
        min={0}
        value={qty === 0 ? '' : qty}
        placeholder="0"
        aria-label={`כמות עבור ${product.name}`}
        onChange={(e) => {
          const parsed = parseInt(e.target.value, 10)
          setQuantity(product, Number.isNaN(parsed) ? 0 : Math.max(0, parsed))
        }}
        className="w-16 h-9 text-center rounded-lg border border-gray-300"
      />
      <button
        onClick={() => setQuantity(product, qty + 1)}
        className="w-9 h-9 rounded-lg border border-gray-300 text-lg font-bold hover:bg-gray-50"
        aria-label={`הוסף כמות עבור ${product.name}`}
      >
        +
      </button>
    </div>
  )
}

function ProductCard({ product }: { product: Product }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 flex flex-col gap-2">
      <div className="h-28 bg-gray-50 rounded-lg flex items-center justify-center text-4xl">
        {product.image_url
          ? <img src={product.image_url} alt={product.name} className="h-full object-contain" />
          : '🧸'}
      </div>
      <div className="flex-1">
        <h3 className="font-medium text-gray-900 leading-snug">{product.name}</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          {product.sku && <span>מק"ט {product.sku} · </span>}
          {product.category}
        </p>
      </div>
      <div className="text-lg font-bold text-gray-900">
        {formatPrice(product.base_price)}
        {product.unit && <span className="text-xs font-normal text-gray-500"> / {product.unit}</span>}
      </div>
      <QuantityStepper product={product} />
    </div>
  )
}

function CartBar() {
  const { totalItems, totalEstimate, lines, clear } = useCart()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [notes, setNotes] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  // חשבון שלא קושר ללקוח Rivhit לא יכול להזמין — חוסמים כבר כאן, לא בכשל מהשרת
  const isLinked = user?.role === 'admin' || Boolean(user?.rivhit_customer_id)

  const submitMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        items: lines.map((line) => ({
          product_id: line.product.id,
          quantity: line.quantity,
        })),
        notes: notes || null,
      }
      return (await api.post('/orders', payload)).data
    },
    onSuccess: (order) => {
      clear()
      navigate(`/orders/${order.id}`, { state: { justCreated: true } })
    },
  })

  if (totalItems === 0) return null

  return (
    <div className="fixed bottom-0 inset-x-0 bg-white border-t shadow-lg z-20">
      <div className="max-w-6xl mx-auto px-4 py-3">
        {showConfirm ? (
          <div className="space-y-3">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="הערות להזמנה (אופציונלי)"
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            {submitMutation.isError && (
              <div className="text-sm text-red-600">{extractErrorMessage(submitMutation.error)}</div>
            )}
            <div className="flex items-center justify-between gap-3">
              <button onClick={() => setShowConfirm(false)} className="text-sm text-gray-500 hover:underline">
                חזרה
              </button>
              <button
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
                className="rounded-lg bg-green-600 text-white px-6 py-2.5 font-medium hover:bg-green-700 disabled:opacity-50"
              >
                {submitMutation.isPending ? 'שולח…' : `אישור ושליחה · ${formatPrice(totalEstimate)}`}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <span className="font-bold text-gray-900">{totalItems} פריטים</span>
              <span className="text-gray-500 text-sm"> · סה"כ משוער: {formatPrice(totalEstimate)}</span>
              {!isLinked && (
                <span className="block text-sm text-amber-700 mt-1">
                  שליחת הזמנה תתאפשר אחרי שמנהל המערכת יקשר את החשבון שלך ללקוח.
                </span>
              )}
            </div>
            <button
              onClick={() => setShowConfirm(true)}
              disabled={!isLinked}
              className="rounded-lg bg-blue-600 text-white px-6 py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              שלח הזמנה
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function CatalogPage() {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const pageSize = 48

  const categoriesQuery = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await api.get<string[]>('/products/categories')).data,
  })

  const productsQuery = useQuery({
    queryKey: ['products', search, category, page],
    queryFn: async () => {
      const params: Record<string, string | number> = { page, page_size: pageSize }
      if (search) params.search = search
      if (category) params.category = category
      return (await api.get<Product[]>('/products', { params })).data
    },
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <AppHeader title="קטלוג" />

      <main className="max-w-6xl mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row gap-3 mb-6">
          <input
            type="search"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            placeholder='חיפוש לפי שם או מק"ט…'
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2.5"
          />
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1) }}
            className="rounded-lg border border-gray-300 px-4 py-2.5 bg-white"
          >
            <option value="">כל הקטגוריות</option>
            {categoriesQuery.data?.map((cat) => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        </div>

        {productsQuery.isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl h-64 animate-pulse" />
            ))}
          </div>
        )}

        {productsQuery.isError && (
          <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 px-4 py-3">
            {extractErrorMessage(productsQuery.error)}
          </div>
        )}

        {productsQuery.data?.length === 0 && (
          <div className="text-center py-16 text-gray-500">
            <span className="text-4xl block mb-2">🔍</span>
            {search || category ? 'לא נמצאו מוצרים מתאימים' : 'הקטלוג ריק כרגע — נסה שוב מאוחר יותר'}
          </div>
        )}

        {productsQuery.data && productsQuery.data.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {productsQuery.data.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
            <div className="flex justify-center items-center gap-4 mt-8">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
              >
                → הקודם
              </button>
              <span className="text-sm text-gray-500">עמוד {page}</span>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={productsQuery.data.length < pageSize}
                className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40"
              >
                הבא ←
              </button>
            </div>
          </>
        )}
      </main>

      <CartBar />
    </div>
  )
}
