// הגדרת ה-context וה-hook של האימות (מופרד מה-Provider לטובת Fast Refresh)
import { createContext, useContext } from 'react'

export interface User {
  id: string
  email: string | null
  role: 'admin' | 'customer'
  full_name: string | null
  phone: string | null
  rivhit_customer_id: number | null
  status: string
}

export interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, fullName: string, phone?: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth חייב לרוץ בתוך AuthProvider')
  return ctx
}
