import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { employeeFetchAttendance, employeePunch } from '../api/attendance'
import { employeeLogLocation, employeeLogOdLocation } from '../api/location'
import { attnKey } from '../api/mappers'
import { calcStatus, todayIST } from '../lib/datetime'
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
  const [autoTrackingActive, setAutoTrackingActive] = useState(false)
  const [odTrackingActive, setOdTrackingActive] = useState(false)

  const autoLocIntervalRef = useRef(null)
  const odIntervalRef = useRef(null)

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
    setAutoTrackingActive(false)
  }

  function startAutoLocTracking() {
    stopAutoLocTracking()
    setAutoTrackingActive(true)
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
  async function punch(type, currentUser) {
    setLocationStatus('Capturing location... please wait')
    setLocationBlocked(false)
    return new Promise(resolve => {
      getLocation(async loc => {
        if (!loc) {
          setLocationStatus('')
          setLocationBlocked(true)
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
        next.status = calcStatus(next, stdHours, next.dayType)
        await persist(next)
        try {
          await supabase.rpc('employee_log_location', {
            p_token: token, p_emp_id: currentUser.id, p_lat_lon: loc, p_date: todayIST(),
            p_type: type === 'in' ? 'punch_in' : 'punch_out',
          })
        } catch (e) {
          console.error('Location log failed:', e)
        }
        onAudit?.(type === 'in' ? 'PUNCH_IN' : 'PUNCH_OUT', `${currentUser.name} ${type} at ${t} — ${loc}`, currentUser.name)
        setLocationStatus(`Located: ${loc}`)
        setTimeout(() => setLocationStatus(''), 5000)
        if (type === 'in') startAutoLocTracking()
        resolve()
      })
    })
  }

  return {
    attendance, setAttendance, todayKey, todayRecord, persist, punch,
    locationStatus, locationBlocked,
    autoTrackingActive, odTrackingActive, odTrackLog,
    startOdTracking, stopOdTracking, checkAndStartOdTracking, stopAutoLocTracking,
  }
}
