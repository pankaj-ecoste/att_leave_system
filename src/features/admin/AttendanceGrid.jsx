import { useState, useEffect } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Select } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { COMPANIES, MONTHS, APP_BIO_MISMATCH_THRESHOLD_MIN, getShiftInfo } from '../../lib/constants'
import { calcRawHrs, timeDiffMinutes, todayIST } from '../../lib/datetime'
import { fmtHrs, fmt2 } from '../../lib/format'

function monthRange(month, year) {
  const from = `${year}-${fmt2(month)}-01`
  const to = `${year}-${fmt2(month)}-${fmt2(new Date(year, month, 0).getDate())}`
  return { from, to }
}

const SOURCE_STYLE = {
  app: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30',
  biometric: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  manual: 'bg-white/10 text-white/50 border-white/20',
}

// App-vs-biometric mismatch (P3-11) — both readings exist and disagree by more than
// the threshold on either end.
function isMismatch(r) {
  if (!r.appInTime && !r.appOutTime) return false
  if (!r.bioInTime && !r.bioOutTime) return false
  const inDiff = timeDiffMinutes(r.appInTime, r.bioInTime)
  const outDiff = timeDiffMinutes(r.appOutTime, r.bioOutTime)
  return (inDiff != null && inDiff > APP_BIO_MISMATCH_THRESHOLD_MIN) || (outDiff != null && outDiff > APP_BIO_MISMATCH_THRESHOLD_MIN)
}

export function AttendanceGrid({ employees, attendanceHook, stdHours, updateStdHours, holidays }) {
  const { attendance, loading, fetchRange, editCell, setOfficialSource } = attendanceHook
  const [filters, setFilters] = useState({
    company: '', location: '', month: new Date().getMonth() + 1, year: new Date().getFullYear(),
    empId: '', customRange: false, from: todayIST(), to: todayIST(), allSummary: false, monthlyDetail: false,
  })
  const [editingCell, setEditingCell] = useState(null)
  const [editVal, setEditVal] = useState('')

  useEffect(() => {
    if (filters.customRange) fetchRange({ from: filters.from, to: filters.to, company: filters.company || null })
    else { const { from, to } = monthRange(filters.month, filters.year); fetchRange({ from, to, company: filters.company || null }) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.customRange, filters.from, filters.to, filters.month, filters.year, filters.company])

  const uniqueLocations = [...new Set(employees.map(e => e.locationInfo).filter(Boolean))]

  let rows = Object.values(attendance)
  if (filters.location) rows = rows.filter(r => employees.find(e => e.id === r.empId)?.locationInfo === filters.location)
  if (filters.empId && !filters.allSummary) rows = rows.filter(r => r.empId === filters.empId)
  // Field-tagged entries sort first within each date, note + location shown together
  // (plan.md §6B — "Admin's eye goes straight to the handful of entries that need a
  // judgment call"), then newest date first as before.
  const isFieldRow = r => {
    const mode = employees.find(e => e.id === r.empId)?.workMode
    return mode === 'field' || mode === 'both'
  }
  rows = rows.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date)
    if (dateCmp !== 0) return dateCmp
    return Number(isFieldRow(b)) - Number(isFieldRow(a))
  })

  const summaryRows = (() => {
    const map = {}
    rows.forEach(r => {
      if (!map[r.empId]) map[r.empId] = { empId: r.empId, present: 0, halfDay: 0, leave: 0, absent: 0, wfh: 0, onDuty: 0, hrs: 0, ot: 0 }
      const s = r.status || 'Absent'
      if (s === 'Present') map[r.empId].present++
      if (s === 'Half Day') map[r.empId].halfDay++
      if (s === 'Leave') map[r.empId].leave++
      if (s === 'Absent') map[r.empId].absent++
      if (r.wfh) map[r.empId].wfh++
      if (r.onDuty) map[r.empId].onDuty++
      const net = Math.max(0, calcRawHrs(r.inTime, r.outTime))
      map[r.empId].hrs += net
      map[r.empId].ot += Math.max(0, net - stdHours)
    })
    return Object.values(map)
  })()

  return (
    <>
      <Card>
        <h3 className="text-white font-semibold mb-3">Filters</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <Select value={filters.company} onChange={e => setFilters(p => ({ ...p, company: e.target.value, empId: '' }))}>
            <option value="">All Companies</option>{COMPANIES.map(c => <option key={c} value={c}>{c}</option>)}
          </Select>
          <Select value={filters.location} onChange={e => setFilters(p => ({ ...p, location: e.target.value }))}>
            <option value="">All Locations</option>{uniqueLocations.map(l => <option key={l} value={l}>{l}</option>)}
          </Select>
          {!filters.customRange && (
            <Select value={filters.month} onChange={e => setFilters(p => ({ ...p, month: +e.target.value }))}>
              {MONTHS.map((mn, i) => <option key={i + 1} value={i + 1}>{mn}</option>)}
            </Select>
          )}
          {!filters.allSummary && (
            <Select value={filters.empId} onChange={e => setFilters(p => ({ ...p, empId: e.target.value }))}>
              <option value="">All Employees</option>
              {employees.filter(e => (!filters.company || e.company === filters.company) && (!filters.location || e.locationInfo === filters.location)).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          )}
        </div>
        {!filters.customRange && (
          <div className="flex gap-1 flex-wrap items-center mb-3">
            <span className="text-white/30 text-xs mr-1">Year:</span>
            {[filters.year - 1, filters.year, filters.year + 1].map(y => (
              <button key={y} onClick={() => setFilters(p => ({ ...p, year: y }))} className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${filters.year === y ? 'bg-indigo-600 text-white' : 'bg-white/5 text-white/40 hover:bg-white/10 border border-white/10'}`}>{y}</button>
            ))}
          </div>
        )}
        <div className="flex gap-4 flex-wrap items-center mb-2">
          <label className="flex items-center gap-2 text-white/50 text-xs cursor-pointer"><input type="checkbox" checked={filters.customRange} onChange={e => setFilters(p => ({ ...p, customRange: e.target.checked }))} className="accent-indigo-500 w-3.5 h-3.5" />Custom Range</label>
          <label className="flex items-center gap-2 text-white/50 text-xs cursor-pointer"><input type="checkbox" checked={filters.allSummary} onChange={e => setFilters(p => ({ ...p, allSummary: e.target.checked, monthlyDetail: false }))} className="accent-indigo-500 w-3.5 h-3.5" />All Employees Summary</label>
          <label className="flex items-center gap-2 text-white/50 text-xs cursor-pointer"><input type="checkbox" checked={filters.monthlyDetail} onChange={e => setFilters(p => ({ ...p, monthlyDetail: e.target.checked, allSummary: false }))} className="accent-violet-500 w-3.5 h-3.5" />Monthly Detail (Employee)</label>
          <div className="flex items-center gap-1">
            <span className="text-white/30 text-xs">Std hrs:</span>
            <input type="number" min="1" max="24" value={stdHours} onChange={e => updateStdHours(+e.target.value)} className="bg-white/5 border border-white/15 rounded-lg px-2 py-1 text-white text-xs w-16" />
          </div>
        </div>
        {filters.customRange && (
          <div className="flex gap-2">
            <Input type="date" value={filters.from} onChange={e => setFilters(p => ({ ...p, from: e.target.value }))} />
            <Input type="date" value={filters.to} onChange={e => setFilters(p => ({ ...p, to: e.target.value }))} />
          </div>
        )}
        {loading && <p className="text-white/30 text-xs mt-2">Loading…</p>}
      </Card>

      <Card>
        <div className="flex items-center justify-between flex-wrap gap-2">
          <span className="text-white/50 text-xs">{rows.length} records</span>
        </div>
      </Card>

      {filters.allSummary ? (
        <Card>
          <h3 className="text-white font-semibold mb-3">All Employees Summary</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-white/70 min-w-[700px]">
              <thead><tr className="border-b border-white/10">{['Employee', 'Company', 'Shift', 'Present', 'Half Day', 'Leave', 'Absent', 'WFH', 'On Duty', 'Hours', 'OT'].map(h => <th key={h} className="text-left py-2.5 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>)}</tr></thead>
              <tbody>{summaryRows.map(r => {
                const emp = employees.find(e => e.id === r.empId) || {}
                const sh = getShiftInfo(null, emp)
                return (
                  <tr key={r.empId} className="border-b border-white/5 hover:bg-white/5 transition-colors">
                    <td className="py-2 pr-4"><button className="text-indigo-400 hover:text-indigo-300 hover:underline" onClick={() => setFilters(p => ({ ...p, allSummary: false, monthlyDetail: true, empId: r.empId }))}>{emp.name}</button></td>
                    <td className="py-2 pr-4 text-white/30">{emp.company?.split(' ')[0]}</td>
                    <td className="py-2 pr-4">{sh.id !== 'none' && <span className="text-xs font-semibold px-2 py-0.5 rounded" style={{ background: sh.color + '33', color: sh.color, border: `1px solid ${sh.color}55` }}>{sh.label}</span>}</td>
                    <td className="py-2 pr-4 text-emerald-400 font-medium">{r.present}</td>
                    <td className="py-2 pr-4 text-yellow-400">{r.halfDay}</td>
                    <td className="py-2 pr-4 text-amber-400">{r.leave}</td>
                    <td className="py-2 pr-4 text-red-400">{r.absent}</td>
                    <td className="py-2 pr-4 text-indigo-400">{r.wfh}</td>
                    <td className="py-2 pr-4 text-purple-400">{r.onDuty}</td>
                    <td className="py-2 pr-4">{fmtHrs(r.hrs)}</td>
                    <td className="py-2 pr-4 text-emerald-400">{r.ot > 0 ? fmtHrs(r.ot) : '--'}</td>
                  </tr>
                )
              })}</tbody>
            </table>
            {summaryRows.length === 0 && <p className="text-white/30 text-center py-8">No records</p>}
          </div>
        </Card>
      ) : filters.monthlyDetail ? (
        <Card>
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <h3 className="text-white font-semibold flex-1">Monthly Detail</h3>
            <Select className="w-auto py-1.5 text-xs" value={filters.empId} onChange={e => setFilters(p => ({ ...p, empId: e.target.value }))}>
              <option value="">Select Employee</option>
              {employees.filter(e => !filters.company || e.company === filters.company).map(e => <option key={e.id} value={e.id}>{e.name} ({e.empNum || '--'})</option>)}
            </Select>
          </div>
          {!filters.empId ? <p className="text-white/30 text-center py-8">Select an employee to view monthly detail</p> : (
            <p className="text-white/40 text-xs">Showing {filters.month}/{filters.year} for the selected employee — use Custom Range above to look further back.</p>
          )}
        </Card>
      ) : (
        <Card>
          <h3 className="text-white font-semibold mb-3">Daily Records</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-white/70 min-w-max">
              <thead><tr className="border-b border-white/10">{['Date', 'Emp Code', 'Name', 'Dept', 'In Time', 'Out Time', 'Net Hrs', 'OT', 'Status', 'Leave Type', 'Mode / Note', 'App vs Biometric'].map(h => <th key={h} className="text-left py-2.5 pr-3 text-white/30 font-medium uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr></thead>
              <tbody>{rows.map(r => {
                const emp = employees.find(e => e.id === r.empId) || {}
                const net = Math.max(0, calcRawHrs(r.inTime, r.outTime))
                const aKey = `${r.empId}_${r.date}`
                const isField = emp.workMode === 'field' || emp.workMode === 'both'
                return (
                  <tr key={aKey} className={`border-b border-white/5 hover:bg-white/5 transition-colors ${isField ? 'bg-amber-500/[0.04]' : ''}`}>
                    <td className="py-2 pr-3 font-mono text-white/50 whitespace-nowrap">{r.date}</td>
                    <td className="py-2 pr-3 text-white/40 whitespace-nowrap">{emp.empNum || '--'}</td>
                    <td className="py-2 pr-3 font-medium text-white/80 whitespace-nowrap">{emp.name}</td>
                    <td className="py-2 pr-3 text-white/40 whitespace-nowrap">{emp.dept || '--'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {editingCell === `${aKey}_in`
                        ? <input autoFocus type="time" className="bg-white/10 border border-indigo-400 rounded-lg px-1.5 py-0.5 text-white text-xs w-24" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => { editCell(aKey, 'inTime', editVal); setEditingCell(null) }} onKeyDown={e => { if (e.key === 'Enter') { editCell(aKey, 'inTime', editVal); setEditingCell(null) } if (e.key === 'Escape') setEditingCell(null) }} />
                        : <span className="cursor-pointer text-emerald-400 hover:text-emerald-300 font-mono" onClick={() => { setEditingCell(`${aKey}_in`); setEditVal(r.inTime || '') }}>{r.inTime || '--'}</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">
                      {editingCell === `${aKey}_out`
                        ? <input autoFocus type="time" className="bg-white/10 border border-indigo-400 rounded-lg px-1.5 py-0.5 text-white text-xs w-24" value={editVal} onChange={e => setEditVal(e.target.value)} onBlur={() => { editCell(aKey, 'outTime', editVal); setEditingCell(null) }} onKeyDown={e => { if (e.key === 'Enter') { editCell(aKey, 'outTime', editVal); setEditingCell(null) } if (e.key === 'Escape') setEditingCell(null) }} />
                        : <span className="cursor-pointer text-red-400 hover:text-red-300 font-mono" onClick={() => { setEditingCell(`${aKey}_out`); setEditVal(r.outTime || '') }}>{r.outTime || '--'}</span>}
                    </td>
                    <td className="py-2 pr-3 font-medium text-white/80 whitespace-nowrap">{fmtHrs(net)}</td>
                    <td className="py-2 pr-3 text-indigo-300 whitespace-nowrap">{net > stdHours ? fmtHrs(net - stdHours) : '--'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap"><Badge status={r.status || 'Absent'} /></td>
                    <td className="py-2 pr-3 text-white/30 text-xs whitespace-nowrap">{r.leaveType || ''}</td>
                    <td className="py-2 pr-3 max-w-[220px]">
                      {isField && (
                        <span className="inline-block mb-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">FIELD</span>
                      )}
                      {r.fieldNote && <p className="text-amber-200/70 text-xs truncate" title={r.fieldNote}>{r.fieldNote}</p>}
                      {(r.inLocation || r.outLocation) && (
                        <p className="text-white/30 text-xs truncate" title={r.inLocation || r.outLocation}>
                          {r.inLocation || r.outLocation}
                          {r.inInsideGeofence === false && <span className="text-red-400"> · outside</span>}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-3 min-w-[190px]">
                      {!r.appInTime && !r.appOutTime && !r.bioInTime && !r.bioOutTime ? (
                        <span className="text-white/20">--</span>
                      ) : (
                        <div className="space-y-0.5">
                          <p className="font-mono text-indigo-300/80">App {r.appInTime || '--:--'}–{r.appOutTime || '--:--'}</p>
                          <p className="font-mono text-blue-300/80">Bio {r.bioInTime || '--:--'}–{r.bioOutTime || '--:--'}</p>
                          <div className="flex items-center gap-1.5 pt-0.5">
                            {r.officialSource && (
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase ${SOURCE_STYLE[r.officialSource] || SOURCE_STYLE.manual}`}>{r.officialSource}</span>
                            )}
                            {isMismatch(r) && <span className="text-amber-400 text-[10px] font-semibold">MISMATCH</span>}
                            {isMismatch(r) && setOfficialSource && (
                              <button
                                className="text-[10px] text-white/40 hover:text-white/70 underline"
                                onClick={() => setOfficialSource(aKey, r.officialSource === 'app' ? 'biometric' : 'app')}
                                title="Switch which reading counts as official for this day"
                              >
                                use {r.officialSource === 'app' ? 'bio' : 'app'}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}</tbody>
            </table>
            {rows.length === 0 && <p className="text-white/30 text-center py-8">No records found</p>}
          </div>
        </Card>
      )}
    </>
  )
}
