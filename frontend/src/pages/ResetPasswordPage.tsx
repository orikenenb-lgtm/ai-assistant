// דף "שכחתי סיסמה" — שולח קישור איפוס לאימייל (דרך Supabase Auth)
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout, ErrorMessage, FormField, SubmitButton } from '../components/AuthLayout'
import { api, extractErrorMessage } from '../lib/api'

export function ResetPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await api.post('/auth/reset-password', { email })
      setSent(true)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="איפוס סיסמה">
      {sent ? (
        <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 px-4 py-3 text-sm">
          אם האימייל רשום במערכת — נשלח אליו קישור לאיפוס הסיסמה. בדוק את תיבת הדואר.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <ErrorMessage message={error} />
          <FormField label="אימייל" type="email" value={email} onChange={setEmail}
            autoComplete="email" dir="ltr" />
          <SubmitButton loading={loading}>שלח קישור איפוס</SubmitButton>
        </form>
      )}
      <div className="mt-4 text-center text-sm">
        <Link to="/login" className="text-blue-600 hover:underline">
          חזרה להתחברות
        </Link>
      </div>
    </AuthLayout>
  )
}
