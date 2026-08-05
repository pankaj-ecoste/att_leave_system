import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Card } from '../../components/ui/Card'
import { todayIST, nowTimeIST } from '../../lib/datetime'

// G-6 (plan.md §8C) — "database reachable, functions responding, last import, last
// cron run". Reachable at /?health=1 with no login required, so it stays useful when
// something's actually broken (an admin who can't log in still needs to know whether
// the problem is the database, the network, or something else). Cron job run history
// isn't anon-readable — check the Supabase dashboard's Cron Jobs page for that one.
export function HealthCheck() {
  const [dbCheck, setDbCheck] = useState({ status: 'checking' })
  const [fnCheck, setFnCheck] = useState({ status: 'checking' })

  useEffect(() => {
    const start = performance.now()
    supabase.from('app_settings_public').select('std_hours').single().then(({ data, error }) => {
      const ms = Math.round(performance.now() - start)
      if (error) setDbCheck({ status: 'fail', detail: error.message, ms })
      else setDbCheck({ status: 'ok', detail: `std_hours = ${data.std_hours}`, ms })
    })

    const fnStart = performance.now()
    supabase.rpc('fetch_directory').then(({ data, error }) => {
      const ms = Math.round(performance.now() - fnStart)
      if (error) setFnCheck({ status: 'fail', detail: error.message, ms })
      else setFnCheck({ status: 'ok', detail: `${data.length} active employees returned`, ms })
    })
  }, [])

  const items = [
    { label: 'Database reachable', check: dbCheck },
    { label: 'Functions responding (fetch_directory)', check: fnCheck },
  ]

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md space-y-3">
        <h1 className="text-white text-xl font-bold mb-1">HRMS Health Check</h1>
        <p className="text-white/40 text-xs mb-4">IST time: {todayIST()} {nowTimeIST()}</p>
        {items.map(({ label, check }) => (
          <Card key={label} className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-medium">{label}</p>
              <p className="text-white/40 text-xs mt-0.5">{check.detail || '…'}{check.ms !== undefined ? ` · ${check.ms}ms` : ''}</p>
            </div>
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
              check.status === 'ok' ? 'bg-emerald-500/20 text-emerald-300'
                : check.status === 'fail' ? 'bg-red-500/20 text-red-300'
                : 'bg-white/10 text-white/40'
            }`}>
              {check.status === 'checking' ? 'checking…' : check.status.toUpperCase()}
            </span>
          </Card>
        ))}
        <p className="text-white/20 text-xs text-center pt-2">
          Last import times: Admin Panel → Settings.<br />Cron job history: Supabase dashboard → Database → Cron Jobs.
        </p>
      </div>
    </div>
  )
}
