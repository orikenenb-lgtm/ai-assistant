// ספק (Provider) האימות — מצב המשתמש המחובר זמין לכל המערכת.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { api, AUTH_INVALIDATED_EVENT, clearTokens, getAccessToken, saveTokens } from './api'
import { AuthContext } from './auth-context'
import type { User } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  // אם אין טוקן שמור — אין מה לטעון; אם יש — נבדוק אותו מול השרת ב-effect
  const [loading, setLoading] = useState(() => Boolean(getAccessToken()))

  useEffect(() => {
    if (!getAccessToken()) return
    api
      .get<User>('/auth/me')
      .then(({ data }) => setUser(data))
      .catch(() => clearTokens())
      .finally(() => setLoading(false))
  }, [])

  // כשרענון הטוקן נכשל (clearTokens מה-interceptor) — מתנתקים גם ב-React
  useEffect(() => {
    const onInvalidated = () => setUser(null)
    window.addEventListener(AUTH_INVALIDATED_EVENT, onInvalidated)
    return () => window.removeEventListener(AUTH_INVALIDATED_EVENT, onInvalidated)
  }, [])

  async function login(email: string, password: string) {
    const { data } = await api.post('/auth/login', { email, password })
    saveTokens(data.access_token, data.refresh_token)
    setUser(data.user)
  }

  async function signup(email: string, password: string, fullName: string, phone?: string) {
    const { data } = await api.post('/auth/signup', {
      email,
      password,
      full_name: fullName,
      phone: phone || null,
    })
    saveTokens(data.access_token, data.refresh_token)
    setUser(data.user)
  }

  function logout() {
    clearTokens()
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
