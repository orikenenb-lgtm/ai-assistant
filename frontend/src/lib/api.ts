// לקוח ה-API המרכזי — כל קריאה לשרת עוברת דרכו.
// מצמיד JWT לכל בקשה, ועל 401 מנסה לרענן את ה-session פעם אחת.
import axios, { AxiosError } from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

export const api = axios.create({ baseURL: API_URL })

// ----- ניהול טוקנים ב-localStorage -----
const ACCESS_KEY = 'kerem_access_token'
const REFRESH_KEY = 'kerem_refresh_token'

export function saveTokens(accessToken: string, refreshToken: string) {
  localStorage.setItem(ACCESS_KEY, accessToken)
  localStorage.setItem(REFRESH_KEY, refreshToken)
}

// אירוע גלובלי: שכבת ה-auth מאזינה לו ומנקה את מצב המשתמש ב-React
export const AUTH_INVALIDATED_EVENT = 'kerem:auth-invalidated'

export function clearTokens() {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
  // בלי זה האפליקציה נשארת "מחוברת" ויזואלית עד רענון קשיח
  window.dispatchEvent(new Event(AUTH_INVALIDATED_EVENT))
}

export function getAccessToken(): string | null {
  return localStorage.getItem(ACCESS_KEY)
}

function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}

// ----- הצמדת ה-JWT לכל בקשה יוצאת -----
api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = getAccessToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// ----- רענון אוטומטי: על 401 מנסים refresh פעם אחת וחוזרים על הבקשה -----
let refreshPromise: Promise<string | null> | null = null

async function tryRefresh(): Promise<string | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null
  try {
    // axios "נקי" בלי interceptors — כדי לא להיכנס ללולאה אינסופית
    const { data } = await axios.post(`${API_URL}/auth/refresh-token`, {
      refresh_token: refreshToken,
    })
    saveTokens(data.access_token, data.refresh_token)
    return data.access_token
  } catch {
    clearTokens()
    return null
  }
}

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as InternalAxiosRequestConfig & { _retried?: boolean }
    const isAuthRoute = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh-token')

    if (error.response?.status === 401 && original && !original._retried && !isAuthRoute) {
      original._retried = true
      // בקשות מקביליות חולקות refresh אחד
      refreshPromise = refreshPromise ?? tryRefresh()
      const newToken = await refreshPromise
      refreshPromise = null
      if (newToken) {
        original.headers.Authorization = `Bearer ${newToken}`
        return api(original)
      }
    }
    return Promise.reject(error)
  },
)

// ----- חילוץ הודעת שגיאה ידידותית בעברית מכל תשובת שרת -----
export function extractErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown })?.detail
    if (typeof detail === 'string') return detail
    if (!error.response) return 'אין חיבור לשרת — נסה שוב בעוד רגע'
  }
  return 'אירעה שגיאה — נסה שוב'
}
