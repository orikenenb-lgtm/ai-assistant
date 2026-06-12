// ספק הסל — נשמר ב-localStorage כדי לשרוד רענון דף
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { CartContext } from './cart-context'
import type { CartLine } from './cart-context'
import type { Product } from './types'

const STORAGE_KEY = 'kerem_cart'

function loadCart(): CartLine[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CartLine[]) : []
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>(loadCart)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lines))
  }, [lines])

  const value = useMemo(() => {
    function setQuantity(product: Product, quantity: number) {
      setLines((prev) => {
        const others = prev.filter((line) => line.product.id !== product.id)
        // כמות 0 או פחות = הסרה מהסל
        return quantity > 0 ? [...others, { product, quantity }] : others
      })
    }

    function getQuantity(productId: string): number {
      return lines.find((line) => line.product.id === productId)?.quantity ?? 0
    }

    return {
      lines,
      totalItems: lines.reduce((sum, line) => sum + line.quantity, 0),
      totalEstimate: lines.reduce(
        (sum, line) => sum + line.quantity * line.product.base_price, 0),
      setQuantity,
      getQuantity,
      clear: () => setLines([]),
    }
  }, [lines])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
