import { useState, useEffect, useCallback } from 'react'
import { getLocation } from './useGeolocation'
import {
  employeeAddTravelVisit, employeeGetTravelJourney, employeeGetTravelSummary,
  employeeGetTravelSettlements, uploadTravelSelfie, uploadTravelReceipt, employeeRefineOwnTravelDistances,
} from '../api/travel'
import { todayIST } from '../lib/datetime'

// plan.md §28 — employee side of Travel Allowance journey logging. Only meaningful for
// Field / Office+Field staff (requiresFieldNote(workMode) in lib/constants.js already
// captures that same eligibility check elsewhere in the app); callers gate rendering on
// that, this hook itself stays agnostic and just does nothing useful if called for an
// ineligible employee (the server rejects it either way).
export function useTravelJourney(token, empId) {
  const [journey, setJourney] = useState([])
  const [summary, setSummary] = useState({ totalKm: 0, totalExpense: 0, visitCount: 0, firstDate: null, lastDate: null })
  const [settlements, setSettlements] = useState([])
  const [loading, setLoading] = useState(false)
  const [addingVisit, setAddingVisit] = useState(false)
  const [locationStatus, setLocationStatus] = useState('')

  const reload = useCallback(async () => {
    if (!token || !empId) return
    try {
      setLoading(true)
      const [j, s, st] = await Promise.all([
        employeeGetTravelJourney(token, empId),
        employeeGetTravelSummary(token, empId),
        employeeGetTravelSettlements(token, empId),
      ])
      setJourney(j)
      setSummary(s)
      setSettlements(st)
    } catch (e) {
      console.error('loadTravelJourney:', e)
    } finally {
      setLoading(false)
    }
  }, [token, empId])

  // Best-effort — never awaited by anything the employee is actively waiting on
  // (plan.md §31: refinement is an accuracy convenience, the same posture as the ORS
  // call itself). Fires whenever the journey loads (catches up anything left unrefined
  // from before this existed) and right after a new visit is saved, so the employee's
  // own screen converges on the same road-distance number admin's review shows,
  // instead of one lagging the other.
  const refineInBackground = useCallback(async () => {
    if (!token || !empId) return
    try {
      const count = await employeeRefineOwnTravelDistances(token, empId)
      if (count > 0) await reload()
    } catch (e) {
      console.error('employeeRefineOwnTravelDistances:', e)
    }
  }, [token, empId, reload])

  useEffect(() => {
    if (!token || !empId) { setJourney([]); setSummary({ totalKm: 0, totalExpense: 0, visitCount: 0, firstDate: null, lastDate: null }); setSettlements([]); return }
    reload().then(refineInBackground)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, empId])

  // file is the camera-captured selfie Blob/File, siteNote the mandatory client/site
  // name. GPS is captured live at the moment of this call — never reused from an
  // earlier reading (plan.md §28 decision 2: "GPS captured at that instant").
  // expense is optional: { note, amount, file } — the server rejects amount/note
  // without a receipt file, but the UI (MyJourney.jsx) already enforces this before
  // ever calling addVisit, so the error path here is a defensive backstop, not the
  // primary guard.
  async function addVisit(file, siteNote, expense) {
    setLocationStatus('Getting your location...')
    return new Promise((resolve, reject) => {
      getLocation(async (_label, err, meta) => {
        if (err || !meta) {
          setLocationStatus('')
          reject(new Error(err || 'Could not get your location'))
          return
        }
        try {
          setAddingVisit(true)
          setLocationStatus('Saving...')
          const photoPath = await uploadTravelSelfie(file)
          const expensePhotoPath = expense?.file ? await uploadTravelReceipt(expense.file) : null
          const visit = await employeeAddTravelVisit(token, empId, {
            date: todayIST(), lat: meta.lat, lon: meta.lon, accuracyM: meta.accuracy,
            siteNote, photoPath,
            expenseNote: expense?.note || null, expenseAmount: expense?.amount ?? null, expensePhotoPath,
          })
          await reload()
          resolve(visit)
          refineInBackground()
        } catch (e) {
          reject(e)
        } finally {
          setAddingVisit(false)
          setLocationStatus('')
        }
      })
    })
  }

  return { journey, summary, settlements, loading, addingVisit, locationStatus, addVisit, reload }
}
