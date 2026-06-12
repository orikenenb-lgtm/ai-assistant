// דף הרשמה — לקוח חדש (יקושר ללקוח Rivhit על ידי אבא בהמשך)
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout, ErrorMessage, FormField, SubmitButton } from '../components/AuthLayout'
import { extractErrorMessage } from '../lib/api'
import { useAuth } from '../lib/auth-context'

export function SignupPage() {
  const { signup } = useAuth()
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (password.length < 8) {
      setError('הסיסמה חייבת להכיל לפחות 8 תווים')
      return
    }
    setError(null)
    setLoading(true)
    try {
      await signup(email, password, fullName, phone || undefined)
      navigate('/')
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="הרשמה">
      <form onSubmit={handleSubmit}>
        <ErrorMessage message={error} />
        <FormField label="שם מלא" value={fullName} onChange={setFullName} autoComplete="name" />
        <FormField label="אימייל" type="email" value={email} onChange={setEmail}
          autoComplete="email" dir="ltr" />
        <FormField label="טלפון (אופציונלי)" type="tel" value={phone} onChange={setPhone}
          required={false} autoComplete="tel" dir="ltr" />
        <FormField label="סיסמה (לפחות 8 תווים)" type="password" value={password}
          onChange={setPassword} autoComplete="new-password" dir="ltr" />
        <SubmitButton loading={loading}>הירשם</SubmitButton>
      </form>
      <div className="mt-4 text-center text-sm">
        <Link to="/login" className="text-blue-600 hover:underline">
          כבר יש לך חשבון? התחבר
        </Link>
      </div>
    </AuthLayout>
  )
}
