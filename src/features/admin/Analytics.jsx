import { Card } from '../../components/ui/Card'
import { useAdminAnalytics } from '../../hooks/useAdminAnalytics'
import { todayIST } from '../../lib/datetime'

// plan.md §45 — "who ... most" for the month: eight short ranked lists, top 10 each. Each list
// is one measure in one colour, so no legend; the number is always written next to the bar
// (the list itself is the table view), and hovering a row shows its one-line detail.

const CARDS = [
  { key: 'grace', title: 'Used the grace period most', unit: 'days', note: "Days they finished 1-15 minutes short of the day's hours and the 15-minute grace period covered it." },
  { key: 'leave', title: 'Took the most leave', unit: 'days', note: 'Approved leave days this month. Half-days count 0.5. WFH, On Duty and hour-long Partial Leave are not counted.' },
  { key: 'regularization', title: 'Regularized the most', unit: 'requests', note: 'Attendance-correction requests filed this month (any decision).' },
  { key: 'deviceReset', title: 'Asked for the most device resets', unit: 'resets', note: 'Times HR reset their registered device this month.' },
  { key: 'visitsMonth', title: 'Most visits this month', unit: 'visits', note: 'Field visits logged this month.' },
  { key: 'visitsDay', title: 'Most visits in a single day', unit: 'visits', note: 'Their busiest day this month.' },
  { key: 'km', title: 'Most kilometres this month', unit: 'km', note: 'Travel distance this month, including the return leg to the punch-out point.' },
  { key: 'lateOut', title: 'Punched out after 7 pm', unit: 'days', note: 'Days this month their punch-out was after 7 pm.' },
]

function RankCard({ title, note, unit, rows, loading }) {
  const max = rows.length ? rows[0].value : 0
  return (
    <Card>
      <h3 className="text-white font-semibold text-sm">{title}</h3>
      <p className="text-white/40 text-xs mt-0.5 mb-3">{note}</p>
      {loading && rows.length === 0 ? (
        <p className="text-white/30 text-xs py-3">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-white/30 text-xs py-3">Nobody this month.</p>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} title={r.detail}>
              <div className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-white/80 truncate">
                  <span className="text-white/30 mr-1.5">{i + 1}.</span>{r.name}
                  {r.company && <span className="text-white/30"> · {r.company.split(' ')[0]}</span>}
                </span>
                <span className="text-white font-semibold flex-shrink-0">{r.value} <span className="text-white/40 font-normal">{r.value === 1 ? unit.replace(/s$/, '') : unit}</span></span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-white/5" aria-hidden="true">
                <div className="h-1.5 rounded-full bg-indigo-400/80" style={{ width: `${Math.max(4, (r.value / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </Card>
  )
}

export function Analytics({ token, employees, leaves, adminRegs, stdHours }) {
  const { month, setMonth, loading, error, rankings } = useAdminAnalytics(token, { employees, leaves, adminRegs, stdHours })
  return (
    <>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-white font-bold text-lg">Analytics</h2>
        <label className="flex items-center gap-2 text-white/50 text-xs">
          Month
          <input
            type="month" value={month} max={todayIST().slice(0, 7)}
            onChange={e => e.target.value && setMonth(e.target.value)}
            className="bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-white text-xs focus:outline-none focus:border-indigo-400"
          />
        </label>
      </div>
      {error && <p className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {CARDS.map(c => <RankCard key={c.key} title={c.title} note={c.note} unit={c.unit} rows={rankings[c.key]} loading={loading} />)}
      </div>
      <p className="text-white/30 text-xs">
        Top 10 per list. Travel figures include visits archived when a travel period was paid; periods paid before 3 Oct 2026 have no visit-level history.
      </p>
    </>
  )
}
