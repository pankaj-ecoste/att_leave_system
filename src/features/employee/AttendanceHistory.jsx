import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { calcRawHrs, calcStatus, todayIST } from '../../lib/datetime'
import { fmtHrs } from '../../lib/format'

export function AttendanceHistory({ currentUser, attendance, stdHours, regularizations, submitRegularization }) {
  const [tab, setTab] = useState('attendance')
  const [showRegModal, setShowRegModal] = useState(false)
  const [form, setForm] = useState({ date: '', inTime: '', outTime: '', reason: '' })
  const [errs, setErrs] = useState({})

  const empId = currentUser.id
  const myRecs = Object.entries(attendance)
    .filter(([k]) => k.startsWith(`${empId}_`))
    .map(([k, v]) => ({ date: k.slice(String(empId).length + 1), rec: v }))
    .filter(({ date }) => date && /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 90)

  async function submit() {
    const nextErrs = {}
    if (!form.date) nextErrs.date = 'Date is required'
    if (!form.inTime && !form.outTime) nextErrs.inTime = 'At least one time is required'
    if (!form.reason.trim()) nextErrs.reason = 'Reason is mandatory'
    setErrs(nextErrs)
    if (Object.keys(nextErrs).length) return
    try {
      await submitRegularization(currentUser, form)
      setShowRegModal(false)
      setForm({ date: '', inTime: '', outTime: '', reason: '' })
      setErrs({})
    } catch (err) {
      setErrs({ submit: err.message })
    }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h2 className="text-white font-semibold">Attendance History</h2>
        <div className="flex gap-2">
          <button onClick={() => setTab('attendance')} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${tab === 'attendance' ? 'bg-indigo-600/30 border-indigo-500/40 text-white' : 'bg-white/5 border-white/10 text-white/50'}`}>Attendance</button>
          <button onClick={() => setTab('regularization')} className={`text-xs px-3 py-1.5 rounded-lg border transition-all ${tab === 'regularization' ? 'bg-indigo-600/30 border-indigo-500/40 text-white' : 'bg-white/5 border-white/10 text-white/50'}`}>Regularization</button>
        </div>
      </div>

      {tab === 'attendance' && (
        myRecs.length === 0 ? (
          <div className="text-center py-10">
            <p className="text-white/30 text-sm">No attendance records found.</p>
            <p className="text-white/20 text-xs mt-1">Records appear here after your first punch-in.</p>
          </div>
        ) : (
          <div className="space-y-1.5 max-h-[65vh] overflow-y-auto pr-1">
            {myRecs.map(({ date, rec }) => {
              const raw = calcRawHrs(rec.inTime, rec.outTime)
              const st = rec.status || calcStatus(rec, stdHours, rec.dayType)
              return (
                <div key={date} className="flex items-center gap-3 p-3 rounded-xl border bg-white/5 border-white/10">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{date}</p>
                    <p className="text-white/40 text-xs font-mono mt-0.5">
                      {rec.inTime || '--:--'} — {rec.outTime || '--:--'}
                      {rec.leaveType && <span className="ml-2 text-amber-400/70">{rec.leaveType}</span>}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge status={st} />
                    {raw > 0 && <p className="text-white/30 text-xs mt-0.5">{fmtHrs(raw)}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'regularization' && (
        <>
          <Button className="text-xs mb-4 w-full" onClick={() => { setShowRegModal(true); setForm({ date: '', inTime: '', outTime: '', reason: '' }); setErrs({}) }}>
            + Request Attendance Correction
          </Button>
          {regularizations.length === 0 ? (
            <p className="text-white/30 text-sm text-center py-6">No regularization requests yet</p>
          ) : (
            <div className="space-y-2">
              {regularizations.map(r => (
                <div key={r.id} className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-white text-sm font-medium">{r.date}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${r.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-300' : r.status === 'Rejected' ? 'bg-red-500/20 text-red-300' : 'bg-yellow-500/20 text-yellow-300'}`}>{r.status}</span>
                  </div>
                  <p className="text-white/40 text-xs font-mono">{r.requestedIn || '--:--'} — {r.requestedOut || '--:--'}</p>
                  <p className="text-white/30 text-xs mt-1 italic">{r.reason}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={showRegModal} onClose={() => setShowRegModal(false)} title="Request Attendance Correction">
        <p className="text-white/40 text-xs mb-4">Submit if you missed a punch or had an incorrect time recorded.</p>
        <Label>Date <span className="text-red-400">*</span></Label>
        <Input type="date" className="mb-3" value={form.date} max={todayIST()} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} />
        {errs.date && <p className="text-red-400 text-xs mb-2">{errs.date}</p>}
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <Label>Actual In Time</Label>
            <Input type="time" value={form.inTime} onChange={e => setForm(p => ({ ...p, inTime: e.target.value }))} />
          </div>
          <div>
            <Label>Actual Out Time</Label>
            <Input type="time" value={form.outTime} onChange={e => setForm(p => ({ ...p, outTime: e.target.value }))} />
          </div>
        </div>
        {errs.inTime && <p className="text-red-400 text-xs mb-2">{errs.inTime}</p>}
        <Label>Reason <span className="text-red-400">*</span></Label>
        <textarea rows={3} className={`w-full bg-white/5 border rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/10 transition-all placeholder-white/20 resize-none mb-1 ${errs.reason ? 'border-red-500' : 'border-white/15'}`} value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} placeholder="Explain why regularization is needed..." />
        {errs.reason && <p className="text-red-400 text-xs mb-2">{errs.reason}</p>}
        {errs.submit && <p className="text-red-400 text-xs mb-2">{errs.submit}</p>}
        <div className="flex gap-2 mt-3">
          <Button className="flex-1" onClick={submit}>Submit Request</Button>
          <Button variant="secondary" onClick={() => setShowRegModal(false)}>Cancel</Button>
        </div>
      </Modal>
    </Card>
  )
}
