import { useState, useEffect, useCallback } from 'react'
import { getLocation } from './useGeolocation'
import {
  employeeAddTravelVisit, employeeGetTravelJourney, employeeGetTravelSummary,
  employeeGetTravelSettlements, uploadTravelSelfie,
} from '../api/travel'
import { todayIST } from '../lib/datetime'

// plan.md §28 — employee side of Travel Allowance journey logging. Only meaningful for
// Field / Office+Field staff (requiresFieldNote(workMode) in lib/constants.js already
// captures that same eligibility check elsewhere in the app); callers gate rendering on
// that, this hook itself stays agnostic and just does nothing useful if called for an
// ineligible employee (the server rejects it either way).
export function useTravelJourney(token, empId) {
  const [journey, setJourney] = useState([])
  const [summary, setSummary] = useState({ totalKm: 0, visitCount: 0, firstDate: null, lastDate: null })
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

  useEffect(() => {
    if (!token || !empId) { setJourney([]); setSummary({ totalKm: 0, visitCount: 0, firstDate: null, lastDate: null }); setSettlements([]); return }
    reload()
  }, [token, empId, reload])

  // file is the camera-captured Blob/File, siteNote the mandatory client/site name.
  // GPS is captured live at the moment of this call — never reused from an earlier
  // reading (plan.md §28 decision 2: "GPS captured at that instant").
  async function addVisit(file, siteNote) {
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
          const visit = await employeeAddTravelVisit(token, empId, {
            date: todayIST(), lat: meta.lat, lon: meta.lon, accuracyM: meta.accuracy,
            siteNote, photoPath,
          })
          await reload()
          resolve(visit)
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
