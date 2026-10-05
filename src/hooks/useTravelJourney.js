import { useState, useEffect, useCallback } from 'react'
import { getLocation } from './useGeolocation'
import {
  employeeAddTravelVisit, employeeGetTravelJourney, employeeGetTravelSummary,
  employeeGetTravelSettlements, uploadTravelSelfie, uploadTravelReceipt, employeeRefineOwnTravelDistances,
  employeeGetTravelClaims, employeeSubmitTravelClaim,
  employeeGetOwnTravelPhotoUrl, deleteTravelSelfies,
} from '../api/travel'
import { withRetry, friendlySaveError, shrinkImage } from '../lib/travelUpload'
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
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(false)
  const [addingVisit, setAddingVisit] = useState(false)
  const [locationStatus, setLocationStatus] = useState('')

  const reload = useCallback(async () => {
    if (!token || !empId) return
    try {
      setLoading(true)
      const [j, s, st, cl] = await Promise.all([
        employeeGetTravelJourney(token, empId),
        employeeGetTravelSummary(token, empId),
        employeeGetTravelSettlements(token, empId),
        employeeGetTravelClaims(token, empId),
      ])
      setJourney(j)
      setSummary(s)
      setSettlements(st)
      setClaims(cl)
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
    if (!token || !empId) { setJourney([]); setSummary({ totalKm: 0, totalExpense: 0, visitCount: 0, firstDate: null, lastDate: null }); setSettlements([]); setClaims([]); return }
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
        const uploaded = []
        let photoPath = null
        const note = () => setLocationStatus('Weak signal, retrying...')
        try {
          setAddingVisit(true)
          setLocationStatus('Saving...')
          // Shrink first (a few hundred KB instead of 2-9 MB), then upload with retries.
          const selfie = await shrinkImage(file)
          photoPath = await withRetry(() => uploadTravelSelfie(selfie), { onRetry: note })
          uploaded.push(photoPath)
          let expensePhotoPath = null
          if (expense?.file) {
            const receipt = await shrinkImage(expense.file)
            expensePhotoPath = await withRetry(() => uploadTravelReceipt(receipt), { onRetry: note })
            uploaded.push(expensePhotoPath)
          }
          const payload = {
            date: todayIST(), lat: meta.lat, lon: meta.lon, accuracyM: meta.accuracy,
            siteNote, photoPath,
            expenseNote: expense?.note || null, expenseAmount: expense?.amount ?? null, expensePhotoPath,
          }
          // The save itself is NOT blindly retried: if the server saved it but the reply was
          // lost, a retry would create a duplicate. So after a network failure we first check
          // whether this photo's visit already exists.
          let visit
          try {
            visit = await withRetry(() => employeeAddTravelVisit(token, empId, payload), { onRetry: note })
          } catch (e) {
            const saved = await employeeGetTravelJourney(token, empId).catch(() => null)
            if (saved?.some(v => v.photoPath === photoPath)) {
              visit = saved.find(v => v.photoPath === photoPath)
            } else {
              throw e
            }
          }
          await reload()
          resolve(visit)
          refineInBackground()
        } catch (e) {
          // Failed save: remove the photos just uploaded so nothing is left orphaned — but only
          // if no visit row ended up pointing at them.
          if (uploaded.length) {
            // If we can't check (no signal), keep the photos — deleting one a saved visit uses would lose evidence.
            const linked = await employeeGetTravelJourney(token, empId).catch(() => null)
            if (linked) {
              const stillLinked = linked.some(v => uploaded.includes(v.photoPath) || uploaded.includes(v.expensePhotoPath))
              if (!stillLinked) await deleteTravelSelfies(uploaded)
            }
          }
          reject(new Error(friendlySaveError(e)))
        } finally {
          setAddingVisit(false)
          setLocationStatus('')
        }
      })
    })
  }

  // plan.md §33.2 — bound here (not called directly from TravelPhotoThumb) since only
  // this hook has token/empId in scope; a plain path is all the component needs to know.
  const fetchPhotoUrl = useCallback(path => employeeGetOwnTravelPhotoUrl(token, empId, path), [token, empId])

  // plan.md §46 — submit a dated claim; the caller builds and downloads the report for that period.
  async function submitClaim(endDate) {
    const claim = await employeeSubmitTravelClaim(token, empId, endDate)
    await reload()
    return claim
  }

  return { journey, summary, settlements, claims, loading, addingVisit, locationStatus, addVisit, submitClaim, reload, fetchPhotoUrl }
}
