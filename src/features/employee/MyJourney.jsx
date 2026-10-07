import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { TravelDayChain } from '../../components/TravelDayChain'
import { PhotoViewerModal } from '../../components/PhotoViewerModal'
import { attnKey } from '../../api/mappers'
import { dayPoints } from '../../lib/travelPoints'
import { TravelClaimCard } from './TravelClaimCard'
import { TravelExpenseList } from '../../components/TravelExpenseList'
import { EXPENSE_CATEGORIES, validateExpenseInput, groupExpensesByDate, allJourneyDates } from '../../lib/travelExpenses'

// Only fetched when a map is actually opened (plan.md §28 decision 9).
const JourneyMap = lazy(() => import('../../components/JourneyMap').then(m => ({ default: m.JourneyMap })))

// plan.md §28 — "My Journey": camera-only selfie + mandatory site note per client
// visit, an optional additional expense (toll/lunch/etc — receipt photo mandatory the
// moment one is entered), today's/open-period list grouped by day, cumulative
// distance + expense total, and a lazy map. Only rendered for Field / Office+Field
// staff — gated by the caller (EmployeeDashboard) using the same requiresFieldNote()
// check the punch screen already uses.
export function MyJourney({ currentUser, attendance, journey, summary, settlements, claims, submitClaim, loading, addingVisit, locationStatus, addVisit, fetchPhotoUrl, expenses = [], addingExpense = false, addExpense, deleteExpense }) {
  const [pendingFile, setPendingFile] = useState(null)
  const [siteNote, setSiteNote] = useState('')
  const [showExpense, setShowExpense] = useState(false)
  const [expenseNote, setExpenseNote] = useState('')
  const [expenseAmount, setExpenseAmount] = useState('')
  const [expenseFile, setExpenseFile] = useState(null)
  const [err, setErr] = useState('')
  const [openMapDate, setOpenMapDate] = useState(null)
  const [selectedVisitId, setSelectedVisitId] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const [expensePreviewUrl, setExpensePreviewUrl] = useState(null)
  const [viewerUrl, setViewerUrl] = useState(null)
  const fileInputRef = useRef(null)
  const expenseInputRef = useRef(null)
  // plan.md §48 — standalone "+ Add Expense" (toll / lunch / other) form, separate from a visit's own optional expense.
  const [showExpForm, setShowExpForm] = useState(false)
  const [expCategory, setExpCategory] = useState('')
  const [expAmount, setExpAmount] = useState('')
  const [expFile, setExpFile] = useState(null)
  const [expPreview, setExpPreview] = useState(null)
  const [expErr, setExpErr] = useState('')
  const standaloneInputRef = useRef(null)

  useEffect(() => {
    if (!pendingFile) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(pendingFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

  useEffect(() => {
    if (!expenseFile) { setExpensePreviewUrl(null); return }
    const url = URL.createObjectURL(expenseFile)
    setExpensePreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [expenseFile])

  useEffect(() => {
    if (!expFile) { setExpPreview(null); return }
    const url = URL.createObjectURL(expFile)
    setExpPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [expFile])

  function resetExpForm() {
    setShowExpForm(false); setExpCategory(''); setExpAmount(''); setExpFile(null); setExpErr('')
  }

  function onStandaloneFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) { setExpFile(file); setExpErr('') }
  }

  async function saveExpense() {
    const problem = validateExpenseInput({ category: expCategory, amount: expAmount, hasPhoto: !!expFile })
    if (problem) { setExpErr(problem); return }
    try {
      setExpErr('')
      await addExpense({ category: expCategory, amount: Number(expAmount), file: expFile })
      resetExpForm()
    } catch (e) {
      setExpErr(e.message)
    }
  }

  function pickPhoto() {
    fileInputRef.current?.click()
  }

  function onFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow choosing the same shot again later
    if (file) { setPendingFile(file); setErr('') }
  }

  function onExpenseFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) { setExpenseFile(file); setErr('') }
  }

  function resetForm() {
    setPendingFile(null)
    setSiteNote('')
    setShowExpense(false)
    setExpenseNote('')
    setExpenseAmount('')
    setExpenseFile(null)
    setErr('')
  }

  async function save() {
    if (!siteNote.trim()) { setErr('Enter the client/site name'); return }
    const hasExpense = expenseNote.trim() || expenseAmount
    if (hasExpense) {
      const amt = Number(expenseAmount)
      if (!expenseAmount || !Number.isFinite(amt) || amt <= 0) { setErr('Enter a valid expense amount'); return }
      if (!expenseFile) { setErr('A receipt photo is required for an additional expense'); return }
    }
    try {
      setErr('')
      await addVisit(pendingFile, siteNote.trim(), hasExpense ? { note: expenseNote.trim(), amount: Number(expenseAmount), file: expenseFile } : null)
      resetForm()
    } catch (e) {
      setErr(e.message)
    }
  }

  const byDate = journey.reduce((acc, v) => {
    (acc[v.date] ||= []).push(v)
    return acc
  }, {})
  const expensesByDate = groupExpensesByDate(expenses)
  const dates = allJourneyDates(journey, expenses).reverse()

  return (
    <div className="space-y-4">
      <PhotoViewerModal url={viewerUrl} onClose={() => setViewerUrl(null)} />
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">Travel Since Last Payout</p>
            <p className="text-2xl font-bold text-white mt-1">{summary.totalKm.toFixed(1)} km</p>
            <p className="text-white/30 text-xs mt-0.5">
              {summary.visitCount} site visit{summary.visitCount === 1 ? '' : 's'}{summary.firstDate ? ` · since ${summary.firstDate}` : ''}
              {summary.totalExpense > 0 && ` · ₹${summary.totalExpense.toFixed(2)} expenses`}
            </p>
          </div>
          <div className="flex flex-col gap-2 items-stretch">
            <Button onClick={pickPhoto} disabled={addingVisit}>{addingVisit ? 'Saving...' : '+ Add Visit'}</Button>
            {addExpense && <Button variant="secondary" onClick={() => setShowExpForm(true)} disabled={addingExpense || showExpForm}>+ Add Expense</Button>}
          </div>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFileChosen} />
        <input ref={expenseInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onExpenseFileChosen} />
        <input ref={standaloneInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onStandaloneFileChosen} />
        {locationStatus && <p className="text-indigo-300 text-xs">{locationStatus}</p>}

        {showExpForm && (
          <div className="mt-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
            <p className="text-white/60 text-xs mb-2">Add an expense — only between Punch In and Punch Out. The bill photo is required.</p>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400"
                value={expCategory} onChange={e => setExpCategory(e.target.value)}
              >
                <option value="" className="text-black">Select type *</option>
                {EXPENSE_CATEGORIES.map(c => <option key={c} value={c} className="text-black">{c}</option>)}
              </select>
              <input
                type="number" inputMode="decimal" min="0" step="0.01"
                className="bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-amber-400"
                value={expAmount} onChange={e => setExpAmount(e.target.value)} placeholder="Amount (₹) *"
              />
            </div>
            <div className="flex items-center gap-2 mt-2">
              {expPreview && <img src={expPreview} alt="Bill preview" className="w-10 h-10 rounded-lg object-cover shrink-0" />}
              <Button variant="secondary" className="text-xs" onClick={() => standaloneInputRef.current?.click()}>
                {expFile ? 'Retake Bill Photo' : 'Add Bill Photo *'}
              </Button>
            </div>
            {expErr && <p className="text-red-400 text-xs mt-2">{expErr}</p>}
            <div className="flex gap-2 mt-3">
              <Button className="flex-1 text-xs" disabled={addingExpense} onClick={saveExpense}>{addingExpense ? 'Saving...' : 'Save Expense'}</Button>
              <Button variant="secondary" className="text-xs" disabled={addingExpense} onClick={resetExpForm}>Cancel</Button>
            </div>
          </div>
        )}

        {pendingFile && (
          <div className="mt-3 p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/10">
            <div className="flex gap-3 items-start">
              {previewUrl && <img src={previewUrl} alt="Selfie preview" className="w-16 h-16 rounded-lg object-cover shrink-0" />}
              <div className="flex-1">
                <label className="text-white/50 text-xs">Client / Site name <span className="text-red-400">*</span></label>
                <input
                  autoFocus className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-white text-sm mt-1 focus:outline-none focus:border-indigo-400"
                  value={siteNote} onChange={e => setSiteNote(e.target.value)} placeholder="e.g. ABC Enterprises, Sector 18"
                />
              </div>
            </div>

            {!showExpense ? (
              <button className="text-indigo-400 hover:text-indigo-300 text-xs underline underline-offset-2 mt-3" onClick={() => setShowExpense(true)}>
                + Add expense (toll, lunch, etc.)
              </button>
            ) : (
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-white/50 text-xs">Additional Expense</p>
                  <button className="text-white/30 hover:text-white/60 text-xs" onClick={() => { setShowExpense(false); setExpenseNote(''); setExpenseAmount(''); setExpenseFile(null) }}>Remove</button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-400"
                    value={expenseNote} onChange={e => setExpenseNote(e.target.value)} placeholder="e.g. Toll, lunch"
                  />
                  <input
                    type="number" min="0" step="0.01"
                    className="bg-white/5 border border-white/15 rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-indigo-400"
                    value={expenseAmount} onChange={e => setExpenseAmount(e.target.value)} placeholder="Amount (₹)"
                  />
                </div>
                <div className="flex items-center gap-2 mt-2">
                  {expensePreviewUrl && <img src={expensePreviewUrl} alt="Receipt preview" className="w-10 h-10 rounded-lg object-cover shrink-0" />}
                  <Button variant="secondary" className="text-xs" onClick={() => expenseInputRef.current?.click()}>
                    {expenseFile ? 'Retake Receipt Photo' : 'Add Receipt Photo *'}
                  </Button>
                </div>
                <p className="text-white/20 text-xs mt-1">A receipt photo is required for any additional expense</p>
              </div>
            )}

            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
            <div className="flex gap-2 mt-3">
              <Button className="flex-1 text-xs" disabled={addingVisit} onClick={save}>{addingVisit ? 'Saving...' : 'Save Visit'}</Button>
              <Button variant="secondary" className="text-xs" onClick={resetForm}>Cancel</Button>
            </div>
          </div>
        )}
      </Card>

      <TravelClaimCard currentUser={currentUser} attendance={attendance} journey={journey} expenses={expenses} claims={claims} submitClaim={submitClaim} />

      {loading && dates.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-8">Loading...</p>
      ) : dates.length === 0 ? (
        <Card><p className="text-white/30 text-sm text-center py-6">No visits logged yet. Punch in, then tap "+ Add Visit" at each site.</p></Card>
      ) : dates.map(date => {
        const visits = byDate[date] || []
        const dayExpenses = expensesByDate[date] || []
        const record = attendance?.[attnKey(currentUser.id, date)]
        return (
          <Card key={date}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-white font-medium text-sm">{date}</p>
              {visits.length > 0 && (
                <button
                  className="text-indigo-400 hover:text-indigo-300 text-xs underline underline-offset-2"
                  onClick={() => setOpenMapDate(openMapDate === date ? null : date)}
                >
                  {openMapDate === date ? 'Hide map' : 'View map'}
                </button>
              )}
            </div>
            {openMapDate === date && (
              <Suspense fallback={<div className="h-72 flex items-center justify-center"><Spinner /></div>}>
                <div className="mb-3">
                  <JourneyMap points={dayPoints(visits, record)} onSelectVisit={setSelectedVisitId} selectedId={selectedVisitId} />
                </div>
              </Suspense>
            )}
            <TravelDayChain visits={visits} attendanceRecord={record} fetchPhotoUrl={fetchPhotoUrl} onOpenPhoto={setViewerUrl} selectedVisitId={selectedVisitId} onSelectVisit={setSelectedVisitId} />
            <TravelExpenseList expenses={dayExpenses} fetchPhotoUrl={fetchPhotoUrl} onOpenPhoto={setViewerUrl} onDelete={deleteExpense} />
          </Card>
        )
      })}

      {settlements.length > 0 && (
        <Card>
          <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2">Past Payouts</p>
          <div className="space-y-2">
            {settlements.map(s => (
              <div key={s.id} className="flex items-center justify-between py-2 border-b border-white/5 text-xs">
                <div>
                  <p className="text-white/70">{s.periodStart} – {s.periodEnd}</p>
                  <p className="text-white/30">{s.totalKm.toFixed(1)} km · ₹{s.ratePerKm}/km{s.expenseAmount > 0 ? ` + ₹${s.expenseAmount.toFixed(2)} expenses` : ''}</p>
                </div>
                <p className="text-emerald-400 font-medium">₹{s.amount.toFixed(2)}</p>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
