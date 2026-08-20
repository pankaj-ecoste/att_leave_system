import { useState, useEffect, useRef, useCallback } from 'react'
import { employeeFetchAttendance, employeePunch } from '../api/attendance'
import { employeeLogLocation, employeeLogOdLocation } from '../api/location'
import { attnKey } from '../api/mappers'
import { calcStatus, calcRawHrs, todayIST, isWithinCooldown } from '../lib/datetime'
import { PUNCH_COOLDOWN_MS, MIN_PUNCH_GAP_MIN, ACCEPTABLE_GPS_ACCURACY_M } from '../lib/constants'
import { getLocation } from './useGeolocation'

const AUTO_LOC_INTERVAL_MS = 2 * 60 * 60 * 1000 // every 2 hours, while punched in (plan.md Decision 5)
const OD_INTERVAL_MS = 5 * 60 * 1000 // every 5 minutes, while On Duty is approved for today

// Today's attendance record + punch in/out + the two silent GPS tracking loops that run
// alongside it (2-hourly while punched in, 5-minutely while On Duty). Kept together
// because all three only make sense in relation to "am I punched in right now".
export function useEmployeeAttendance(token, empId, stdHours, onAudit) {
  const [attendance, setAttendance] = useState({})
  const [locationStatus, setLocationStatus] = useState('')
  const [locationBlocked, setLocationBlocked] = useState(false)
  const [odTrackLog, setOdTrackLog] = useState([])
  const [odTrackingActive, setOdTrackingActive] = useState(false)
  const [isPunching, setIsPunching] = useState(false) // reactive mirror of punchingRef, for disabling the punch buttons

  const autoLocIntervalRef = useRef(null)
  const odIntervalRef = useRef(null)
  const punchingRef = useRef(false) // in-flight guard — ignore a second tap while one is still resolving (P3-8)
  const lastPunchAtRef = useRef({ in: null, out: null }) // client-side half of the duplicate-tap cooldown

  useEffect(() => {
    if (!token || !empId) {
      setAttendance({})
      return
    }
    employeeFetchAttendance(token, empId).then(setAttendance).catch(console.error)
  }, [token, empId])

  useEffect(() => () => {
    if (autoLocIntervalRef.current) clearInterval(autoLocIntervalRef.current)
    if (odIntervalRef.current) clearInterval(odIntervalRef.current)
  }, [])

  const todayKey = useCallback((id = empId) => attnKey(id, todayIST()), [empId])
  const todayRecord = attendance[todayKey()] || {}

  function stopAutoLocTracking() {
    if (autoLocIntervalRef.current) {
      clearInterval(autoLocIntervalRef.current)
      autoLocIntervalRef.current = null
    }
  }

  function startAutoLocTracking() {
    stopAutoLocTracking()
    autoLocIntervalRef.current = setInterval(() => {
      if (!empId || !token) return
      getLocation(async (loc, err, meta) => {
        if (!loc) return
        try {
          await employeeLogLocation(token, empId, loc, todayIST(), 'auto', meta)
        } catch (e) {
          console.error('Auto location log failed:', e)
        }
      })
    }, AUTO_LOC_INTERVAL_MS)
  }

  function stopOdTracking() {
    if (odIntervalRef.current) {
      clearInterval(odIntervalRef.current)
      odIntervalRef.current = null
    }
    setOdTrackingActive(false)
  }

  function logOdLocation() {
    if (!empId || !token) return
    getLocation(async (loc, err, meta) => {
      if (!loc) return
      try {
        await employeeLogOdLocation(token, empId, loc, todayIST(), meta)
        setOdTrackLog(prev => [...prev.slice(-49), { ts: new Date().toLocaleTimeString(), loc }])
      } catch (e) {
        console.error('OD log failed:', e)
      }
    })
  }

  function startOdTracking() {
    stopOdTracking()
    setOdTrackingActive(true)
    logOdLocation()
    odIntervalRef.current = setInterval(logOdLocation, OD_INTERVAL_MS)
  }

  // Called after login (or leave-apply) to resume OD GPS tracking if the employee
  // already has an approved On Duty leave for today.
  function checkAndStartOdTracking(empLeaves) {
    const todayOD = empLeaves.some(l => l.date === todayIST() && l.status === 'Approved' && l.leaveType === 'On Duty')
    if (todayOD && !odIntervalRef.current) startOdTracking()
  }

  async function persist(record) {
    const saved = await employeePunch(token, record.empId, record)
    if (saved) setAttendance(prev => ({ ...prev, [attnKey(saved.empId, saved.date)]: saved }))
    return saved
  }

  // GPS is REQUIRED — punch is blocked until location is captured. `opts.siteId` is set
  // when an office tile was tapped (plan.md §6B) — the server (employee_punch,
  // 0007_geofence_and_wfh.sql) is the one that decides whether that's inside the site's
  // radius and rejects if not; the client never makes that call itself. `opts.fieldNote`
  // is only meaningful for the Field tile (P3-6).
  async function punch(type, currentUser, opts = {}) {
    const { siteId, fieldNote } = opts
    // In-flight guard: a second tap while one is already resolving is ignored outright,
    // no round trip. The cooldown check below is the fallback once a punch has *landed*.
    if (punchingRef.current) return
    if (isWithinCooldown(lastPunchAtRef.current[type], Date.now(), PUNCH_COOLDOWN_MS)) {
      setLocationStatus('Please wait a few seconds before punching again')
      setTimeout(() => setLocationStatus(''), 3000)
      return
    }
    // Hard block, not a dismissible warning (plan.md §12 V3 decision 5) — catches an
    // accidental back-to-back tap of Punch In then Punch Out. Checked before GPS is even
    // captured, so a rejected attempt doesn't waste a location fetch. calcRawHrs already
    // handles the overnight-wrap case correctly (a next-day out-time never reads as a
    // same-moment double-tap).
    if (type === 'out') {
      const existing = attendance[todayKey(currentUser.id)]
      if (existing?.inTime) {
        const now = new Date()
        const nowHHMM = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        const gapMin = calcRawHrs(existing.inTime, nowHHMM) * 60
        if (gapMin < MIN_PUNCH_GAP_MIN) {
          setLocationStatus(`You just punched in — please wait at least ${MIN_PUNCH_GAP_MIN} minutes before punching out`)
          setTimeout(() => setLocationStatus(''), 5000)
          return
        }
      }
    }
    punchingRef.current = true
    setIsPunching(true)
    setLocationStatus('Capturing location... please wait')
    setLocationBlocked(false)
    return new Promise(resolve => {
      getLocation(async (loc, err, meta) => {
        if (!loc) {
          setLocationStatus('')
          setLocationBlocked(true)
          punchingRef.current = false
          setIsPunching(false)
          resolve()
          return
        }
        setLocationBlocked(false)
        const key = todayKey(currentUser.id)
        const rec = attendance[key] || { empId: currentUser.id, date: todayIST() }
        const next = { ...rec }
        const now = new Date()
        const t = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
        if (type === 'in') {
          next.inTime = t; next.inLocation = loc
          next.inLat = meta?.lat ?? null; next.inLon = meta?.lon ?? null; next.inAccuracyM = meta?.accuracy ?? null
          next.inSiteId = siteId || null
        }
        if (type === 'out') {
          next.outTime = t; next.outLocation = loc
          next.outLat = meta?.lat ?? null; next.outLon = meta?.lon ?? null; next.outAccuracyM = meta?.accuracy ?? null
          next.outSiteId = siteId || null
          stopAutoLocTracking(); stopOdTracking()
        }
        if (fieldNote) next.fieldNote = fieldNote
        next.punchType = type
        next.status = calcStatus(next, stdHours, next.dayType)
        try {
          await persist(next)
          lastPunchAtRef.current[type] = Date.now()
          try {
            // Reuses the same wrapper the 2-hourly auto-tracking already uses, passing
            // `meta` (already captured above for this exact punch) so a punch-time
            // location log carries real coordinates too — it used to call the raw RPC
            // directly and silently drop lat/lon, which meant a punch could never be
            // matched to a site name (plan.md §12 V3 decision 7 follow-up).
            await employeeLogLocation(token, currentUser.id, loc, todayIST(), type === 'in' ? 'punch_in' : 'punch_out', meta)
          } catch (e) {
            console.error('Location log failed:', e)
          }
          onAudit?.(type === 'in' ? 'PUNCH_IN' : 'PUNCH_OUT', `${currentUser.name} ${type} at ${t} — ${loc}`, currentUser.name)
          const accuracyNote = meta?.accuracy > ACCEPTABLE_GPS_ACCURACY_M
            ? ` (±${Math.round(meta.accuracy)}m — low accuracy)`
            : ''
          setLocationStatus(`Located: ${loc}${accuracyNote}`)
          setTimeout(() => setLocationStatus(''), 5000)
          if (type === 'in') startAutoLocTracking()
        } catch (e) {
          // Includes the server's own duplicate-tap rejection (employee_punch's cooldown
          // check) and the geofence rejection ("Outside <site> radius — ...") — surfaced
          // plainly rather than as a raw Postgres error (§8C). An expired session is the
          // one exception — the app is about to redirect to login (lib/supabase.js +
          // useAuth.js, plan.md §13), so there's no point flashing the raw message here.
          if (e.message !== 'Invalid or expired session') {
            setLocationStatus(e.message || 'Could not save punch — please try again')
            setTimeout(() => setLocationStatus(''), 5000)
          }
        } finally {
          punchingRef.current = false
          setIsPunching(false)
          resolve()
        }
      })
    })
  }

  return {
    attendance, setAttendance, todayKey, todayRecord, persist, punch, isPunching,
    locationStatus, locationBlocked,
    odTrackingActive, odTrackLog,
    startOdTracking, stopOdTracking, checkAndStartOdTracking, stopAutoLocTracking,
  }
}
