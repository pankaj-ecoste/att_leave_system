import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { attnKey } from '../../api/mappers'
import { todayIST } from '../../lib/datetime'
import { downloadTravelReportFile, claimEmailText, claimGmailUrl } from '../../lib/travelReport'
import { allJourneyDates, groupExpensesByDate } from '../../lib/travelExpenses'

// plan.md §46 — staff pick an end date, submit a claim for the unclaimed days up to it, the
// report downloads, and a pre-written email to HR opens in Gmail. Gmail can't receive the file
// through a link, so the employee attaches the downloaded file in Gmail themselves.

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function TravelClaimCard({ currentUser, attendance, journey, expenses = [], claims, submitClaim }) {
  const submitted = claims || []
  const claimedThrough = submitted.reduce((max, c) => (c.periodEnd > max ? c.periodEnd : max), '')
  const unclaimedDates = allJourneyDates(journey, expenses.filter(x => !x.claimId))
    .filter(d => !claimedThrough || d > claimedThrough)
  const firstUnclaimed = unclaimedDates[0] || null
  const minEnd = firstUnclaimed ? addDays(firstUnclaimed, 4) : null
  const today = todayIST()

  const [endDate, setEndDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [ready, setReady] = useState(null)

  async function prepare() {
    setErr('')
    setReady(null)
    if (!endDate) { setErr('Pick an end date'); return }
    if (minEnd && endDate < minEnd) { setErr(`A claim must cover at least 5 days — choose ${minEnd} or later`); return }
    if (endDate > today) { setErr('The end date cannot be in the future'); return }
    setBusy(true)
    try {
      const claim = await submitClaim(endDate)
      const inPeriod = d => d >= claim.periodStart && d <= claim.periodEnd
      const periodDates = allJourneyDates(journey, expenses).filter(inPeriod)
      const journeyByDate = {}
      for (const v of journey) {
        if (v.date >= claim.periodStart && v.date <= claim.periodEnd) (journeyByDate[v.date] ||= []).push(v)
      }
      const attnByDate = {}
      for (const d of periodDates) attnByDate[d] = attendance?.[attnKey(currentUser.id, d)]
      const periodLabel = `${claim.periodStart} to ${claim.periodEnd}`
      const fileName = downloadTravelReportFile(`travel_allowance_${currentUser.empNum || 'staff'}_${claim.periodStart}_${claim.periodEnd}`, {
        employee: { name: currentUser.name, empNum: currentUser.empNum, taRateTier: claim.rateTier },
        dates: periodDates, journeyByDate, attnByDate, rate: claim.ratePerKm, periodLabel,
        expensesByDate: groupExpensesByDate(expenses.filter(x => inPeriod(x.date))),
      })
      const { subject, body } = claimEmailText({
        name: currentUser.name, empNum: currentUser.empNum, periodStart: claim.periodStart, periodEnd: claim.periodEnd,
        totalKm: claim.totalKm, totalExpense: claim.expenseAmount, amount: claim.amount, fileName,
      })
      setReady({ url: claimGmailUrl({ subject, body }), fileName, amount: claim.amount })
      setEndDate('')
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <p className="text-white/50 text-xs uppercase tracking-wide mb-2">Travel claim</p>
      {firstUnclaimed ? (
        <>
          <p className="text-white/70 text-sm mb-2">
            Unclaimed travel starts on <span className="text-white">{firstUnclaimed}</span>. Choose an end date at least 5 days later.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="date" value={endDate} min={minEnd || undefined} max={today}
              onChange={e => setEndDate(e.target.value)}
              className="bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-white text-sm"
            />
            <Button className="text-xs" disabled={busy} onClick={prepare}>{busy ? 'Preparing...' : 'Prepare report & email HR'}</Button>
          </div>
          {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
          {ready && (
            <div className="mt-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10">
              <p className="text-emerald-300 text-sm">Claim submitted for ₹{ready.amount.toFixed(2)}. Your report was downloaded as <span className="font-medium">{ready.fileName}</span>.</p>
              <p className="text-white/60 text-xs mt-1">Open the email, attach that file, and send it.</p>
              <a href={ready.url} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-indigo-300 underline underline-offset-2 text-sm">Open Gmail draft to HR ↗</a>
            </div>
          )}
        </>
      ) : (
        <p className="text-white/40 text-sm">No unclaimed travel right now.</p>
      )}

      {submitted.length > 0 && (
        <div className="mt-4">
          <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2">Awaiting payment</p>
          {submitted.map(c => (
            <div key={c.id} className="flex items-center justify-between py-2 border-b border-white/5 text-xs">
              <span className="text-white/60">{c.periodStart} – {c.periodEnd} · {c.totalKm.toFixed(1)} km</span>
              <span className="text-amber-300 font-medium">₹{c.amount.toFixed(2)} · Submitted</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
