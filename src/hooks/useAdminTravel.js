import { useState, useEffect, useCallback } from 'react'
import {
  adminGetTravelOverview, adminGetEmployeeTravelJourney, adminGetTravelSettlements,
  adminSetTaRateTier, adminGetTaSettings, adminUpdateTaSettings,
  adminOverrideTravelVisitDistance, adminSettleTravelPeriod,
} from '../api/travel'

// plan.md §28 — admin side of Travel Allowance. Deliberately its own hook, not folded
// into useAdminData.js — this feature only ever needed brand new tables/functions, so
// keeping it separate means the existing admin data wiring never has to change shape.
export function useAdminTravel(token) {
  const [overview, setOverview] = useState([])
  const [taSettings, setTaSettings] = useState({ managerRatePerKm: 0, executiveRatePerKm: 0 })
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)
      const [ov, settings] = await Promise.all([
        adminGetTravelOverview(token),
        adminGetTaSettings(token),
      ])
      setOverview(ov)
      setTaSettings(settings)
    } catch (e) {
      console.error('loadTravelOverview:', e)
    } finally {
      setLoading(false)
    }
  }, [token])

  useEffect(() => {
    if (!token) { setOverview([]); return }
    reload()
  }, [token, reload])

  async function setRateTier(empId, tier) {
    await adminSetTaRateTier(token, empId, tier)
    setOverview(prev => prev.map(r => (r.empId === empId ? { ...r, taRateTier: tier || null } : r)))
  }

  async function updateRates(managerRatePerKm, executiveRatePerKm) {
    const updated = await adminUpdateTaSettings(token, managerRatePerKm, executiveRatePerKm)
    setTaSettings(updated)
  }

  async function loadEmployeeJourney(empId) {
    return adminGetEmployeeTravelJourney(token, empId)
  }

  async function loadSettlements(empId) {
    return adminGetTravelSettlements(token, empId)
  }

  async function overrideDistance(visitId, newKm, reason) {
    return adminOverrideTravelVisitDistance(token, visitId, newKm, reason)
  }

  // Settlement (paid-amount record + photo/point cleanup) all happens atomically
  // server-side inside admin_settle_travel_period (0045_travel_selfies_delete_policy_fix.sql).
  async function settle(empId) {
    const { settlement } = await adminSettleTravelPeriod(token, empId)
    await reload()
    return settlement
  }

  return { overview, taSettings, loading, setRateTier, updateRates, loadEmployeeJourney, loadSettlements, overrideDistance, settle, reload }
}
