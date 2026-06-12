// מסך סנכרון Rivhit (אדמין בלבד): תצוגה מקדימה, סנכרון אמיתי, והיסטוריית לוגים
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, extractErrorMessage } from '../lib/api'

interface SyncResult {
  sync_type: string
  dry_run: boolean
  status: 'success' | 'error'
  records_synced: number
  records_created: number
  records_updated: number
  records_deactivated: number
  error_message: string | null
}

interface SyncLog {
  id: string
  sync_type: string
  status: string
  records_synced: number
  records_created: number
  records_updated: number
  error_message: string | null
  created_at: string
}

const TYPE_LABELS: Record<string, string> = {
  products: 'מוצרים',
  customers: 'לקוחות',
}

function ResultCard({ result }: { result: SyncResult }) {
  const ok = result.status === 'success'
  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${
      ok ? 'bg-green-50 border-green-200 text-green-900'
         : 'bg-red-50 border-red-200 text-red-900'}`}>
      <div className="font-medium">
        {TYPE_LABELS[result.sync_type] ?? result.sync_type}
        {result.dry_run && ' (תצוגה מקדימה — לא נשמר דבר)'}
      </div>
      {ok ? (
        <div className="mt-1">
          התקבלו {result.records_synced} רשומות · {result.records_created} חדשות ·{' '}
          {result.records_updated} עודכנו · {result.records_deactivated} יושבתו
        </div>
      ) : (
        <div className="mt-1">{result.error_message}</div>
      )}
    </div>
  )
}

export function AdminSyncPage() {
  const queryClient = useQueryClient()
  const [results, setResults] = useState<SyncResult[] | null>(null)

  const logsQuery = useQuery({
    queryKey: ['sync-logs'],
    queryFn: async () => (await api.get<SyncLog[]>('/admin/sync/logs')).data,
  })

  const syncMutation = useMutation({
    mutationFn: async (dryRun: boolean) =>
      (await api.post<SyncResult[]>('/admin/sync', { sync_type: 'all', dry_run: dryRun })).data,
    onSuccess: (data) => {
      setResults(data)
      queryClient.invalidateQueries({ queryKey: ['sync-logs'] })
    },
  })

  function runRealSync() {
    if (window.confirm('להריץ סנכרון אמיתי מ-Rivhit? הנתונים במערכת יתעדכנו.')) {
      syncMutation.mutate(false)
    }
  }

  const lastSuccess = logsQuery.data?.find((log) => log.status === 'success')

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="text-2xl">🧸</span>
            <span className="font-bold text-gray-900">Kerem Orders — סנכרון</span>
          </Link>
          <Link to="/" className="text-sm text-blue-600 hover:underline">חזרה לדף הבית</Link>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        <section className="bg-white rounded-2xl shadow p-6">
          <h1 className="text-xl font-bold text-gray-900">סנכרון מ-Rivhit</h1>
          <p className="mt-1 text-sm text-gray-600">
            {lastSuccess
              ? `סנכרון מוצלח אחרון: ${new Date(lastSuccess.created_at).toLocaleString('he-IL')}`
              : 'עוד לא בוצע סנכרון מוצלח'}
          </p>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              onClick={() => syncMutation.mutate(true)}
              disabled={syncMutation.isPending}
              className="rounded-lg border border-blue-600 text-blue-700 px-4 py-2 font-medium hover:bg-blue-50 disabled:opacity-50"
            >
              תצוגה מקדימה (dry-run)
            </button>
            <button
              onClick={runRealSync}
              disabled={syncMutation.isPending}
              className="rounded-lg bg-blue-600 text-white px-4 py-2 font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              {syncMutation.isPending ? 'מסנכרן…' : 'סנכרן עכשיו'}
            </button>
          </div>

          {syncMutation.isError && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 text-red-700 px-3 py-2 text-sm">
              {extractErrorMessage(syncMutation.error)}
            </div>
          )}

          {results && (
            <div className="mt-4 space-y-2">
              {results.map((r) => <ResultCard key={r.sync_type} result={r} />)}
            </div>
          )}
        </section>

        <section className="bg-white rounded-2xl shadow p-6">
          <h2 className="text-lg font-bold text-gray-900 mb-3">היסטוריית סנכרונים</h2>
          {logsQuery.isLoading && <p className="text-gray-500 text-sm">טוען…</p>}
          {logsQuery.isError && (
            <p className="text-red-600 text-sm">{extractErrorMessage(logsQuery.error)}</p>
          )}
          {logsQuery.data?.length === 0 && (
            <p className="text-gray-500 text-sm">אין עדיין סנכרונים — הרץ את הראשון 👆</p>
          )}
          {logsQuery.data && logsQuery.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-right text-gray-500 border-b">
                    <th className="py-2 pe-4">מתי</th>
                    <th className="py-2 pe-4">סוג</th>
                    <th className="py-2 pe-4">סטטוס</th>
                    <th className="py-2 pe-4">נוצרו</th>
                    <th className="py-2 pe-4">עודכנו</th>
                    <th className="py-2">שגיאה</th>
                  </tr>
                </thead>
                <tbody>
                  {logsQuery.data.map((log) => (
                    <tr key={log.id} className="border-b last:border-0">
                      <td className="py-2 pe-4 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleString('he-IL')}
                      </td>
                      <td className="py-2 pe-4">{TYPE_LABELS[log.sync_type] ?? log.sync_type}</td>
                      <td className="py-2 pe-4">
                        {log.status === 'success'
                          ? <span className="text-green-700">✓ הצליח</span>
                          : <span className="text-red-700">✗ נכשל</span>}
                      </td>
                      <td className="py-2 pe-4">{log.records_created}</td>
                      <td className="py-2 pe-4">{log.records_updated}</td>
                      <td className="py-2 text-red-700">{log.error_message ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
