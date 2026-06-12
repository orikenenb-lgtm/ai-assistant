// ספק הסל — נשמר ב-localStorage לכל משתמש בנפרד (לא זולג בין חשבונות)
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './auth-context'
import { CartContext } from './cart-context'
import type { CartLine } from './cart-context'
import type { Product } from './types'

function storageKeyFor(userId: string | undefined): string | null {
  return userId ? `kerem_cart:${userId}` : null
}

function isValidLine(line: unknown): line is CartLine {
  if (typeof line !== 'object' || line === null) return false
  const candidate = line as { quantity?: unknown; product?: { id?: unknown; base_price?: unknown } }
  return (
    typeof candidate.quantity === 'number' &&
    candidate.quantity > 0 &&
    typeof candidate.product?.id === 'string' &&
    typeof candidate.product?.base_price === 'number'
  )
}

function loadCart(storageKey: string | null): CartLine[] {
  // ולידציה מלאה: סל פגום ב-localStorage לא יפיל את האפליקציה
  try {
    if (!storageKey) return []
    const raw = localStorage.getItem(storageKey)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isValidLine)
  } catch {
    return []
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const storageKey = storageKeyFor(user?.id)
  const [lines, setLines] = useState<CartLine[]>(() => loadCart(storageKey))
  const [loadedKey, setLoadedKey] = useState(storageKey)

  // החלפת משתמש (כולל logout) → איפוס בזמן render לסל של המשתמש הנוכחי
  if (storageKey !== loadedKey) {
    setLoadedKey(storageKey)
    setLines(loadCart(storageKey))
  }

  useEffect(() => {
    if (!storageKey) return
    localStorage.setItem(storageKey, JSON.stringify(lines))
  }, [storageKey, lines])

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
