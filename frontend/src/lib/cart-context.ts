// הקשר הסל — מופרד מה-Provider לטובת Fast Refresh
import { createContext, useContext } from 'react'
import type { Product } from './types'

export interface CartLine {
  product: Product
  quantity: number
}

export interface CartContextValue {
  lines: CartLine[]
  totalItems: number
  totalEstimate: number
  setQuantity: (product: Product, quantity: number) => void
  getQuantity: (productId: string) => number
  clear: () => void
}

export const CartContext = createContext<CartContextValue | null>(null)

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error('useCart חייב לרוץ בתוך CartProvider')
  return ctx
}
