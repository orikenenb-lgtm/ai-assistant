// דף הבית אחרי התחברות — placeholder שיוחלף בקטלוג (Phase 3) ודשבורד (Phase 4)
import { useAuth } from '../lib/auth-context'

export function HomePage() {
  const { user, logout } = useAuth()

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-2xl">🧸</span>
            <span className="font-bold text-gray-900">Kerem Orders</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              שלום, {user?.full_name ?? user?.email}
              {user?.role === 'admin' && (
                <span className="me-2 text-xs bg-blue-100 text-blue-800 rounded-full px-2 py-0.5">
                  מנהל
                </span>
              )}
            </span>
            <button
              onClick={logout}
              className="text-sm text-red-600 hover:underline"
            >
              התנתק
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10 text-center">
        <h1 className="text-2xl font-bold text-gray-900">ברוכים הבאים 👋</h1>
        <p className="mt-2 text-gray-600">
          {user?.role === 'admin'
            ? 'דשבורד הניהול יהיה זמין כאן בקרוב (Phase 4)'
            : user?.rivhit_customer_id
              ? 'הקטלוג שלך יהיה זמין כאן בקרוב (Phase 3)'
              : 'החשבון שלך נוצר! הוא ימתין לקישור על ידי מנהל המערכת לפני שתוכל להזמין.'}
        </p>
      </main>
    </div>
  )
}
