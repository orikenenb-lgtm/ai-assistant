// מסך פתיחה זמני — יוחלף בדפי login וקטלוג ב-Phase 1 ו-3
function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
        <span className="text-5xl">🧸</span>
        <h1 className="mt-4 text-3xl font-bold text-gray-900">Kerem Orders</h1>
        <p className="mt-2 text-lg text-gray-600">
          מערכת הזמנות — סיטונאות צעצועים
        </p>
        <p className="mt-6 text-sm text-gray-400">
          Phase 0 — התשתית מוכנה ✓
        </p>
      </div>
    </div>
  )
}

export default App
