// כותרת עליונה אחידה לדפים הפנימיים
import { Link } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

export function AppHeader({ title }: { title?: string }) {
  const { user, logout } = useAuth()

  return (
    <header className="bg-white shadow-sm sticky top-0 z-10">
      <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <span className="text-2xl">🧸</span>
          <span className="font-bold text-gray-900 hidden sm:inline">Kerem Orders</span>
          {title && <span className="text-gray-500 hidden md:inline">· {title}</span>}
        </Link>
        <nav className="flex items-center gap-3 text-sm">
          <Link to="/catalog" className="text-blue-600 hover:underline">קטלוג</Link>
          <Link to="/orders" className="text-blue-600 hover:underline">ההזמנות שלי</Link>
          {user?.role === 'admin' && (
            <Link to="/admin/sync" className="text-blue-600 hover:underline">סנכרון</Link>
          )}
          <button onClick={logout} className="text-red-600 hover:underline">התנתק</button>
        </nav>
      </div>
    </header>
  )
}
