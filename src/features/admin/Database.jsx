import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { adminGetAllLocationLogs } from '../../api/location'
import { todayIST } from '../../lib/datetime'

const SUB_TABS = [['employees', 'Employees'], ['attendance', 'Attendance'], ['balances', 'Balances'], ['leaves', 'Leave Apps'], ['audit', 'Audit Logs'], ['locations', 'Location Logs']]

function downloadRows(rows, type, name) {
  if (!rows.length) return
  if (type === 'xlsx') {
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, name)
    XLSX.writeFile(wb, `${name}.xlsx`)
  } else {
    const keys = Object.keys(rows[0] || {})
    const csv = [keys.join(','), ...rows.map(r => keys.map(k => `"${r[k] ?? ''}"`).join(','))].join('\n')
    const a = document.createElement('a')
    a.href = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`
    a.download = `${name}.csv`
    a.click()
  }
}

export function Database({ token, employees, attendanceHook, leaves, leaveBalances, auditLogs }) {
  const [subTab, setSubTab] = useState('employees')
  const [search, setSearch] = useState('')
  const [locDate, setLocDate] = useState(todayIST())
  const [locLogs, setLocLogs] = useState([])
  const [locLoading, setLocLoading] = useState(false)
  const { attendance, fetchRange } = attendanceHook

  useEffect(() => {
    if (subTab === 'attendance') fetchRange({ from: `${locDate.slice(0, 7)}-01`, to: locDate, limit: 200 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTab])

  useEffect(() => {
    if (subTab !== 'locations') return
    setLocLoading(true)
    adminGetAllLocationLogs(token, locDate).then(setLocLogs).catch(console.error).finally(() => setLocLoading(false))
  }, [subTab, locDate, token])

  const q = search.toLowerCase()
  const exportRows = () => {
    let rows = []
    if (subTab === 'employees') rows = employees
    if (subTab === 'attendance') rows = Object.values(attendance).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 200)
    if (subTab === 'leaves') rows = [...leaves].sort((a, b) => b.date.localeCompare(a.date))
    if (subTab === 'balances') Object.entries(leaveBalances).forEach(([eid, types]) => { const emp = employees.find(e => e.id === eid); Object.entries(types).forEach(([lt, v]) => rows.push({ Employee: emp?.name || eid, 'Leave Type': lt, ...v })) })
    if (subTab === 'audit') rows = auditLogs
    return rows
  }

  return (
    <Card>
      <h3 className="text-white font-semibold mb-4">Database</h3>
      <div className="flex gap-1 mb-4 flex-wrap bg-white/5 rounded-xl p-1 border border-white/10">
        {SUB_TABS.map(([t, l]) => (
          <button key={t} onClick={() => setSubTab(t)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all min-w-[80px] ${subTab === t ? 'bg-indigo-600 text-white' : 'text-white/40 hover:text-white/60'}`}>{l}</button>
        ))}
      </div>
      <div className="flex gap-2 mb-3 flex-wrap">
        <Input className="flex-1" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        <Button className="text-xs" onClick={() => downloadRows(exportRows(), 'xlsx', subTab)}>Export XLSX</Button>
        <Button variant="secondary" className="text-xs" onClick={() => downloadRows(exportRows(), 'csv', subTab)}>Export CSV</Button>
      </div>
      <div className="overflow-x-auto border border-white/10 rounded-xl" style={{ maxHeight: '500px', overflowY: 'auto' }}>
        {subTab === 'employees' && (() => {
          const rows = employees.filter(e => !q || `${e.name} ${e.empNum} ${e.company} ${e.dept} ${e.jobTitle} ${e.manager}`.toLowerCase().includes(q))
          return rows.length === 0 ? <p className="text-white/30 text-center py-10">No records</p> : (
            <table className="w-full text-xs text-white/60 min-w-max">
              <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{['Name', 'Emp #', 'Company', 'Dept', 'Job Title', 'Manager', 'Status'].map(h => <th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 100).map((e, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{e.name}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.empNum || '--'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.company?.split(' ')[0]}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.dept || '--'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.jobTitle || '--'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{e.manager || '--'}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs ${e.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>{e.active ? 'Active' : 'Inactive'}</span></td>
                </tr>
              ))}</tbody>
            </table>
          )
        })()}
        {subTab === 'attendance' && (() => {
          const rows = Object.values(attendance).sort((a, b) => (b.date || '').localeCompare(a.date || '')).filter(r => !q || `${employees.find(e => e.id === r.empId)?.name || ''} ${r.date} ${r.status || ''}`.toLowerCase().includes(q))
          return rows.length === 0 ? <p className="text-white/30 text-center py-10">No records</p> : (
            <table className="w-full text-xs text-white/60 min-w-max">
              <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{['Emp Name', 'Date', 'In', 'Out', 'Status', 'Source'].map(h => <th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 100).map((r, i) => {
                const emp = employees.find(e => e.id === r.empId) || {}
                const src = r.bioSource ? 'Daily Bio' : r.monthlySource ? 'Monthly Bio' : r.source === 'manual' ? 'Manual' : ''
                return (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{emp.name || '--'}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{r.date}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-emerald-400 font-mono">{r.inTime || '--'}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-red-400 font-mono">{r.outTime || '--'}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><Badge status={r.status || 'Absent'} /></td>
                    <td className="px-3 py-2 whitespace-nowrap">{src || '--'}</td>
                  </tr>
                )
              })}</tbody>
            </table>
          )
        })()}
        {subTab === 'balances' && (() => {
          const leaveTypes = ['Sick Leave', 'Casual Leave', 'Earned Leave', 'Unpaid Leave', 'Bereavement Leave', 'Marriage Leave', 'Maternity Leave', 'Paternity Leave']
          const rows = employees.filter(e => leaveBalances[e.id]).filter(e => !q || e.name.toLowerCase().includes(q))
          return rows.length === 0 ? <p className="text-white/30 text-center py-10">No records</p> : (
            <table className="w-full text-xs text-white/60 min-w-max">
              <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">
                <th className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">Employee</th>
                {leaveTypes.map(lt => <th key={lt} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{lt.replace(' Leave', '')}</th>)}
              </tr></thead>
              <tbody>{rows.slice(0, 100).map((e, i) => {
                const bal = leaveBalances[e.id] || {}
                return (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{e.name}</td>
                    {leaveTypes.map(lt => <td key={lt} className="px-3 py-2 whitespace-nowrap">{bal[lt] ? `${bal[lt].balance}/${bal[lt].quota}` : '--'}</td>)}
                  </tr>
                )
              })}</tbody>
            </table>
          )
        })()}
        {subTab === 'leaves' && (() => {
          const rows = [...leaves].sort((a, b) => b.date.localeCompare(a.date)).filter(r => !q || `${r.empName} ${r.leaveType} ${r.status}`.toLowerCase().includes(q))
          return rows.length === 0 ? <p className="text-white/30 text-center py-10">No records</p> : (
            <table className="w-full text-xs text-white/60 min-w-max">
              <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{['Employee', 'Type', 'Date', 'Status', 'Reason'].map(h => <th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 100).map((l, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{l.empName}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{l.leaveType}</td>
                  <td className="px-3 py-2 whitespace-nowrap font-mono">{l.date}</td>
                  <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs border ${l.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : l.status === 'Rejected' ? 'bg-red-500/20 text-red-300 border-red-500/30' : 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30'}`}>{l.status}</span></td>
                  <td className="px-3 py-2 max-w-[150px] truncate">{l.reason || '--'}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        })()}
        {subTab === 'audit' && (() => {
          const rows = auditLogs.filter(r => !q || `${r.action} ${r.detail} ${r.by}`.toLowerCase().includes(q))
          return rows.length === 0 ? <p className="text-white/30 text-center py-10">No records</p> : (
            <table className="w-full text-xs text-white/60 min-w-max">
              <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{['Timestamp', 'Action', 'Detail', 'By'].map(h => <th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 100).map((r, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="px-3 py-2 whitespace-nowrap font-mono">{new Date(r.ts).toLocaleString()}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-indigo-300">{r.action}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{r.detail}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{r.by}</td>
                </tr>
              ))}</tbody>
            </table>
          )
        })()}
        {subTab === 'locations' && (
          <div>
            <div className="flex items-center gap-2 mb-3 p-2">
              <label className="text-white/40 text-xs">Date:</label>
              <Input type="date" className="text-xs w-auto" value={locDate} max={todayIST()} onChange={e => setLocDate(e.target.value)} />
              {locLoading && <span className="text-white/30 text-xs">Loading...</span>}
            </div>
            {locLogs.length === 0 ? (
              <p className="text-white/30 text-center py-10">{locLoading ? 'Loading...' : 'No location logs for this date'}</p>
            ) : (
              <table className="w-full text-xs text-white/60 min-w-max">
                <thead className="sticky top-0 bg-slate-950"><tr className="border-b border-white/10">{['Time', 'Employee', 'Location', 'Type'].map(h => <th key={h} className="text-left px-3 py-2.5 text-white/30 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
                <tbody>{locLogs.filter(r => !q || `${r.empName} ${r.empNum} ${r.latLon} ${r.type}`.toLowerCase().includes(q)).map((r, i) => (
                  <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                    <td className="px-3 py-2 whitespace-nowrap font-mono">{new Date(r.capturedAt).toLocaleTimeString()}</td>
                    <td className="px-3 py-2 whitespace-nowrap font-medium text-white/80">{r.empName}</td>
                    <td className="px-3 py-2 max-w-[250px] truncate text-purple-400/80">{r.latLon}</td>
                    <td className="px-3 py-2 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.type === 'punch_in' ? 'bg-emerald-500/20 text-emerald-300' : r.type === 'punch_out' ? 'bg-red-500/20 text-red-300' : 'bg-blue-500/20 text-blue-300'}`}>{r.type === 'punch_in' ? 'Punch In' : r.type === 'punch_out' ? 'Punch Out' : 'Auto'}</span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        )}
      </div>
      <p className="text-white/20 text-xs mt-2">Showing up to 100 rows</p>
    </Card>
  )
}
