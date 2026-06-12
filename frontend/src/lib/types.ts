// טיפוסים משותפים — תואמים לסכמות ה-Pydantic בבקנד

export interface Product {
  id: string
  rivhit_id: number
  sku: string | null
  name: string
  category: string | null
  description: string | null
  base_price: number
  stock_quantity: number
  unit: string | null
  image_url: string | null
  is_active: boolean
}

export interface OrderItem {
  id: string
  product_id: string
  product_name: string | null
  quantity: number
  unit_price: number
  line_total: number
  notes: string | null
}

export interface Order {
  id: string
  order_number: number
  status: OrderStatus
  total_estimate: number | null
  final_total: number | null
  notes: string | null
  created_at: string
  items: OrderItem[]
}

export type OrderStatus =
  | 'pending' | 'reviewed' | 'quoted' | 'confirmed'
  | 'shipped' | 'closed' | 'cancelled'

// תצוגת הסטטוסים בעברית (U: כל הממשק בעברית)
export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'ממתינה לטיפול',
  reviewed: 'נסקרה',
  quoted: 'נשלחה הצעת מחיר',
  confirmed: 'אושרה',
  shipped: 'נשלחה',
  closed: 'הושלמה',
  cancelled: 'בוטלה',
}

export const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  reviewed: 'bg-blue-100 text-blue-800',
  quoted: 'bg-purple-100 text-purple-800',
  confirmed: 'bg-green-100 text-green-800',
  shipped: 'bg-teal-100 text-teal-800',
  closed: 'bg-gray-200 text-gray-700',
  cancelled: 'bg-red-100 text-red-700',
}

export function formatPrice(value: number): string {
  return new Intl.NumberFormat('he-IL', { style: 'currency', currency: 'ILS' }).format(value)
}
