import { useState, useEffect, useCallback } from 'react'
import {
  adminGetTravelOverview, adminGetEmployeeTravelJourney, adminGetTravelSettlements,
  adminSetTaRateTier, adminGetTaSettings, adminUpdateTaSettings,
  adminOverrideTravelVisitDistance, adminSettleTravelPeriod, deleteTravelSelfies,
  adminRefineTravelDistances, adminGetOrsApiKeyStatus, adminSetOrsApiKey,
} from '../api/travel'

// plan.md §28 — admin side of Travel Allowance. Deliberately its own hook, not folded
// into useAdminData.js — this feature only ever needed brand new tables/functions, so
// keeping it separate means the existing admin data wiring never has to change shape.
export function useAdminTravel(token) {
  const [overview, setOverview] = useState([])
  const [taSettings, setTaSettings] = useState({ managerRatePerKm: 0, executiveRatePerKm: 0 })
  const [orsKeyStatus, setOrsKeyStatus] = useState({ isSet: false, updatedAt: null })
  const [loading, setLoading] = useState(false)

  const reload = useCallback(async () => {
    if (!token) return
    try {
      setLoading(true)
      const [ov, settings, keyStatus] = await Promise.all([
        adminGetTravelOverview(token),
        adminGetTaSettings(token),
        adminGetOrsApiKeyStatus(token),
      ])
      setOverview(ov)
      setTaSettings(settings)
      setOrsKeyStatus(keyStatus)
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

  // Best-effort — returns how many legs it managed to refine. Never throws for a
  // single leg failing (server already swallows those); a genuine token/network
  // failure still surfaces so the caller can show it.
  async function refineDistances(empId) {
    return adminRefineTravelDistances(token, empId)
  }

  async function setOrsApiKey(key) {
    await adminSetOrsApiKey(token, key)
    setOrsKeyStatus(await adminGetOrsApiKeyStatus(token))
  }

  // The paid-amount record + travel_visits cleanup happens atomically server-side
  // (admin-token-gated); the actual photo files are removed as a genuinely separate
  // client-side step, since Supabase doesn't allow deleting storage objects via plain
  // SQL at all (0051_travel_settle_storage_cleanup_fix.sql) — a failure here leaves
  // harmless orphan files behind, never risks or blocks the already-committed payout.
  async function settle(empId) {
    const { settlement, photoPaths } = await adminSettleTravelPeriod(token, empId)
    await deleteTravelSelfies(photoPaths)
    await reload()
    return settlement
  }

  return {
    overview, taSettings, orsKeyStatus, loading, setRateTier, updateRates, loadEmployeeJourney, loadSettlements,
    overrideDistance, refineDistances, setOrsApiKey, settle, reload,
  }
}
