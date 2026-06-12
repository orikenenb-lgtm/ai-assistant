// דף התחברות
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout, ErrorMessage, FormField, SubmitButton } from '../components/AuthLayout'
import { extractErrorMessage } from '../lib/api'
import { useAuth } from '../lib/auth-context'

export function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      navigate('/')
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="התחברות">
      <form onSubmit={handleSubmit}>
        <ErrorMessage message={error} />
        <FormField label="אימייל" type="email" value={email} onChange={setEmail}
          autoComplete="email" dir="ltr" />
        <FormField label="סיסמה" type="password" value={password} onChange={setPassword}
          autoComplete="current-password" dir="ltr" />
        <SubmitButton loading={loading}>התחבר</SubmitButton>
      </form>
      <div className="mt-4 flex justify-between text-sm">
        <Link to="/reset-password" className="text-blue-600 hover:underline">
          שכחתי סיסמה
        </Link>
        <Link to="/signup" className="text-blue-600 hover:underline">
          אין לך חשבון? הירשם
        </Link>
      </div>
    </AuthLayout>
  )
}
