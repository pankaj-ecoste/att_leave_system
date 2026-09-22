import { useState, lazy, Suspense } from 'react'
import * as XLSX from 'xlsx'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { TravelDayChain } from '../../components/TravelDayChain'
import { PhotoViewerModal } from '../../components/PhotoViewerModal'
import { adminFetchAttendance } from '../../api/attendance'
import { dayPoints, effectiveLegKm, effectiveReturnLegKm } from '../../lib/travelPoints'
import { haversineMeters } from '../../lib/geo'
import { todayIST } from '../../lib/datetime'

const JourneyMap = lazy(() => import('../../components/JourneyMap').then(m => ({ default: m.JourneyMap })))

const TIER_LABELS = { manager: 'Manager', executive: 'Executive' }

function groupByDate(journey) {
  const byDate = journey.reduce((acc, v) => {
    (acc[v.date] ||= []).push(v)
    return acc
  }, {})
  return Object.keys(byDate).sort()
}

const SOURCE_LABELS = { routed: 'Road distance', estimated: 'Estimate (straight-line)', adjusted: 'Manually adjusted' }

// Day-wise Punch In -> visits -> Punch Out, then a cumulative summary sheet — same
// lightweight xlsx pattern Reports.jsx already uses for plain tabular exports
// (json_to_sheet, not the styled exceljs path). Mirrors exactly what the on-screen
// TravelDayChain and the map show, so the report never looks like a different feature.
// Distance column uses the same effective-distance priority as the screen: a manual
// adjustment wins, then the refined road distance once available, else the original
// instant straight-line estimate — the Source column says plainly which one it is.
function downloadTravelReport(row, dates, journeyByDate, attnByDate, rate) {
  const rows = []
  let totalKm = 0
  let totalExpense = 0

  for (const date of dates) {
    const visits = journeyByDate[date]
    const record = attnByDate[date]
    if (record?.inTime) {
      rows.push({ Date: date, Time: record.inTime, Type: 'Punch In', 'Site / Client': record.inLocation || '', 'Distance (km)': '', Source: '', 'Expense Note': '', 'Expense Amount (₹)': '' })
    }
    let lastLat = record?.inLat, lastLon = record?.inLon
    for (const v of visits) {
      const leg = effectiveLegKm(v)
      rows.push({
        Date: date, Time: new Date(v.capturedAt).toLocaleTimeString(), Type: 'Visit', 'Site / Client': v.siteNote,
        'Distance (km)': leg.km.toFixed(2), Source: SOURCE_LABELS[leg.source], 'Expense Note': v.expenseNote || '',
        'Expense Amount (₹)': v.expenseAmount != null ? v.expenseAmount.toFixed(2) : '',
      })
      totalKm += leg.km
      totalExpense += v.expenseAmount || 0
      lastLat = v.lat; lastLon = v.lon
    }
    if (record?.outTime) {
      const fallbackKm = (lastLat != null && record.outLat != null) ? haversineMeters(lastLat, lastLon, record.outLat, record.outLon) / 1000 : 0
      const returnLeg = effectiveReturnLegKm(record, fallbackKm)
      rows.push({ Date: date, Time: record.outTime, Type: 'Punch Out', 'Site / Client': record.outLocation || '', 'Distance (km)': returnLeg.km.toFixed(2), Source: SOURCE_LABELS[returnLeg.source], 'Expense Note': '', 'Expense Amount (₹)': '' })
      totalKm += returnLeg.km
    }
  }

  const distanceAmount = totalKm * rate
  const summaryRows = [{
    Employee: row.empName, 'Emp #': row.empNum || '', 'Rate Tier': TIER_LABELS[row.taRateTier] || row.taRateTier || '',
    'Rate (₹/km)': rate, Period: row.firstDate ? `${row.firstDate} to ${row.lastDate}` : '',
    'Total Visits': row.visitCount, 'Total Distance (km)': totalKm.toFixed(2), 'Distance Amount (₹)': distanceAmount.toFixed(2),
    'Total Expenses (₹)': totalExpense.toFixed(2), 'Grand Total (₹)': (distanceAmount + totalExpense).toFixed(2),
  }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Day-wise Journey')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary')
  XLSX.writeFile(wb, `travel_allowance_${(row.empNum || row.empName).replace(/\s+/g, '_')}_${todayIST()}.xlsx`)
}

// plan.md §28 — admin's Travel Allowance screen: rate tiers per eligible employee, the
// two ₹/km rates, per-employee journey review (punch-in -> visits -> punch-out, same
// chain the map draws as one connected line) with distance override + expense
// receipts, a downloadable day-wise/cumulative report, and settling (pay + purge). Own
// file, own hook (useAdminTravel) — nothing existing here was touched to add this tab
// (plan.md §28, "do not alter any running function").
export function Travel({ token, travel, onAudit }) {
  const {
    overview, taSettings, orsKeyStatus, loading, setRateTier, updateRates, loadEmployeeJourney, loadSettlements,
    overrideDistance, refineDistances, setOrsApiKey, settle, reload,
  } = travel
  const [rateForm, setRateForm] = useState(null)
  const [orsKeyInput, setOrsKeyInput] = useState(null)
  const [expandedEmp, setExpandedEmp] = useState(null)
  const [journey, setJourney] = useState([])
  const [attnByDate, setAttnByDate] = useState({})
  const [settlements, setSettlements] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [refining, setRefining] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [mapDate, setMapDate] = useState(null)
  const [overrideVisit, setOverrideVisit] = useState(null)
  const [viewerUrl, setViewerUrl] = useState(null)
  const [msg, setMsg] = useState('')

  async function fetchAttnByDate(empId, from, to) {
    const attn = await adminFetchAttendance(token, { empId, from, to })
    const byDate = {}
    for (const [key, rec] of Object.entries(attn)) {
      const [, date] = key.split('_')
      byDate[date] = rec
    }
    return byDate
  }

  async function expand(row) {
    if (expandedEmp === row.empId) { setExpandedEmp(null); return }
    setExpandedEmp(row.empId)
    setShowMap(false)
    setMapDate(null)
    setMsg('')
    setDetailLoading(true)
    // The date range for the attendance fetch is derived from the freshly-loaded
    // journey itself (below), not from `row` — `row` is a snapshot from whenever the
    // outer list last loaded, and reload() below could just be updating it, so reading
    // dates off the stale closure could miss a day the employee added since.
    let dateRange = row.firstDate && row.lastDate ? { from: row.firstDate, to: row.lastDate } : null
    try {
      // Always refresh the outer summary row too (plan.md §31 follow-up — it was only
      // refreshed after a refine found something new, so a visit added by the employee
      // while admin had this screen open could leave the list showing a stale km/visit
      // count even after Review showed the correct detail underneath it).
      const [j, s] = await Promise.all([loadEmployeeJourney(row.empId), loadSettlements(row.empId), reload()])
      setJourney(j)
      setSettlements(s)
      if (j.length > 0) {
        const dates = j.map(v => v.date).sort()
        dateRange = { from: dates[0], to: dates[dates.length - 1] }
      }
      setAttnByDate(dateRange ? await fetchAttnByDate(row.empId, dateRange.from, dateRange.to) : {})
    } catch (e) {
      setMsg(e.message)
    } finally {
      setDetailLoading(false)
    }

    // Best-effort road-distance refinement (plan.md §28 follow-up) — runs after the
    // instant estimates are already on screen, so opening Review never waits on an
    // external service. If it refines anything, re-pull the journey/attendance/overview
    // so the more accurate numbers replace the estimates without a manual refresh.
    if (orsKeyStatus.isSet && dateRange) {
      setRefining(true)
      try {
        const count = await refineDistances(row.empId)
        if (count > 0) {
          const [j2, attn2] = await Promise.all([
            loadEmployeeJourney(row.empId),
            fetchAttnByDate(row.empId, dateRange.from, dateRange.to),
          ])
          setJourney(j2)
          setAttnByDate(attn2)
          await reload()
        }
      } catch (e) {
        console.error('refineDistances:', e)
      } finally {
        setRefining(false)
      }
    }
  }

  async function saveRates() {
    try {
      await updateRates(Number(rateForm.managerRatePerKm), Number(rateForm.executiveRatePerKm))
      onAudit?.('TA_RATES_UPDATED', 'Travel Allowance rates updated', 'admin')
      setRateForm(null)
    } catch (e) {
      setMsg(e.message)
    }
  }

  async function saveOrsKey() {
    try {
      await setOrsApiKey(orsKeyInput.trim())
      onAudit?.('ORS_API_KEY_UPDATED', orsKeyInput.trim() ? 'Road-routing key set' : 'Road-routing key cleared', 'admin')
      setOrsKeyInput(null)
    } catch (e) {
      setMsg(e.message)
    }
  }

  async function saveOverride() {
    try {
      const km = Number(overrideVisit.km)
      if (!Number.isFinite(km) || km < 0) { setMsg('Enter a valid distance'); return }
      if (!overrideVisit.reason.trim()) { setMsg('A reason is required'); return }
      const updated = await overrideDistance(overrideVisit.id, km, overrideVisit.reason.trim())
      setJourney(prev => prev.map(v => (v.id === updated.id ? updated : v)))
      setOverrideVisit(null)
      setMsg('')
    } catch (e) {
      setMsg(e.message)
    }
  }

  function rateFor(row) {
    return row.taRateTier === 'manager' ? taSettings.managerRatePerKm : taSettings.executiveRatePerKm
  }

  function download(row) {
    if (journey.length === 0) { setMsg('Nothing to download — review the employee first.'); return }
    downloadTravelReport(row, groupByDate(journey), journey.reduce((acc, v) => { (acc[v.date] ||= []).push(v); return acc }, {}), attnByDate, rateFor(row))
  }

  async function doSettle(row) {
    if (!row.taRateTier) { setMsg('Set a rate tier before settling.'); return }
    const rate = rateFor(row)
    const distanceAmount = row.totalKm * rate
    const grandTotal = (distanceAmount + row.totalExpense).toFixed(2)
    if (!window.confirm(
      `Settle ${row.empName}: ${row.totalKm.toFixed(1)} km × ₹${rate}/km = ₹${distanceAmount.toFixed(2)}`
      + (row.totalExpense > 0 ? ` + ₹${row.totalExpense.toFixed(2)} expenses` : '')
      + ` = ₹${grandTotal}?\n\nMake sure you've downloaded the report first — this pays out and permanently deletes their selfies/receipts/points, keeping only this summary.`
    )) return
    try {
      const settlement = await settle(row.empId)
      onAudit?.('TRAVEL_SETTLED', `${row.empName} — ${settlement.totalKm.toFixed(1)}km, ₹${settlement.amount}`, 'admin')
      setExpandedEmp(null)
    } catch (e) {
      setMsg(e.message)
    }
  }

  const dates = groupByDate(journey)
  const journeyByDate = journey.reduce((acc, v) => { (acc[v.date] ||= []).push(v); return acc }, {})

  return (
    <div className="space-y-4">
      <PhotoViewerModal url={viewerUrl} onClose={() => setViewerUrl(null)} />
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-semibold">Travel Allowance Rates</h3>
            <p className="text-white/30 text-xs mt-1">₹ per km, by tier. Changeable any time — applies to the next settlement, not retroactively.</p>
          </div>
          {!rateForm && <Button className="text-xs" onClick={() => setRateForm({ ...taSettings })}>Edit Rates</Button>}
        </div>
        {rateForm ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
            <div>
              <Label>Manager ₹/km</Label>
              <Input type="number" min="0" step="0.5" value={rateForm.managerRatePerKm} onChange={e => setRateForm(f => ({ ...f, managerRatePerKm: e.target.value }))} />
            </div>
            <div>
              <Label>Executive ₹/km</Label>
              <Input type="number" min="0" step="0.5" value={rateForm.executiveRatePerKm} onChange={e => setRateForm(f => ({ ...f, executiveRatePerKm: e.target.value }))} />
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button className="text-xs" onClick={saveRates}>Save</Button>
              <Button variant="secondary" className="text-xs" onClick={() => setRateForm(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-6 text-sm">
            <p className="text-white/70">Manager: <span className="font-semibold text-white">₹{taSettings.managerRatePerKm}/km</span></p>
            <p className="text-white/70">Executive: <span className="font-semibold text-white">₹{taSettings.executiveRatePerKm}/km</span></p>
          </div>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-white font-semibold">Road Distance (routing)</h3>
            <p className="text-white/30 text-xs mt-1">
              The straight-line estimate can undercount real road distance by a lot in a city — this fills in the actual routed
              distance via OpenRouteService whenever you open Review, before you settle. Free key at openrouteservice.org (no card needed).
            </p>
          </div>
          {orsKeyInput == null && <Button variant="secondary" className="text-xs whitespace-nowrap" onClick={() => setOrsKeyInput('')}>{orsKeyStatus.isSet ? 'Update Key' : 'Set Key'}</Button>}
        </div>
        {orsKeyInput != null ? (
          <div className="p-3 bg-white/5 rounded-xl border border-white/10">
            <Label>OpenRouteService API Key</Label>
            <Input type="password" autoFocus value={orsKeyInput} onChange={e => setOrsKeyInput(e.target.value)} placeholder="Paste your ORS API key" />
            <div className="flex gap-2 mt-2">
              <Button className="text-xs" onClick={saveOrsKey}>Save</Button>
              <Button variant="secondary" className="text-xs" onClick={() => setOrsKeyInput(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <p className="text-sm">
            {orsKeyStatus.isSet
              ? <span className="text-emerald-400">Configured — road distances refine automatically on Review</span>
              : <span className="text-white/40">Not configured — showing the instant straight-line estimate only</span>}
          </p>
        )}
      </Card>

      <Card>
        <h3 className="text-white font-semibold mb-3">Field Staff Journeys</h3>
        {msg && <p className="text-red-400 text-xs mb-3">{msg}</p>}
        {loading && overview.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">Loading...</p>
        ) : overview.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">No Field / Office+Field staff found.</p>
        ) : (
          <div className="space-y-2">
            {overview.map(row => (
              <div key={row.empId} className="border border-white/10 rounded-xl overflow-hidden">
                <div className="flex items-center gap-3 p-3 bg-white/5 flex-wrap">
                  <div className="flex-1 min-w-[140px]">
                    <p className="text-white font-medium text-sm">{row.empName}</p>
                    <p className="text-white/30 text-xs">{row.empNum ? `#${row.empNum}` : ''}</p>
                  </div>
                  <select
                    className="bg-white/5 border border-white/15 rounded-lg px-2 py-1.5 text-white text-xs"
                    value={row.taRateTier || ''}
                    onChange={e => setRateTier(row.empId, e.target.value || null)}
                  >
                    <option value="">No tier set</option>
                    <option value="manager">Manager</option>
                    <option value="executive">Executive</option>
                  </select>
                  <div className="text-right">
                    <p className="text-white/70 text-sm font-mono">{row.totalKm.toFixed(1)} km{row.totalExpense > 0 ? ` + ₹${row.totalExpense.toFixed(2)}` : ''}</p>
                    <p className="text-white/30 text-xs">{row.visitCount} visits{row.firstDate ? ` since ${row.firstDate}` : ''}</p>
                  </div>
                  <Button variant="secondary" className="text-xs" onClick={() => expand(row)}>
                    {expandedEmp === row.empId ? 'Hide' : 'Review'}
                  </Button>
                  <Button className="text-xs" disabled={row.visitCount === 0} onClick={() => doSettle(row)}>Settle & Pay</Button>
                </div>

                {expandedEmp === row.empId && (
                  <div className="p-3 border-t border-white/10">
                    {detailLoading ? <p className="text-white/30 text-xs">Loading...</p> : (
                      <>
                        <div className="flex items-center gap-3 mb-3 flex-wrap">
                          <Button variant="secondary" className="text-xs" disabled={journey.length === 0} onClick={() => download(row)}>
                            ⬇ Download Report
                          </Button>
                          {refining && <span className="text-indigo-300 text-xs">Refining road distances...</span>}
                        </div>
                        {dates.length === 0 && <p className="text-white/30 text-xs">No open visits.</p>}
                        {dates.map(date => {
                          const visits = journeyByDate[date]
                          const record = attnByDate[date]
                          return (
                            <div key={date} className="mb-4">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-white/70 text-xs font-medium">{date}</p>
                                <button
                                  className="text-indigo-400 hover:text-indigo-300 text-xs underline underline-offset-2"
                                  onClick={() => { setShowMap(showMap && mapDate === date ? false : true); setMapDate(date) }}
                                >
                                  {showMap && mapDate === date ? 'Hide map' : 'View map'}
                                </button>
                              </div>
                              {showMap && mapDate === date && (
                                <Suspense fallback={<div className="h-72 flex items-center justify-center"><Spinner /></div>}>
                                  <div className="mb-2">
                                    <JourneyMap points={dayPoints(visits, record)} />
                                  </div>
                                </Suspense>
                              )}
                              <TravelDayChain
                                visits={visits}
                                attendanceRecord={record}
                                onOpenPhoto={setViewerUrl}
                                renderVisitExtra={v => (
                                  <Button variant="secondary" className="text-xs shrink-0" onClick={() => setOverrideVisit({ id: v.id, km: effectiveLegKm(v).km, reason: '' })}>Adjust</Button>
                                )}
                              />
                            </div>
                          )
                        })}

                        {overrideVisit && (
                          <div className="mt-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10">
                            <Label>New distance (km)</Label>
                            <Input type="number" min="0" step="0.1" value={overrideVisit.km} onChange={e => setOverrideVisit(o => ({ ...o, km: e.target.value }))} />
                            <div className="mt-2">
                              <Label>Reason <span className="text-red-400">*</span></Label>
                              <Input type="text" value={overrideVisit.reason} onChange={e => setOverrideVisit(o => ({ ...o, reason: e.target.value }))} placeholder="e.g. GPS jumped, actual route via NH-48" />
                            </div>
                            <div className="flex gap-2 mt-2">
                              <Button className="text-xs" onClick={saveOverride}>Save</Button>
                              <Button variant="secondary" className="text-xs" onClick={() => setOverrideVisit(null)}>Cancel</Button>
                            </div>
                          </div>
                        )}

                        {settlements.length > 0 && (
                          <div className="mt-4">
                            <p className="text-white/40 text-xs font-medium uppercase tracking-wide mb-2">Past Payouts</p>
                            {settlements.map(s => (
                              <div key={s.id} className="flex items-center justify-between py-1.5 text-xs border-b border-white/5">
                                <span className="text-white/60">{s.periodStart} – {s.periodEnd} · {s.totalKm.toFixed(1)} km{s.expenseAmount > 0 ? ` + ₹${s.expenseAmount.toFixed(2)} expenses` : ''} · {TIER_LABELS[s.rateTier] || s.rateTier}</span>
                                <span className="text-emerald-400 font-medium">₹{s.amount.toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
