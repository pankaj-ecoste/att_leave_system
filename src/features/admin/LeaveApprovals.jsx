import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'

export function LeaveApprovals({ employees, leaves, adminRegs, decideLeave, decideRegularization, onAudit }) {
  const [errMsg, setErrMsg] = useState('')

  async function handleDecideLeave(id, action) {
    const decision = action === 'approve' ? 'Approved' : 'Rejected'
    try {
      const updated = await decideLeave(id, decision)
      onAudit?.(action === 'approve' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED', `${updated.empName} ${updated.leaveType} ${action}d`, 'admin')
      setErrMsg('')
    } catch (err) { setErrMsg(err.message) }
  }
  async function handleDecideReg(id, status) {
    try {
      await decideRegularization(id, status)
      onAudit?.('REGULARIZATION', `Regularization ${status} for request ${id}`, 'admin')
      setErrMsg('')
    } catch (err) { setErrMsg(err.message) }
  }

  const pendingRegs = adminRegs.filter(r => r.status === 'Pending')
  // P4-2/P4-4 — two-stage approval: a request is only actionable by admin once the
  // manager has approved it, or immediately if the employee has no manager at all
  // (routes straight to admin). Everything else is still waiting on the manager and
  // shown separately, read-only — matches the guard admin_decide_leave enforces
  // server-side, so there's no button here that would just bounce off that check.
  const readyForAdmin = leaves.filter(l => l.status === 'Manager Approved' || (l.status === 'Pending' && !l.hasManager))
  const awaitingManager = leaves.filter(l => l.status === 'Pending' && l.hasManager)

  return (
    <>
      {errMsg && <Card><p className="text-red-400 text-sm">{errMsg}</p></Card>}
      <Card>
        <h3 className="text-white font-semibold mb-3">
          Attendance Correction Requests
          {pendingRegs.length > 0 && <span className="ml-2 bg-violet-500/20 text-violet-300 text-xs px-2 py-0.5 rounded-full border border-violet-500/30">{pendingRegs.length} pending</span>}
        </h3>
        {adminRegs.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">No correction requests yet</p>
        ) : adminRegs.map(r => {
          const emp = employees.find(e => e.id === r.empId) || {}
          return (
            <div key={r.id} className="bg-white/5 rounded-xl p-4 mb-2 border border-white/10">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-white font-medium">{r.empName || emp.name} <span className="text-white/30 text-xs">({r.empNum || emp.empNum})</span></p>
                  <p className="text-white/50 text-sm">{r.date} · <span className="font-mono">{r.requestedIn || '--:--'} — {r.requestedOut || '--:--'}</span></p>
                  <p className="text-white/30 text-xs mt-1 italic">{r.reason}</p>
                  <p className="text-white/20 text-xs mt-1">Manager: {emp.manager || '—'}</p>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  {r.status === 'Pending' ? (
                    <>
                      <Button className="text-xs py-1 px-3" onClick={() => handleDecideReg(r.id, 'Approved')}>Approve</Button>
                      <Button variant="danger" onClick={() => handleDecideReg(r.id, 'Rejected')}>Reject</Button>
                    </>
                  ) : (
                    <span className={`text-xs px-2 py-1 rounded-full font-semibold ${r.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>{r.status}</span>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </Card>

      <Card>
        <h3 className="text-white font-semibold mb-3">Ready for Your Decision <span className="ml-2 bg-orange-500/20 text-orange-300 text-xs px-2 py-0.5 rounded-full border border-orange-500/30">{readyForAdmin.length}</span></h3>
        {readyForAdmin.length === 0 ? (
          <div className="text-center py-8"><p className="text-white/30">All caught up — nothing waiting on you</p></div>
        ) : readyForAdmin.map(l => (
          <div key={l.id} className="bg-white/5 rounded-xl p-4 mb-2 border border-white/10 hover:border-white/20 transition-all">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-white font-semibold">{l.empName}</span>
                  <span className="text-white/30">·</span>
                  <span className="text-indigo-300 text-sm">{l.leaveType}</span>
                  {l.dayPart !== 'full' && <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 border border-orange-500/30">{l.dayPart === 'first_half' ? 'First Half' : 'Second Half'}</span>}
                </div>
                <p className="text-white/40 text-xs">{l.date} · {l.company?.split(' ')[0]}</p>
                <p className="text-white/60 text-xs mt-1 italic">"{l.reason}"</p>
                {/* P4-4 — the manager's decision, visible before admin acts on top of it. */}
                {l.hasManager ? (
                  <p className="text-emerald-400/70 text-xs mt-1.5">✓ Approved by {l.managerName || 'manager'}{l.managerDecidedAt ? ` on ${new Date(l.managerDecidedAt).toLocaleDateString()}` : ''}</p>
                ) : (
                  <p className="text-amber-400/70 text-xs mt-1.5">No manager on file — routed directly to you</p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30" onClick={() => handleDecideLeave(l.id, 'approve')}>Approve</Button>
                <Button variant="danger" onClick={() => handleDecideLeave(l.id, 'reject')}>Reject</Button>
              </div>
            </div>
          </div>
        ))}
      </Card>

      {awaitingManager.length > 0 && (
        <Card>
          <h3 className="text-white font-semibold mb-3">Awaiting Manager <span className="ml-2 bg-white/10 text-white/40 text-xs px-2 py-0.5 rounded-full border border-white/20">{awaitingManager.length}</span></h3>
          <p className="text-white/30 text-xs mb-3">Not yet actionable — the employee's manager hasn't decided these yet.</p>
          {awaitingManager.map(l => (
            <div key={l.id} className="flex items-center justify-between py-2 border-b border-white/5">
              <div>
                <p className="text-white/60 text-sm">{l.empName} · {l.leaveType}{l.dayPart !== 'full' && ` (${l.dayPart === 'first_half' ? 'First Half' : 'Second Half'})`}</p>
                <p className="text-white/30 text-xs">{l.date}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 border border-white/10">Pending manager</span>
            </div>
          ))}
        </Card>
      )}

      <Card>
        <h3 className="text-white font-semibold mb-3">All Applications</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-white/70 min-w-[600px]">
            <thead><tr className="border-b border-white/10">{['Employee', 'Company', 'Type', 'Date', 'Reason', 'Status'].map(h => <th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}</tr></thead>
            <tbody>{[...leaves].sort((a, b) => b.date.localeCompare(a.date)).map(l => (
              <tr key={l.id} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                <td className="py-2 pr-4 text-white/80">{l.empName}</td>
                <td className="py-2 pr-4 text-white/30">{l.company?.split(' ')[0]}</td>
                <td className="py-2 pr-4">{l.leaveType}{l.dayPart !== 'full' && <span className="text-white/30"> ({l.dayPart === 'first_half' ? '1st Half' : '2nd Half'})</span>}</td>
                <td className="py-2 pr-4 font-mono">{l.date}</td>
                <td className="py-2 pr-4 max-w-[150px] truncate text-white/40">{l.reason}</td>
                <td className="py-2"><span className={`px-2 py-1 rounded-full text-xs border ${l.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : l.status === 'Rejected' ? 'bg-red-500/20 text-red-300 border-red-500/30' : l.status === 'Manager Approved' ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'}`}>{l.status}</span></td>
              </tr>
            ))}</tbody>
          </table>
          {leaves.length === 0 && <p className="text-white/30 text-center py-8">No leave applications</p>}
        </div>
      </Card>
    </>
  )
}
