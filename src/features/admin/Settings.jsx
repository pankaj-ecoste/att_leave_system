import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label, Select } from '../../components/ui/Input'

const HOLIDAY_TYPES = ['Public', 'Optional', 'Restricted', 'Company']

const DEFAULT_BIRTHDAY_MESSAGE = 'Happy Birthday {name}! May Supreme Energy bless you. We are thankful to have you in our workspace. — By Ankur Hora and Team'

export function Settings({ employees, attendanceCount, leaves, auditLogs, holidays, stdHours, adminEmail, birthdayMessage, updateSettings, resetLeaveBalancesForNewFY, addHoliday, deleteHoliday, onAudit, lastImports }) {
  const [oldPin, setOldPin] = useState('')
  const [newPin, setNewPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [pinMsg, setPinMsg] = useState('')
  const [newStd, setNewStd] = useState('')
  const [stdMsg, setStdMsg] = useState('')
  const [newAdminEmail, setNewAdminEmail] = useState('')
  const [adminEmailMsg, setAdminEmailMsg] = useState('')
  const [newBirthdayMessage, setNewBirthdayMessage] = useState('')
  const [birthdayMsgMsg, setBirthdayMsgMsg] = useState('')
  const [showHolidayForm, setShowHolidayForm] = useState(false)
  const [holidayForm, setHolidayForm] = useState({ date: '', name: '', type: 'Public' })
  const [holidayMsg, setHolidayMsg] = useState('')
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  async function changePin() {
    if (!oldPin) { setPinMsg('Enter your current PIN'); setTimeout(() => setPinMsg(''), 3000); return }
    if (newPin.length < 4) { setPinMsg('New PIN must be at least 4 characters'); setTimeout(() => setPinMsg(''), 3000); return }
    if (newPin !== confirmPin) { setPinMsg("New PIN and confirmation don't match"); setTimeout(() => setPinMsg(''), 3000); return }
    try {
      await updateSettings(stdHours, newPin, oldPin)
      setOldPin(''); setNewPin(''); setConfirmPin(''); setPinMsg('PIN updated successfully')
      onAudit?.('SETTINGS', 'Admin PIN changed', 'admin')
    } catch (err) { setPinMsg(err.message?.includes('Current PIN is incorrect') ? 'Current PIN is incorrect' : `Error: ${err.message}`) }
    setTimeout(() => setPinMsg(''), 3000)
  }

  async function saveStdHours() {
    const v = Number(newStd)
    if (!v || v < 1) { setStdMsg('Enter a valid number of hours'); return }
    try {
      await updateSettings(v)
      setNewStd(''); setStdMsg('')
      onAudit?.('SETTINGS', `Std hours set to ${v}`, 'admin')
    } catch (err) { setStdMsg(err.message) }
  }

  async function saveAdminEmail() {
    const v = newAdminEmail.trim()
    if (!v || !v.includes('@')) { setAdminEmailMsg('Enter a valid email address'); return }
    try {
      await updateSettings(stdHours, null, null, v)
      setNewAdminEmail(''); setAdminEmailMsg('Saved')
      onAudit?.('SETTINGS', `Admin notification email set to ${v}`, 'admin')
    } catch (err) { setAdminEmailMsg(err.message) }
    setTimeout(() => setAdminEmailMsg(''), 3000)
  }

  async function saveBirthdayMessage() {
    const v = newBirthdayMessage.trim()
    if (!v) { setBirthdayMsgMsg('Enter a message'); return }
    try {
      await updateSettings(stdHours, null, null, null, v)
      setNewBirthdayMessage(''); setBirthdayMsgMsg('Saved')
      onAudit?.('SETTINGS', 'Birthday message updated', 'admin')
    } catch (err) { setBirthdayMsgMsg(err.message) }
    setTimeout(() => setBirthdayMsgMsg(''), 3000)
  }

  async function resetFY() {
    setResetMsg('')
    try {
      const count = await resetLeaveBalancesForNewFY()
      setResetMsg(`Done — ${count} employee-leave records created for the new financial year.`)
      onAudit?.('SETTINGS', 'Financial year leave balances reset', 'admin')
    } catch (err) { setResetMsg(`Error: ${err.message}`) }
    setResetConfirmOpen(false)
  }

  async function saveHoliday() {
    if (!holidayForm.date || !holidayForm.name.trim()) { setHolidayMsg('Date and name are required.'); return }
    try {
      const h = await addHoliday(holidayForm.date, holidayForm.name.trim(), holidayForm.type)
      setHolidayForm({ date: '', name: '', type: 'Public' })
      setShowHolidayForm(false)
      onAudit?.('SETTINGS', `Holiday added: ${h.name} on ${h.date}`, 'admin')
      setHolidayMsg('')
    } catch (err) { setHolidayMsg(`Error: ${err.message}`) }
  }

  async function removeHoliday(h) {
    try {
      await deleteHoliday(h.id)
      onAudit?.('SETTINGS', `Holiday removed: ${h.name}`, 'admin')
    } catch (err) { setHolidayMsg(`Error: ${err.message}`) }
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="text-white font-semibold mb-4">Change Admin PIN</h3>
        <Label>Current PIN</Label>
        <Input type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" className="mb-2 tracking-widest" value={oldPin} onChange={e => setOldPin(e.target.value)} placeholder="Enter current PIN" />
        <Label>New PIN (min 4 characters)</Label>
        <Input type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" className="mb-2 tracking-widest" value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="Enter new PIN" />
        <Label>Confirm New PIN</Label>
        <Input type="text" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false" className="mb-2 tracking-widest" value={confirmPin} onChange={e => setConfirmPin(e.target.value)} placeholder="Re-enter new PIN" />
        {pinMsg && <div className={`rounded-xl p-2.5 mb-3 text-sm ${pinMsg.startsWith('PIN updated') ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border border-red-500/30 text-red-300'}`}>{pinMsg}</div>}
        <Button className="text-xs" onClick={changePin}>Update PIN</Button>
        <p className="text-white/20 text-xs mt-3">Forgotten the PIN entirely? Ask your developer to run <code className="text-white/40">scripts/reset-admin-pin.mjs</code> against the database directly — it's the documented recovery path since there's a single shared admin PIN, not individual admin accounts.</p>
      </Card>

      <Card>
        <h3 className="text-white font-semibold mb-4">Standard Hours / Day</h3>
        <Input type="number" min="1" max="24" className="mb-1" value={newStd || stdHours} onChange={e => setNewStd(e.target.value)} />
        <p className="text-white/30 text-xs mb-3">Half-day threshold: below {((Number(newStd) || stdHours) / 2).toFixed(1)} hours</p>
        {stdMsg && <p className="text-red-400 text-xs mb-2">{stdMsg}</p>}
        <Button className="text-xs" onClick={saveStdHours}>Save</Button>
      </Card>

      <Card>
        <h3 className="text-white font-semibold mb-1">Admin Notification Email</h3>
        <p className="text-white/30 text-xs mb-3">Where an employee's "Notify via Email" button on the Apply Leave screen sends its message, alongside the manager. There's no DNS/mail-server setup here — the employee's own email client sends it (P4-6, revised).</p>
        <Input type="email" className="mb-1" value={newAdminEmail || adminEmail || ''} onChange={e => setNewAdminEmail(e.target.value)} placeholder="admin@ecoste.in" />
        {adminEmailMsg && <p className={`text-xs mb-2 ${adminEmailMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{adminEmailMsg}</p>}
        <Button className="text-xs" onClick={saveAdminEmail}>Save</Button>
      </Card>

      <Card>
        <h3 className="text-white font-semibold mb-1">Birthday Message</h3>
        <p className="text-white/30 text-xs mb-3">Shown as a banner on an employee's dashboard on their birthday. Use <code className="text-white/50">{'{name}'}</code> where their name should appear.</p>
        <textarea rows={3} className="w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/10 transition-all placeholder-white/20 resize-none mb-1" value={newBirthdayMessage || birthdayMessage || DEFAULT_BIRTHDAY_MESSAGE} onChange={e => setNewBirthdayMessage(e.target.value)} />
        {birthdayMsgMsg && <p className={`text-xs mb-2 ${birthdayMsgMsg === 'Saved' ? 'text-emerald-400' : 'text-red-400'}`}>{birthdayMsgMsg}</p>}
        <Button className="text-xs" onClick={saveBirthdayMessage}>Save</Button>
      </Card>

      <Card>
        <h3 className="text-white font-semibold mb-1">Financial Year Reset</h3>
        <p className="text-white/30 text-xs mb-4">Resets leave balances for the new financial year (1st April). Previous year data is preserved — only the interface resets. Each employee gets a fresh balance equal to their quota. This now also happens automatically every 1 April.</p>
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 mb-4">
          <p className="text-amber-300 text-xs font-medium">This action creates new FY records for all employees. Run only on 1st April.</p>
        </div>
        {resetMsg && <p className={`text-xs mb-3 ${resetMsg.startsWith('Error') ? 'text-red-400' : 'text-emerald-400'}`}>{resetMsg}</p>}
        {resetConfirmOpen ? (
          <div className="flex gap-2 items-center">
            <p className="text-white/60 text-xs flex-1">Create new financial year leave balances for all employees?</p>
            <Button variant="danger" className="text-xs" onClick={resetFY}>Confirm</Button>
            <Button variant="secondary" className="text-xs" onClick={() => setResetConfirmOpen(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="danger" className="text-xs" onClick={() => setResetConfirmOpen(true)}>Reset for New Financial Year</Button>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold">Holiday Calendar</h3>
          <Button className="text-xs" onClick={() => setShowHolidayForm(s => !s)}>{showHolidayForm ? 'Cancel' : '+ Add Holiday'}</Button>
        </div>
        {showHolidayForm && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-4 p-3 bg-white/5 rounded-xl border border-white/10">
            <div><Label>Date</Label><Input type="date" value={holidayForm.date} onChange={e => setHolidayForm(f => ({ ...f, date: e.target.value }))} /></div>
            <div><Label>Holiday Name</Label><Input type="text" value={holidayForm.name} onChange={e => setHolidayForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Diwali" /></div>
            <div><Label>Type</Label><Select value={holidayForm.type} onChange={e => setHolidayForm(f => ({ ...f, type: e.target.value }))}>{HOLIDAY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</Select></div>
            <div className="md:col-span-3 flex gap-2 items-center">
              <Button className="text-xs" onClick={saveHoliday}>Save Holiday</Button>
              {holidayMsg && <p className="text-red-400 text-xs">{holidayMsg}</p>}
            </div>
          </div>
        )}
        {holidays.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">No holidays added yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-white/70">
              <thead><tr className="border-b border-white/10">{['Date', 'Holiday', 'Type', ''].map(h => <th key={h} className="text-left py-2 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{holidays.map(h => (
                <tr key={h.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-2 pr-4 font-mono">{h.date}</td>
                  <td className="py-2 pr-4 text-white/80 font-medium">{h.name}</td>
                  <td className="py-2 pr-4"><span className="px-2 py-0.5 rounded-full text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30">{h.type}</span></td>
                  <td className="py-2"><Button variant="danger" onClick={() => removeHoliday(h)}>Remove</Button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <h3 className="text-white font-semibold mb-3">System Health (G-6)</h3>
        <p className="text-white/30 text-xs mb-3">Live checks: <a className="text-indigo-400 hover:text-indigo-300" href="/?health=1" target="_blank" rel="noreferrer">/?health=1</a> — no login required, useful when something's broken and you can't get in here.</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {[
            ['Leave Balance Import', lastImports?.leaveBalance],
          ].map(([label, ts]) => (
            <div key={label} className="bg-white/5 rounded-xl p-3 border border-white/10">
              <p className="text-white/40 text-xs">{label}</p>
              <p className="text-white text-sm mt-1">{ts ? new Date(ts).toLocaleString() : 'Never'}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h3 className="text-white font-semibold mb-3">Database Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[['Employees', employees.length], ['Attendance Records', attendanceCount], ['Leave Applications', leaves.length], ['Audit Logs', auditLogs.length]].map(([k, v]) => (
            <div key={k} className="bg-white/5 rounded-xl p-4 text-center border border-white/10">
              <p className="text-white text-2xl font-bold">{v}</p>
              <p className="text-white/30 text-xs mt-1">{k}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
