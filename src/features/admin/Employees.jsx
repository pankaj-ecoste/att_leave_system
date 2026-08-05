import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label, Select } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'
import { COMPANIES, SHIFTS, LEAVE_TYPES, EMPLOYMENT_STATUSES, getShiftInfo } from '../../lib/constants'
import { todayIST } from '../../lib/datetime'

const PROBATION_ALERT_WINDOW_DAYS = 14

// Sub Dept and Cost Center dropped from the form per your request — the columns and
// mapper still carry them through untouched for anyone imported with values already,
// this just stops asking for them going forward.
const FORM_FIELDS = [
  ['name', 'Full Name*'], ['pin', 'PIN* (leave blank on edit to keep current)'], ['empNum', 'Emp Number'],
  ['jobTitle', 'Job Title'], ['dept', 'Department'], ['bu', 'Business Unit'],
  ['locationInfo', 'Location'], ['email', 'Email'], ['phone', 'Phone'],
  ['joiningDate', 'Joining Date', 'date'],
]
const EMPTY_FORM = { name: '', pin: '', company: COMPANIES[0], empNum: '', jobTitle: '', bu: '', dept: '', locationInfo: '', manager: '', managerEmpId: '', email: '', phone: '', joiningDate: '', shiftType: 'none', employmentStatus: 'Probation' }

export function Employees({ employees, leaveBalances, createEmployee, updateEmployee, toggleEmployeeStatus, deleteEmployee, setEmploymentStatus, upsertLeaveBalance, bulkUpsertLeaveBalances, onAudit }) {
  const [filter, setFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(null)
  const [balEditor, setBalEditor] = useState(null)

  const q = search.trim().toLowerCase()
  const filtered = employees.filter(e =>
    (!filter || e.company === filter) &&
    (!statusFilter || e.employmentStatus === statusFilter) &&
    (!q || e.name.toLowerCase().includes(q) || (e.empNum || '').toLowerCase().includes(q))
  )

  // Phase 2 — "admin alert when probation is nearing its end" (plan.md).
  const today = todayIST()
  const alertCutoff = new Date(today)
  alertCutoff.setDate(alertCutoff.getDate() + PROBATION_ALERT_WINDOW_DAYS)
  const alertCutoffStr = alertCutoff.toISOString().slice(0, 10)
  const probationEnding = employees.filter(e =>
    e.employmentStatus === 'Probation' && e.probationEndDate && e.probationEndDate <= alertCutoffStr
  )

  async function save() {
    if (!form.name || !form.company) return
    if (!form.id && !form.pin) { alert('PIN is required for a new employee.'); return }
    try {
      if (form.id) {
        const before = employees.find(e => e.id === form.id)
        const updated = await updateEmployee(form.id, form)
        onAudit?.('EMP_UPDATE', `Updated ${updated.name}`, 'admin')
        // employment_status is admin-only and has its own function (admin_set_employment_status)
        // — admin_update_employee deliberately can't change it, so it's a separate call.
        if (form.employmentStatus && form.employmentStatus !== before?.employmentStatus) {
          await setEmploymentStatus(form.id, form.employmentStatus)
          onAudit?.('EMPLOYMENT_STATUS', `${updated.name} -> ${form.employmentStatus}`, 'admin')
        }
      } else {
        const created = await createEmployee(form)
        onAudit?.('EMP_CREATE', `Created ${created.name}`, 'admin')
        // New employees always start on Probation (server default) — only call this if
        // the admin explicitly picked something else at creation time.
        if (form.employmentStatus && form.employmentStatus !== 'Probation') {
          await setEmploymentStatus(created.id, form.employmentStatus)
          onAudit?.('EMPLOYMENT_STATUS', `${created.name} -> ${form.employmentStatus}`, 'admin')
        }
      }
      setForm(null)
    } catch (err) { alert(err.message) }
  }

  async function confirmEmployee(e) {
    try {
      await setEmploymentStatus(e.id, 'Confirmed')
      onAudit?.('EMPLOYMENT_STATUS', `${e.name} -> Confirmed`, 'admin')
    } catch (err) { alert(err.message) }
  }

  async function toggle(id) {
    try {
      const updated = await toggleEmployeeStatus(id)
      onAudit?.('EMP_STATUS', `Toggled ${updated.name}`, 'admin')
    } catch (err) { alert(err.message) }
  }

  async function del(id) {
    if (!window.confirm('Delete employee?')) return
    try {
      await deleteEmployee(id)
      onAudit?.('EMP_DELETE', `Deleted ${id}`, 'admin')
    } catch (err) { alert(err.message) }
  }

  function openBalanceEditor(e) {
    const bal = leaveBalances[e.id] || {}
    const editorBal = {}
    LEAVE_TYPES.filter(lt => !lt.label.includes('Partial')).forEach(lt => {
      editorBal[lt.label] = bal[lt.label] ? { ...bal[lt.label] } : { accrued: 0, consumed: 0, balance: 0, quota: 0, unit: 'Days' }
    })
    setBalEditor({ empId: e.id, empName: e.name, balances: editorBal })
  }

  async function saveBalances() {
    try {
      const records = Object.entries(balEditor.balances).map(([lt, v]) => ({
        empId: balEditor.empId, leaveType: lt, accrued: v.accrued || 0, consumed: v.consumed || 0, balance: v.balance || 0, quota: v.quota || 0, unit: v.unit || 'Days',
      }))
      await bulkUpsertLeaveBalances(records)
      onAudit?.('LEAVE_BAL_UPDATE', `Updated leave balances for ${balEditor.empName}`, 'admin')
      setBalEditor(null)
    } catch (err) { alert(`Error: ${err.message}`) }
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-white font-semibold">Employees <span className="text-white/30 text-sm font-normal ml-1">({filtered.length})</span></h3>
        <div className="flex gap-2 flex-wrap">
          <Input className="!w-56 py-2 text-sm" placeholder="Search by name or emp #..." value={search} onChange={e => setSearch(e.target.value)} />
          <Select className="w-auto py-2" value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All Companies</option>{COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select className="w-auto py-2" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>{EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <Button className="text-xs" onClick={() => setForm({ ...EMPTY_FORM })}>+ Add Employee</Button>
        </div>
      </div>

      {probationEnding.length > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 mb-4">
          <p className="text-amber-300 text-xs font-semibold mb-2">
            {probationEnding.length} employee{probationEnding.length !== 1 ? 's' : ''} on probation ending within {PROBATION_ALERT_WINDOW_DAYS} days
          </p>
          <div className="space-y-1">
            {probationEnding.map(e => (
              <div key={e.id} className="flex items-center justify-between text-xs">
                <span className="text-white/70">{e.name} — ends {e.probationEndDate}{e.probationEndDate < today ? ' (overdue)' : ''}</span>
                <Button variant="secondary" className="text-xs py-0.5 px-2" onClick={() => confirmEmployee(e)}>Confirm now</Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {form && (
        <div className="bg-indigo-500/5 border border-indigo-500/20 rounded-2xl p-4 mb-4">
          <h4 className="text-white font-medium mb-3">{form.id ? 'Edit' : 'New'} Employee</h4>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {FORM_FIELDS.map(([k, l, t]) => (
              <div key={k}>
                <Label>{l}</Label>
                <Input type={t || 'text'} value={form[k] || ''} onChange={e => setForm(p => ({ ...p, [k]: e.target.value }))} />
              </div>
            ))}
            <div>
              <Label>Company*</Label>
              <Select value={form.company} onChange={e => setForm(p => ({ ...p, company: e.target.value, managerEmpId: '', manager: '' }))}>
                {COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
              </Select>
            </div>
            <div>
              <Label>Reporting Manager</Label>
              <Select value={form.managerEmpId || ''} onChange={e => { const mgr = employees.find(x => x.id === e.target.value); setForm(p => ({ ...p, managerEmpId: e.target.value, manager: mgr ? mgr.name : '' })) }}>
                <option value="">— No Manager —</option>
                {employees.filter(e => e.active && e.company === form.company && e.id !== form.id).sort((a, b) => a.name.localeCompare(b.name)).map(e => <option key={e.id} value={e.id}>{e.name}{e.jobTitle ? ` (${e.jobTitle})` : ''}</option>)}
              </Select>
            </div>
            <div>
              <Label>Shift Type</Label>
              <Select value={form.shiftType || 'none'} onChange={e => setForm(p => ({ ...p, shiftType: e.target.value }))}>
                {SHIFTS.map(s => <option key={s.id} value={s.id}>{s.label}{s.start ? ` (${s.start}–${s.end})` : ''}</option>)}
              </Select>
            </div>
            <div>
              <Label>Employment Status (admin only)</Label>
              <Select value={form.employmentStatus || 'Probation'} onChange={e => setForm(p => ({ ...p, employmentStatus: e.target.value }))}>
                {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button className="text-xs" onClick={save}>Save Employee</Button>
            <Button variant="secondary" className="text-xs" onClick={() => setForm(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-10"><p className="text-white/30">No employees yet</p></div>
        ) : filtered.map(e => (
          <div key={e.id} className={`bg-white/5 rounded-xl p-3 border border-white/10 hover:border-white/20 transition-all flex items-center justify-between flex-wrap gap-2 ${!e.active ? 'opacity-40' : ''}`}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl ${e.active ? 'bg-gradient-to-br from-indigo-500/30 to-violet-500/30' : 'bg-white/5'} flex items-center justify-center font-bold text-white/60 text-sm`}>{e.name.charAt(0).toUpperCase()}</div>
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-white text-sm font-medium">{e.name}</p>
                  <span className={`text-xs px-1.5 py-0.5 rounded-full ${e.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>{e.active ? 'Active' : 'Inactive'}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/10 text-white/50">{e.employmentStatus}</span>
                  {(() => { const sh = getShiftInfo(null, e); return sh.id !== 'none' && <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: sh.color + '33', color: sh.color, border: `1px solid ${sh.color}55` }}>{sh.label}</span> })()}
                </div>
                <p className="text-white/30 text-xs">{e.empNum && `#${e.empNum} · `}{e.company?.split(' ')[0]} · {e.dept || '—'}</p>
              </div>
            </div>
            <div className="flex gap-1 flex-wrap">
              <Button variant="secondary" className="text-xs" onClick={() => setForm({ ...e, pin: '' })}>Edit</Button>
              <Button variant="secondary" className="text-xs" onClick={() => openBalanceEditor(e)}>Leave Bal</Button>
              <Button variant="secondary" className={`text-xs ${e.active ? 'bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-300 border-yellow-500/30' : 'bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border-emerald-500/30'}`} onClick={() => toggle(e.id)}>{e.active ? 'Deactivate' : 'Restore'}</Button>
              <Button variant="danger" onClick={() => del(e.id)}>Delete</Button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={!!balEditor} onClose={() => setBalEditor(null)} title="Leave Balances" wide>
        {balEditor && (
          <>
            <p className="text-white/40 text-xs mb-4">{balEditor.empName}</p>
            <div className="space-y-3 mb-4">
              {Object.entries(balEditor.balances).map(([lt, v]) => (
                <div key={lt} className="bg-white/5 border border-white/10 rounded-xl p-3">
                  <p className="text-white text-sm font-medium mb-2">{lt}</p>
                  <div className="grid grid-cols-4 gap-2">
                    {[['Quota', 'quota'], ['Accrued', 'accrued'], ['Consumed', 'consumed'], ['Balance', 'balance']].map(([label, field]) => (
                      <div key={field}>
                        <Label>{label}</Label>
                        <Input type="number" min="0" className="text-xs" value={v[field] || 0} onChange={e => {
                          const val = parseFloat(e.target.value) || 0
                          setBalEditor(prev => {
                            const updated = { ...prev, balances: { ...prev.balances } }
                            updated.balances[lt] = { ...updated.balances[lt], [field]: val }
                            if (field === 'quota' || field === 'consumed') {
                              updated.balances[lt].balance = Math.max(0, updated.balances[lt].quota - updated.balances[lt].consumed)
                              updated.balances[lt].accrued = updated.balances[lt].quota
                            }
                            return updated
                          })
                        }} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <Button className="w-full" onClick={saveBalances}>Save Leave Balances</Button>
          </>
        )}
      </Modal>
    </Card>
  )
}
