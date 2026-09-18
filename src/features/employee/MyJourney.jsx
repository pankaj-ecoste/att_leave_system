import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Spinner } from '../../components/ui/Spinner'
import { getTravelSelfieUrl } from '../../api/travel'
import { attnKey } from '../../api/mappers'

// Only fetched when a map is actually opened (plan.md §28 decision 9).
const JourneyMap = lazy(() => import('../../components/JourneyMap').then(m => ({ default: m.JourneyMap })))

function SelfieThumb({ path, className }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    getTravelSelfieUrl(path).then(u => { if (!cancelled) setUrl(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [path])
  if (!url) return <div className={`${className} bg-white/5 animate-pulse`} />
  return <img src={url} alt="Site visit selfie" className={className} />
}

function dayPoints(dateVisits, attendanceRecord) {
  const points = []
  if (attendanceRecord?.inLat != null) {
    points.push({ id: 'start', lat: attendanceRecord.inLat, lon: attendanceRecord.inLon, label: `Punch in ${attendanceRecord.inTime || ''}`, kind: 'start' })
  }
  dateVisits.forEach(v => points.push({ id: v.id, lat: v.lat, lon: v.lon, label: v.siteNote, kind: 'visit' }))
  if (attendanceRecord?.outLat != null) {
    points.push({ id: 'end', lat: attendanceRecord.outLat, lon: attendanceRecord.outLon, label: `Punch out ${attendanceRecord.outTime || ''}`, kind: 'end' })
  }
  return points
}

// plan.md §28 — "My Journey": camera-only selfie + mandatory site note per client
// visit, today's/open-period list grouped by day, cumulative distance, and a lazy map.
// Only rendered for Field / Office+Field staff — gated by the caller (EmployeeDashboard)
// using the same requiresFieldNote() check the punch screen already uses.
export function MyJourney({ currentUser, attendance, journey, summary, settlements, loading, addingVisit, locationStatus, addVisit }) {
  const [pendingFile, setPendingFile] = useState(null)
  const [siteNote, setSiteNote] = useState('')
  const [err, setErr] = useState('')
  const [openMapDate, setOpenMapDate] = useState(null)
  const [selectedVisitId, setSelectedVisitId] = useState(null)
  const [previewUrl, setPreviewUrl] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (!pendingFile) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(pendingFile)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [pendingFile])

  function pickPhoto() {
    fileInputRef.current?.click()
  }

  function onFileChosen(e) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow choosing the same shot again later
    if (file) { setPendingFile(file); setErr('') }
  }

  async function save() {
    if (!siteNote.trim()) { setErr('Enter the client/site name'); return }
    try {
      setErr('')
      await addVisit(pendingFile, siteNote.trim())
      setPendingFile(null)
      setSiteNote('')
    } catch (e) {
      setErr(e.message)
    }
  }

  const byDate = journey.reduce((acc, v) => {
    (acc[v.date] ||= []).push(v)
    return acc
  }, {})
  const dates = Object.keys(byDate).sort().reverse()

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wide">Travel Since Last Payout</p>
            <p className="text-2xl font-bold text-white mt-1">{summary.totalKm.toFixed(1)} km</p>
            <p className="text-white/30 text-xs mt-0.5">{summary.visitCount} site visit{summary.visitCount === 1 ? '' : 's'}{summary.firstDate ? ` · since ${summary.firstDate}` : ''}</p>
          </div>
          <Button onClick={pickPhoto} disabled={addingVisit}>{addingVisit ? 'Saving...' : '+ Add Visit'}</Button>
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" capture="user" className="hidden" onChange={onFileChosen} />
        {locationStatus && <p className="text-indigo-300 text-xs">{locationStatus}</p>}

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
            {err && <p className="text-red-400 text-xs mt-2">{err}</p>}
            <div className="flex gap-2 mt-3">
              <Button className="flex-1 text-xs" disabled={addingVisit} onClick={save}>{addingVisit ? 'Saving...' : 'Save Visit'}</Button>
              <Button variant="secondary" className="text-xs" onClick={() => { setPendingFile(null); setSiteNote(''); setErr('') }}>Cancel</Button>
            </div>
          </div>
        )}
      </Card>

      {loading && dates.length === 0 ? (
        <p className="text-white/30 text-sm text-center py-8">Loading...</p>
      ) : dates.length === 0 ? (
        <Card><p className="text-white/30 text-sm text-center py-6">No visits logged yet. Punch in, then tap "+ Add Visit" at each site.</p></Card>
      ) : dates.map(date => {
        const visits = byDate[date]
        const record = attendance?.[attnKey(currentUser.id, date)]
        const dayKm = visits.reduce((s, v) => s + v.legDistanceKm, 0)
        return (
          <Card key={date}>
            <div className="flex items-center justify-between mb-2">
              <p className="text-white font-medium text-sm">{date}</p>
              <div className="flex items-center gap-2">
                <span className="text-white/40 text-xs">{dayKm.toFixed(1)} km</span>
                <button
                  className="text-indigo-400 hover:text-indigo-300 text-xs underline underline-offset-2"
                  onClick={() => setOpenMapDate(openMapDate === date ? null : date)}
                >
                  {openMapDate === date ? 'Hide map' : 'View map'}
                </button>
              </div>
            </div>
            {openMapDate === date && (
              <Suspense fallback={<div className="h-72 flex items-center justify-center"><Spinner /></div>}>
                <div className="mb-3">
                  <JourneyMap points={dayPoints(visits, record)} onSelectVisit={setSelectedVisitId} selectedId={selectedVisitId} />
                </div>
              </Suspense>
            )}
            <div className="space-y-2">
              {visits.map(v => (
                <div key={v.id} className={`flex items-center gap-3 p-2 rounded-xl border ${selectedVisitId === v.id ? 'border-amber-400/50 bg-amber-500/10' : 'border-white/10 bg-white/5'}`}>
                  <SelfieThumb path={v.photoPath} className="w-12 h-12 rounded-lg object-cover shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{v.siteNote}</p>
                    <p className="text-white/30 text-xs">{new Date(v.capturedAt).toLocaleTimeString()} · {v.legDistanceKm.toFixed(1)} km{v.distanceOverridden ? ' (adjusted)' : ''}</p>
                  </div>
                </div>
              ))}
            </div>
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
                  <p className="text-white/30">{s.totalKm.toFixed(1)} km · ₹{s.ratePerKm}/km</p>
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
