// לקוחות (אדמין): רשימה מסונכרנת מ-Rivhit, הזמנת לקוח במייל, קישור משתמשים
import { useState } from 'react'
import type { FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AppHeader } from '../../components/AppHeader'
import { api, extractErrorMessage } from '../../lib/api'

interface Customer {
  id: string
  rivhit_id: number
  name: string
  city: string | null
  phone: string | null
  email: string | null
  is_active: boolean
}

interface Profile {
  id: string
  role: string
  full_name: string | null
  rivhit_customer_id: number | null
  status: string
}

function InviteForm({ customers }: { customers: Customer[] }) {
  const [email, setEmail] = useState('')
  const [rivhitId, setRivhitId] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  const inviteMutation = useMutation({
    mutationFn: async () =>
      (await api.post('/admin/customers/invite', {
        email,
        rivhit_customer_id: Number(rivhitId),
      })).data,
    onSuccess: (data: { message: string }) => {
      setMessage(data.message)
      setEmail('')
      setRivhitId('')
    },
  })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setMessage(null)
    inviteMutation.mutate()
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm p-6">
      <h2 className="font-bold text-gray-900 mb-3">📧 הזמן לקוח למערכת</h2>
      {message && (
        <div className="mb-3 rounded-lg bg-green-50 border border-green-200 text-green-800 px-3 py-2 text-sm">
          {message}
        </div>
      )}
      {inviteMutation.isError && (
        <div className="mb-3 rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
          {extractErrorMessage(inviteMutation.error)}
        </div>
      )}
      <div className="grid sm:grid-cols-3 gap-3">
        <input
          type="email" required value={email} dir="ltr"
          onChange={(e) => setEmail(e.target.value)}
          placeholder="email@example.com"
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
        <select
          required value={rivhitId}
          onChange={(e) => setRivhitId(e.target.value)}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm bg-white"
        >
          <option value="">בחר לקוח Rivhit…</option>
          {customers.map((c) => (
            <option key={c.id} value={c.rivhit_id}>{c.name} ({c.rivhit_id})</option>
          ))}
        </select>
        <button
          type="submit"
          disabled={inviteMutation.isPending}
          className="rounded-lg bg-blue-600 text-white px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {inviteMutation.isPending ? 'שולח…' : 'שלח הזמנה'}
        </button>
      </div>
      <p className="mt-2 text-xs text-gray-500">
        הלקוח יקבל מייל, יקבע סיסמה — ויקושר אוטומטית ללקוח ה-Rivhit שבחרת.
      </p>
    </form>
  )
}

function UnlinkedUsers({ customers }: { customers: Customer[] }) {
  const queryClient = useQueryClient()
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: async () => (await api.get<Profile[]>('/admin/users')).data,
  })

  const linkMutation = useMutation({
    mutationFn: async ({ profileId, rivhitId }: { profileId: string; rivhitId: number }) =>
      (await api.patch(`/admin/users/${profileId}`, { rivhit_customer_id: rivhitId })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const unlinked = usersQuery.data?.filter(
    (p) => p.role === 'customer' && !p.rivhit_customer_id) ?? []

  // כשל בטעינה לא נבלע בשקט — אחרת זרימת הקישור "נעלמת" בלי הסבר
  if (usersQuery.isLoading) {
    return <div className="bg-white rounded-2xl p-6 h-24 animate-pulse" />
  }
  if (usersQuery.isError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-sm text-red-700">
        טעינת המשתמשים נכשלה: {extractErrorMessage(usersQuery.error)}
      </div>
    )
  }

  if (unlinked.length === 0) return null

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
      <h2 className="font-bold text-amber-900 mb-3">
        ⚠️ {unlinked.length} משתמשים ממתינים לקישור ללקוח
      </h2>
      {linkMutation.isError && (
        <div className="mb-3 text-sm text-red-700">{extractErrorMessage(linkMutation.error)}</div>
      )}
      <div className="space-y-2">
        {unlinked.map((profile) => (
          <div key={profile.id} className="flex items-center gap-3 flex-wrap bg-white rounded-lg px-3 py-2">
            <span className="text-sm font-medium flex-1">{profile.full_name ?? profile.id}</span>
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  linkMutation.mutate({ profileId: profile.id, rivhitId: Number(e.target.value) })
                }
              }}
              className="rounded-lg border border-gray-300 px-2 py-1.5 text-sm bg-white"
            >
              <option value="">קשר ללקוח…</option>
              {customers.map((c) => (
                <option key={c.id} value={c.rivhit_id}>{c.name}</option>
              ))}
            </select>
          </div>
        ))}
      </div>
    </div>
  )
}

export function AdminCustomersPage() {
  const [search, setSearch] = useState('')

  const customersQuery = useQuery({
    queryKey: ['admin-customers', search],
    queryFn: async () => {
      const params = search ? { search } : {}
      return (await api.get<Customer[]>('/admin/customers', { params })).data
    },
  })

  const customers = customersQuery.data ?? []

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader title="לקוחות" />

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-bold text-gray-900">לקוחות</h1>

        <UnlinkedUsers customers={customers} />
        <InviteForm customers={customers} />

        <div className="bg-white rounded-2xl shadow-sm p-6">
          <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
            <h2 className="font-bold text-gray-900">כל הלקוחות ({customers.length})</h2>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או עיר…"
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          {customersQuery.isLoading && <div className="h-32 animate-pulse bg-gray-50 rounded-lg" />}
          {customersQuery.isError && (
            <div className="text-sm text-red-700">{extractErrorMessage(customersQuery.error)}</div>
          )}
          {customers.length === 0 && !customersQuery.isLoading && (
            <p className="text-sm text-gray-500 text-center py-8">
              אין לקוחות עדיין — הרץ סנכרון מ-Rivhit קודם
            </p>
          )}

          {customers.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-gray-500 border-b">
                    <th className="py-2 pe-4">שם</th>
                    <th className="py-2 pe-4">עיר</th>
                    <th className="py-2 pe-4">טלפון</th>
                    <th className="py-2 pe-4">אימייל</th>
                    <th className="py-2">Rivhit</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => (
                    <tr key={c.id} className="border-b last:border-0">
                      <td className="py-2.5 pe-4 font-medium">{c.name}</td>
                      <td className="py-2.5 pe-4">{c.city ?? '—'}</td>
                      <td className="py-2.5 pe-4" dir="ltr">{c.phone ?? '—'}</td>
                      <td className="py-2.5 pe-4" dir="ltr">{c.email ?? '—'}</td>
                      <td className="py-2.5 text-gray-500">{c.rivhit_id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
