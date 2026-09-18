import { useState, useEffect, lazy, Suspense } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'
import { Spinner } from '../../components/ui/Spinner'
import { getTravelSelfieUrl } from '../../api/travel'

const JourneyMap = lazy(() => import('../../components/JourneyMap').then(m => ({ default: m.JourneyMap })))

const TIER_LABELS = { manager: 'Manager', executive: 'Executive' }

function SelfieThumb({ path }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    getTravelSelfieUrl(path).then(u => { if (!cancelled) setUrl(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [path])
  if (!url) return <div className="w-12 h-12 rounded-lg bg-white/5 shrink-0" />
  return <img src={url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
}

// plan.md §28 — admin's Travel Allowance screen: rate tiers per eligible employee, the
// two ₹/km rates, per-employee journey review with map + distance override, and
// settling (pay + purge). Own file, own hook (useAdminTravel) — nothing existing here
// was touched to add this tab (plan.md §28, "do not alter any running function").
export function Travel({ travel, onAudit }) {
  const { overview, taSettings, loading, setRateTier, updateRates, loadEmployeeJourney, loadSettlements, overrideDistance, settle } = travel
  const [rateForm, setRateForm] = useState(null)
  const [expandedEmp, setExpandedEmp] = useState(null)
  const [journey, setJourney] = useState([])
  const [settlements, setSettlements] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [overrideVisit, setOverrideVisit] = useState(null)
  const [msg, setMsg] = useState('')

  async function expand(empId) {
    if (expandedEmp === empId) { setExpandedEmp(null); return }
    setExpandedEmp(empId)
    setShowMap(false)
    setMsg('')
    setDetailLoading(true)
    try {
      const [j, s] = await Promise.all([loadEmployeeJourney(empId), loadSettlements(empId)])
      setJourney(j)
      setSettlements(s)
    } catch (e) {
      setMsg(e.message)
    } finally {
      setDetailLoading(false)
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

  async function doSettle(row) {
    if (!row.taRateTier) { setMsg('Set a rate tier before settling.'); return }
    const rate = row.taRateTier === 'manager' ? taSettings.managerRatePerKm : taSettings.executiveRatePerKm
    const amount = (row.totalKm * rate).toFixed(2)
    if (!window.confirm(`Settle ${row.empName}: ${row.totalKm.toFixed(1)} km × ₹${rate}/km = ₹${amount}?\n\nThis pays out and permanently deletes their selfies/points, keeping only this summary.`)) return
    try {
      const settlement = await settle(row.empId)
      onAudit?.('TRAVEL_SETTLED', `${row.empName} — ${settlement.totalKm.toFixed(1)}km, ₹${settlement.amount}`, 'admin')
      setExpandedEmp(null)
    } catch (e) {
      setMsg(e.message)
    }
  }

  return (
    <div className="space-y-4">
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
                  <p className="text-white/70 text-sm font-mono">{row.totalKm.toFixed(1)} km</p>
                  <p className="text-white/30 text-xs">{row.visitCount} visits{row.firstDate ? ` since ${row.firstDate}` : ''}</p>
                  <Button variant="secondary" className="text-xs" onClick={() => expand(row.empId)}>
                    {expandedEmp === row.empId ? 'Hide' : 'Review'}
                  </Button>
                  <Button className="text-xs" disabled={row.visitCount === 0} onClick={() => doSettle(row)}>Settle & Pay</Button>
                </div>

                {expandedEmp === row.empId && (
                  <div className="p-3 border-t border-white/10">
                    {detailLoading ? <p className="text-white/30 text-xs">Loading...</p> : (
                      <>
                        {journey.length > 0 && (
                          <button className="text-indigo-400 text-xs underline underline-offset-2 mb-2" onClick={() => setShowMap(!showMap)}>
                            {showMap ? 'Hide map' : 'View map'}
                          </button>
                        )}
                        {showMap && (
                          <Suspense fallback={<div className="h-72 flex items-center justify-center"><Spinner /></div>}>
                            <div className="mb-3">
                              <JourneyMap points={journey.map(v => ({ id: v.id, lat: v.lat, lon: v.lon, label: v.siteNote, kind: 'visit' }))} />
                            </div>
                          </Suspense>
                        )}
                        <div className="space-y-2">
                          {journey.map(v => (
                            <div key={v.id} className="flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/10">
                              <SelfieThumb path={v.photoPath} />
                              <div className="flex-1 min-w-0">
                                <p className="text-white text-sm truncate">{v.siteNote}</p>
                                <p className="text-white/30 text-xs">{v.date} {new Date(v.capturedAt).toLocaleTimeString()} · {v.legDistanceKm.toFixed(1)} km{v.distanceOverridden ? ` (adjusted: ${v.overrideReason})` : ''}</p>
                              </div>
                              <Button variant="secondary" className="text-xs shrink-0" onClick={() => setOverrideVisit({ id: v.id, km: v.legDistanceKm, reason: '' })}>Adjust</Button>
                            </div>
                          ))}
                          {journey.length === 0 && <p className="text-white/30 text-xs">No open visits.</p>}
                        </div>

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
                                <span className="text-white/60">{s.periodStart} – {s.periodEnd} · {s.totalKm.toFixed(1)} km · {TIER_LABELS[s.rateTier] || s.rateTier}</span>
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
