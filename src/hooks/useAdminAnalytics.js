import { useState, useEffect, useMemo } from 'react'
import { adminFetchAttendance } from '../api/attendance'
import { adminGetDeviceResetCounts, adminGetTravelAnalytics } from '../api/analytics'
import { todayIST } from '../lib/datetime'
import {
  monthBounds, graceRanking, leaveRanking, regularizationRanking, deviceResetRanking,
  visitsMonthRanking, visitsDayRanking, kmMonthRanking, lateOutRanking,
} from '../lib/analytics'

// plan.md §45 — everything the Analytics tab shows for one chosen month. Called from inside the
// Analytics screen, so nothing is fetched until the admin opens that tab. Attendance is fetched
// into this hook's OWN state, never the shared admin attendance hook (that one feeds the
// Dashboard and Attendance grid, and fetching another month into it would change what they show).
// Leaves and correction requests are already loaded for the whole admin panel, so they are just
// filtered here.
export function useAdminAnalytics(token, { employees, leaves, adminRegs, stdHours }) {
  const [month, setMonth] = useState(() => todayIST().slice(0, 7))
  const [records, setRecords] = useState([])
  const [resets, setResets] = useState([])
  const [travel, setTravel] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token) return undefined
    let cancelled = false // a slower answer for an older month must never overwrite a newer one
    const { from, to } = monthBounds(month)
    setLoading(true)
    setError(null)
    // allSettled, not all: if one source fails (say the travel numbers), the lists that DID load
    // should still show, with a note saying which part is missing.
    Promise.allSettled([
      adminFetchAttendance(token, { from, to, limit: 5000 }),
      adminGetDeviceResetCounts(token, from, to),
      adminGetTravelAnalytics(token, from, to),
    ]).then(([att, rst, trv]) => {
      if (cancelled) return
      setRecords(att.status === 'fulfilled' ? Object.values(att.value) : [])
      setResets(rst.status === 'fulfilled' ? rst.value : [])
      setTravel(trv.status === 'fulfilled' ? trv.value : [])
      const missing = []
      if (att.status === 'rejected') missing.push('attendance (grace period, punched out after 7 pm)')
      if (rst.status === 'rejected') missing.push('device resets')
      if (trv.status === 'rejected') missing.push('travel (visits, kilometres)')
      for (const r of [att, rst, trv]) if (r.status === 'rejected') console.error('analytics:', r.reason)
      setError(missing.length ? `Could not load: ${missing.join(', ')}. The other lists are still shown.` : null)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [token, month])

  const rankings = useMemo(() => {
    const { from, to } = monthBounds(month)
    const companyByName = new Map((employees || []).map(e => [String(e.name).trim(), e.company]))
    return {
      grace: graceRanking(records, employees, stdHours),
      leave: leaveRanking(leaves, from, to),
      regularization: regularizationRanking(adminRegs, from, to),
      deviceReset: deviceResetRanking(resets.map(r => ({ ...r, company: companyByName.get(r.name) }))),
      visitsMonth: visitsMonthRanking(travel),
      visitsDay: visitsDayRanking(travel),
      km: kmMonthRanking(travel),
      lateOut: lateOutRanking(records, employees),
    }
  }, [month, records, resets, travel, employees, leaves, adminRegs, stdHours])

  return { month, setMonth, loading, error, rankings }
}
