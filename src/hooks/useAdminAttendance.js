import { useState, useCallback } from 'react'
import { adminFetchAttendance, adminUpsertAttendance, adminBulkUpsertAttendance } from '../api/attendance'
import { attnKey } from '../api/mappers'
import { calcStatus } from '../lib/datetime'

// Deliberately NOT loaded once at login — attendance is the one table that grows
// without bound (plan.md §8B: ~109,500 rows/year at 300 staff). Every screen that shows
// attendance asks for a specific range (today, a month, a custom range) and this hook
// re-fetches on demand rather than holding "everything" in memory.
export function useAdminAttendance(token, stdHours) {
  const [attendance, setAttendance] = useState({})
  const [loading, setLoading] = useState(false)

  const fetchRange = useCallback(async (opts = {}) => {
    if (!token) return
    setLoading(true)
    try {
      const map = await adminFetchAttendance(token, { limit: 3000, ...opts })
      setAttendance(map)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [token])

  async function upsert(record) {
    const saved = await adminUpsertAttendance(token, record.empId, record)
    if (saved) setAttendance(prev => ({ ...prev, [attnKey(saved.empId, saved.date)]: saved }))
    return saved
  }

  async function editCell(key, field, value) {
    const rec = attendance[key] || {}
    const next = { ...rec, [field]: value }
    // An admin's direct correction always becomes official immediately, and — like an
    // app punch — is protected from being silently overwritten by a later bio import
    // (P3-10, plan.md). Only inTime/outTime are ever inline-edited here today.
    if (field === 'inTime' || field === 'outTime') next.officialSource = 'manual'
    next.status = calcStatus(next, stdHours, next.dayType)
    return upsert(next)
  }

  async function bulkUpsert(records) {
    const count = await adminBulkUpsertAttendance(token, records)
    setAttendance(prev => {
      const next = { ...prev }
      for (const r of records) next[attnKey(r.empId, r.date)] = r
      return next
    })
    return count
  }

  return { attendance, setAttendance, loading, fetchRange, upsert, editCell, bulkUpsert }
}
