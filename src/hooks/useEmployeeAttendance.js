import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { employeeFetchAttendance, employeePunch } from '../api/attendance'
import { employeeLogLocation, employeeLogOdLocation } from '../api/location'
import { attnKey } from '../api/mappers'
import { calcStatus, todayIST, isWithinCooldown } from '../lib/datetime'
import { PUNCH_COOLDOWN_MS, ACCEPTABLE_GPS_ACCURACY_M } from '../lib/constants'
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
      getLocation(async loc => {
        if (!loc) return
        try {
          await employeeLogLocation(token, empId, loc, todayIST(), 'auto')
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
    getLocation(async loc => {
      if (!loc) return
      try {
        await employeeLogOdLocation(token, empId, loc, todayIST())
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

  // GPS is REQUIRED — punch is blocked until location is captured (Decision-adjacent to
  // the office geofence work landing in Day 2; for now this just requires *a* location).
  // `fieldNote` is only meaningful for Field/Both work-mode employees (P3-6) — the
  // caller (PunchPanel) decides whether to collect and pass one.
  async function punch(type, currentUser, fieldNote) {
    // In-flight guard: a second tap while one is already resolving is ignored outright,
    // no round trip. The cooldown check below is the fallback once a punch has *landed*.
    if (punchingRef.current) return
    if (isWithinCooldown(lastPunchAtRef.current[type], Date.now(), PUNCH_COOLDOWN_MS)) {
      setLocationStatus('Please wait a few seconds before punching again')
      setTimeout(() => setLocationStatus(''), 3000)
      return
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
        if (type === 'in') { next.inTime = t; next.inLocation = loc }
        if (type === 'out') { next.outTime = t; next.outLocation = loc; stopAutoLocTracking(); stopOdTracking() }
        if (fieldNote) next.fieldNote = fieldNote
        next.punchType = type
        next.status = calcStatus(next, stdHours, next.dayType)
        try {
          await persist(next)
          lastPunchAtRef.current[type] = Date.now()
          try {
            await supabase.rpc('employee_log_location', {
              p_token: token, p_emp_id: currentUser.id, p_lat_lon: loc, p_date: todayIST(),
              p_type: type === 'in' ? 'punch_in' : 'punch_out',
            })
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
          // check) — surfaced plainly rather than as a raw Postgres error (§8C).
          setLocationStatus(e.message || 'Could not save punch — please try again')
          setTimeout(() => setLocationStatus(''), 5000)
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
