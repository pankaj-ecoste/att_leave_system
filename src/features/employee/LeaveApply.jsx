import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { getLocation } from '../../hooks/useGeolocation'
import { uploadLeaveDocument } from '../../api/documents'
import { todayIST, daysFromTodayIST } from '../../lib/datetime'
import { HALF_DAY_ELIGIBLE_TYPES, DAY_PARTS, findLeaveType } from '../../lib/constants'
import { buildLeaveNotifyMailto } from '../../lib/notify'

const EARNED_LEAVE_ADVANCE_DAYS = 7

const PARTIAL_TYPES = [{ label: 'Partial Leave - 1 Hour', max: 2 }, { label: 'Partial Leave - 2 Hours', max: 1 }]

function monthlyPartialCount(leaves, empId, label) {
  const m = new Date().getMonth() + 1
  const y = new Date().getFullYear()
  return leaves.filter(l => l.empId === empId && l.leaveType === label && l.status !== 'Rejected' &&
    new Date(l.date).getMonth() + 1 === m && new Date(l.date).getFullYear() === y).length
}

export function LeaveApply({ currentUser, leaves, balances, availableLeaveTypes, applyLeave, onOdApplied, directory, adminEmail }) {
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState({ type: '', date: todayIST(), dayPart: 'full', reason: '', location: null })
  const [errs, setErrs] = useState({})
  const [locationStatus, setLocationStatus] = useState('')
  const [file, setFile] = useState(null)
  const [uploading, setUploading] = useState(false)
  // Set right after a successful submit, holding the just-applied leave's details so the
  // notify-by-email step (P4-6, revised) can build its mailto: link; null the rest of
  // the time, which is what keeps the modal showing the form instead.
  const [submitted, setSubmitted] = useState(null)

  const myLeaves = leaves.filter(l => l.empId === currentUser.id)
  const avLT = availableLeaveTypes(currentUser.company)
  // P4-5 — manager name + email visible to the employee. 'Manager Approved' only ever
  // appears on legacy requests from before manager/admin got equal decision authority
  // (plan.md §12 V3 decision 4); still counted as pending here since nothing new lands
  // in that state anymore.
  const manager = currentUser.managerEmpId ? (directory || []).find(e => e.id === currentUser.managerEmpId) : null
  const pendingCount = myLeaves.filter(l => l.status === 'Pending' || l.status === 'Manager Approved').length

  function openFor(label) {
    // Earned Leave needs 7 days' notice — default straight to the earliest allowed
    // date instead of today, so the employee isn't set up to fail the server check.
    const date = label === 'Earned Leave' ? daysFromTodayIST(EARNED_LEAVE_ADVANCE_DAYS) : todayIST()
    setForm({ type: label, date, dayPart: 'full', reason: '', location: null })
    setErrs({})
    setLocationStatus('')
    setFile(null)
    setSubmitted(null)
    setModalOpen(true)
  }

  function closeModal() {
    setModalOpen(false)
    setForm({ type: '', date: todayIST(), dayPart: 'full', reason: '', location: null })
    setErrs({})
    setLocationStatus('')
    setFile(null)
    setSubmitted(null)
  }

  async function submit() {
    const nextErrs = {}
    if (!form.type) nextErrs.type = 'Please select a leave type'
    if (!form.reason.trim()) nextErrs.reason = 'Reason is mandatory'
    const needsLocation = form.type === 'Work From Home' || form.type === 'On Duty'
    if (needsLocation && !form.location) nextErrs.location = `Location is required for ${form.type}`
    if (form.type === 'Sick Leave' && !file) nextErrs.file = 'A prescription or medical certificate is required for Sick Leave'
    setErrs(nextErrs)
    if (Object.keys(nextErrs).length) return

    let documentPath = null
    try {
      if (file) {
        setUploading(true)
        documentPath = await uploadLeaveDocument(file)
      }
    } catch (err) {
      setUploading(false)
      setErrs({ file: err.message || 'Could not upload the file — please try again' })
      return
    }
    setUploading(false)

    try {
      await applyLeave(currentUser, { ...form, documentPath })
    } catch (err) {
      // Includes the server's own balance check (P4-9 — "Insufficient X balance"),
      // surfaced plainly rather than as an unhandled error (§8C).
      setErrs({ submit: err.message || 'Could not submit application — please try again' })
      return
    }
    if (form.type === 'On Duty' && form.date === todayIST()) onOdApplied?.()
    // Stay open one more step — offer to notify the manager + admin by email — instead
    // of closing immediately (P4-6, revised: nudge, not silent).
    setSubmitted({ type: form.type, date: form.date, dayPart: form.dayPart, reason: form.reason })
  }

  function captureLocation() {
    setLocationStatus('Capturing location...')
    getLocation((loc) => {
      if (loc) { setForm(p => ({ ...p, location: loc })); setLocationStatus('') }
      else setLocationStatus('Location access denied — please enable GPS and try again')
    })
  }

  return (
    <>
      {(manager || pendingCount > 0) && (
        <Card>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Your Manager</p>
              {manager ? (
                <p className="text-white text-sm">{manager.name}{manager.email && <span className="text-white/30"> · {manager.email}</span>}</p>
              ) : (
                <p className="text-white/40 text-sm">None on file — your requests go straight to admin</p>
              )}
            </div>
            {pendingCount > 0 && (
              <span className="text-xs px-2.5 py-1 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">{pendingCount} pending</span>
            )}
          </div>
        </Card>
      )}
      <Card>
        <h2 className="text-white font-semibold mb-4">Apply For Leave</h2>
        <div className="grid grid-cols-2 gap-2 mb-5">
          {avLT.map(lt => (
            <button key={lt.label} onClick={() => openFor(lt.label)} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 hover:bg-indigo-500/10 border border-white/10 hover:border-indigo-500/40 text-left transition-all active:scale-95">
              <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/30 to-violet-500/30 flex items-center justify-center text-xs font-bold text-white shrink-0">{lt.icon}</span>
              <span className="text-white/70 text-xs">Apply for {lt.label}</span>
            </button>
          ))}
        </div>
        {Object.keys(balances).length > 0 && (
          <>
            <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-3">Leave Balances</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {/* Just the balance you actually have right now — no "/quota". The annual
                  entitlement is already explained on the Leave Policy page, and quota
                  here would be one more number for every employee to reconcile for
                  themselves; the balance itself already reflects their real joining
                  date (pro-rated in the database, not computed on screen) and every
                  approval/monthly credit that's happened since. Compensatory Leave
                  always gets a tile here even before the employee has ever earned any
                  (no leave_balances row yet) — shown as 0, so the tile's presence isn't
                  the first time they learn it exists. */}
              {Object.entries({ 'Compensatory Leave': { balance: 0, consumed: 0 }, ...balances })
                .filter(([lt]) => !lt.includes('Partial')).map(([lt, v]) => (
                <div key={lt} className="bg-white/5 rounded-xl p-3 border border-white/10">
                  <p className="text-white/40 text-xs truncate">{lt}</p>
                  <p className="text-white font-bold text-lg mt-1">{v.balance}</p>
                  <p className="text-white/20 text-xs mt-1">{v.consumed} consumed</p>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="pt-3 border-t border-white/10">
          <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2">Partial Leave Tracker (This Month)</p>
          {PARTIAL_TYPES.map(({ label: lt, max }) => {
            const used = monthlyPartialCount(leaves, currentUser.id, lt)
            return (
              <div key={lt} className="flex items-center justify-between mb-2">
                <span className="text-white/50 text-xs">{lt}</span>
                <div className="flex items-center gap-2">
                  {Array.from({ length: max }).map((_, i) => <div key={i} className={`w-3 h-3 rounded-full ${i < used ? 'bg-red-400' : 'bg-white/10 border border-white/20'}`} />)}
                  <span className={`text-xs ${used >= max ? 'text-red-400' : 'text-emerald-400'}`}>{max - used} left</span>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      <Card>
        <h2 className="text-white font-semibold mb-3">Recent Applications</h2>
        {myLeaves.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">No applications yet</p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {myLeaves.slice(0, 10).map(l => (
              <div key={l.id} className="bg-white/5 rounded-xl p-3 flex items-center justify-between border border-white/5">
                <div>
                  <p className="text-white text-sm font-medium">{l.leaveType}{l.dayPart !== 'full' && <span className="text-white/40 font-normal"> · {l.dayPart === 'first_half' ? 'First Half' : 'Second Half'}</span>}</p>
                  <p className="text-white/30 text-xs">{l.date} · {l.reason?.slice(0, 35)}{l.reason?.length > 35 ? '...' : ''}</p>
                </div>
                <span className={`text-xs px-2 py-1 rounded-full border ${l.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : l.status === 'Rejected' ? 'bg-red-500/20 text-red-300 border-red-500/30' : l.status === 'Manager Approved' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'}`}>{l.status}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Modal open={modalOpen} onClose={closeModal} title={submitted ? 'Application Submitted' : 'Apply Leave / Status'}>
        {submitted ? (
          <>
            <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-emerald-600/15 border border-emerald-500/30">
              <span className="w-8 h-8 rounded-lg bg-emerald-500/30 flex items-center justify-center text-emerald-300 shrink-0">✓</span>
              <div>
                <p className="text-white text-sm font-medium">{submitted.type} application submitted</p>
                <p className="text-white/40 text-xs">{submitted.date} · now Pending with {manager ? 'your manager' : 'admin'}</p>
              </div>
            </div>
            <p className="text-white/40 text-xs mb-3">
              {manager || adminEmail
                ? 'Give your manager and admin a heads-up by email — this opens your own mail app with the details already filled in.'
                : 'No manager or admin email is on file yet, so there\'s nothing to notify — they\'ll still see this in their approval queue.'}
            </p>
            <div className="flex gap-2 mt-3">
              {(manager?.email || adminEmail) && (
                <a
                  href={buildLeaveNotifyMailto({
                    employeeName: currentUser.name, leaveType: submitted.type, date: submitted.date,
                    dayPart: submitted.dayPart, reason: submitted.reason, managerEmail: manager?.email, adminEmail,
                  })}
                  className="flex-1 text-center rounded-xl px-4 py-2.5 text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-all active:scale-95"
                >
                  Notify via Email
                </a>
              )}
              <Button variant="secondary" onClick={closeModal}>Done</Button>
            </div>
          </>
        ) : (
        <>
        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-indigo-600/20 border border-indigo-500/30">
          <span className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/40 to-violet-500/40 flex items-center justify-center text-xs font-bold text-white shrink-0">{findLeaveType(form.type)?.icon}</span>
          <span className="text-white text-sm font-medium">{form.type}</span>
        </div>
        {errs.type && <p className="text-red-400 text-xs mb-2">{errs.type}</p>}
        <Label>Date</Label>
        <Input
          type="date" className="mb-3" value={form.date}
          min={form.type === 'Earned Leave' ? daysFromTodayIST(EARNED_LEAVE_ADVANCE_DAYS) : undefined}
          onChange={e => setForm(p => ({ ...p, date: e.target.value }))}
        />
        {form.type === 'Earned Leave' && (
          <p className="text-white/30 text-xs mb-3 -mt-2">Earned Leave can only be availed at least {EARNED_LEAVE_ADVANCE_DAYS} days in advance</p>
        )}
        {form.type === 'Sick Leave' && (
          <div className="mb-3 p-3 rounded-xl border bg-rose-500/10 border-rose-500/20">
            <p className="text-rose-300 text-xs font-medium mb-2">Prescription / medical certificate is mandatory for Sick Leave</p>
            <input
              type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={e => setFile(e.target.files?.[0] || null)}
              className="block w-full text-xs text-white/60 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-medium file:bg-rose-500/20 file:text-rose-300 hover:file:bg-rose-500/30"
            />
            {file && <p className="text-emerald-400 text-xs mt-2">Selected: {file.name}</p>}
            {errs.file && <p className="text-red-400 text-xs mt-1">{errs.file}</p>}
          </div>
        )}
        {HALF_DAY_ELIGIBLE_TYPES.includes(form.type) && (
          <>
            <Label>Duration</Label>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {DAY_PARTS.map(dp => (
                <button key={dp.id} onClick={() => setForm(p => ({ ...p, dayPart: dp.id }))} className={`p-2 rounded-xl text-xs border transition-all ${form.dayPart === dp.id ? 'bg-indigo-600/30 border-indigo-500/50 text-white' : 'bg-white/5 border-white/10 text-white/60 hover:bg-white/10'}`}>
                  {dp.label}
                </button>
              ))}
            </div>
            {form.dayPart !== 'full' && <p className="text-white/30 text-xs mb-2 -mt-2">Deducts 0.5 day from your {form.type} balance</p>}
          </>
        )}
        <Label>Reason <span className="text-red-400">*</span></Label>
        <textarea rows={3} className={`w-full bg-white/5 border rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/10 transition-all placeholder-white/20 resize-none mb-1 ${errs.reason ? 'border-red-500' : 'border-white/15'}`} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="Enter reason for leave..." />
        {errs.reason && <p className="text-red-400 text-xs mb-2">{errs.reason}</p>}
        {(form.type === 'Work From Home' || form.type === 'On Duty') && (
          <div className={`mb-2 p-3 rounded-xl border ${form.type === 'Work From Home' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-purple-500/10 border-purple-500/20'}`}>
            <p className={`text-xs font-medium mb-2 ${form.type === 'Work From Home' ? 'text-amber-300' : 'text-purple-300'}`}>Location is mandatory for {form.type}</p>
            {form.location
              ? <p className="text-emerald-400 text-xs">Located: {form.location}</p>
              : <Button variant="secondary" className="w-full text-xs" onClick={captureLocation}>Capture My Location (Required)</Button>}
            {locationStatus && <p className="text-red-400 text-xs mt-1">{locationStatus}</p>}
          </div>
        )}
        {errs.location && <p className="text-red-400 text-xs mb-2">{errs.location}</p>}
        {errs.submit && <p className="text-red-400 text-xs mb-2">{errs.submit}</p>}
        <div className="flex gap-2 mt-3">
          <Button className="flex-1" disabled={uploading} onClick={submit}>{uploading ? 'Uploading...' : 'Submit Application'}</Button>
          <Button variant="secondary" onClick={closeModal}>Cancel</Button>
        </div>
        </>
        )}
      </Modal>
    </>
  )
}
