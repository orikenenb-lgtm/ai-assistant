// שומר ניתוב לאדמין: customer שמנסה להגיע לדף ניהול מוחזר לדף הבית
import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { ProtectedRoute } from './ProtectedRoute'

function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <Navigate to="/" replace />
  return <>{children}</>
}

export function AdminRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <AdminOnly>{children}</AdminOnly>
    </ProtectedRoute>
  )
}
