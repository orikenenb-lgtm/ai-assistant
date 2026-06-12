// מעטפת אחידה לכל מסכי האימות (login / signup / reset)
import type { ReactNode } from 'react'

export function AuthLayout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full">
        <div className="text-center mb-6">
          <span className="text-4xl">🧸</span>
          <h1 className="mt-2 text-2xl font-bold text-gray-900">Kerem Orders</h1>
          <h2 className="mt-1 text-lg text-gray-600">{title}</h2>
        </div>
        {children}
      </div>
    </div>
  )
}

export function FormField({
  label,
  type = 'text',
  value,
  onChange,
  required = true,
  autoComplete,
  dir,
}: {
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  autoComplete?: string
  dir?: 'ltr' | 'rtl'
}) {
  return (
    <label className="block mb-4">
      <span className="block text-sm font-medium text-gray-700 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        autoComplete={autoComplete}
        dir={dir}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      />
    </label>
  )
}

export function SubmitButton({ children, loading }: { children: ReactNode; loading: boolean }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="w-full rounded-lg bg-blue-600 text-white py-2.5 font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
    >
      {loading ? 'רק רגע…' : children}
    </button>
  )
}

export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="mb-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
      {message}
    </div>
  )
}
