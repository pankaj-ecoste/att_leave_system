import { useState, useEffect, useCallback } from 'react'
import { employeeGetMyTeam } from '../api/employees'
import { managerGetTeamLeaves, managerDecideLeave as apiManagerDecideLeave } from '../api/leave'
import { managerGetTeamAttendance, managerGetTeamRegularizations, managerDecideRegularization as apiManagerDecideReg } from '../api/attendance'
import { managerGetTeamLocationLogs } from '../api/location'
import {
  managerGetTeamTravelSummary, managerGetTeamTravelJourney, managerGetTeamTravelAttendance,
  managerGetTeamTravelPhotoUrl,
} from '../api/travel'

// "My Team" — appears automatically for anyone with direct reports (the manager view
// lives inside the employee dashboard, not a separate login, since one person is both).
export function useTeam(token, empId, onAudit) {
  const [myTeam, setMyTeam] = useState([])
  const [teamLeaves, setTeamLeaves] = useState([])
  const [teamRegs, setTeamRegs] = useState([])
  const [teamAttn, setTeamAttn] = useState({})
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamLocationLogs, setTeamLocationLogs] = useState([])
  const [teamLocationLoading, setTeamLocationLoading] = useState(false)
  // plan.md §28 — read-only team Travel Allowance view.
  const [teamTravelSummary, setTeamTravelSummary] = useState([])
  const [teamTravelLoading, setTeamTravelLoading] = useState(false)
  // plan.md §33.7 — these 4 loaders used to only log a failed fetch to the console; the
  // screen kept showing whatever was already loaded (or nothing) with no indication
  // anything went wrong, indistinguishable from "empty team"/"no records." One shared
  // error state is enough — TeamPanel shows whichever load most recently failed.
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!token || !empId) {
      setMyTeam([]); setTeamLeaves([]); setTeamRegs([]); setTeamAttn({})
      return
    }
    ;(async () => {
      try {
        setTeamLoading(true)
        setError(null)
        const team = await employeeGetMyTeam(token, empId)
        setMyTeam(team)
        if (team.length === 0) return
        const [lvs, regs] = await Promise.all([
          managerGetTeamLeaves(token, empId),
          managerGetTeamRegularizations(token, empId),
        ])
        setTeamLeaves(lvs)
        setTeamRegs(regs)
      } catch (e) {
        console.error('loadMyTeam:', e)
        setError(`Could not load your team: ${e.message}`)
      } finally {
        setTeamLoading(false)
      }
    })()
  }, [token, empId])

  async function loadTeamAttendance(month, year) {
    try {
      setError(null)
      setTeamAttn(await managerGetTeamAttendance(token, empId, month, year))
    } catch (e) {
      console.error('loadTeamAttendance:', e)
      setError(`Could not load team attendance: ${e.message}`)
    }
  }

  async function loadTeamLocationLogs(date) {
    try {
      setTeamLocationLoading(true)
      setError(null)
      setTeamLocationLogs(await managerGetTeamLocationLogs(token, empId, date))
    } catch (e) {
      console.error('loadTeamLocationLogs:', e)
      setError(`Could not load team location logs: ${e.message}`)
    } finally {
      setTeamLocationLoading(false)
    }
  }

  async function loadTeamTravelSummary() {
    try {
      setTeamTravelLoading(true)
      setError(null)
      setTeamTravelSummary(await managerGetTeamTravelSummary(token, empId))
    } catch (e) {
      console.error('loadTeamTravelSummary:', e)
      setError(`Could not load team travel summary: ${e.message}`)
    } finally {
      setTeamTravelLoading(false)
    }
  }

  async function loadTeamTravelJourney(memberEmpId) {
    return managerGetTeamTravelJourney(token, empId, memberEmpId)
  }

  // Punch-in/punch-out bookends for one team member's open journey dates, keyed by
  // date — mirrors what TravelDayChain needs, same shape adminFetchAttendance's map
  // uses on the admin side, just scoped to a date range instead of a whole month.
  async function loadTeamTravelAttendance(memberEmpId, from, to) {
    const rows = await managerGetTeamTravelAttendance(token, empId, memberEmpId, from, to)
    const byDate = {}
    for (const r of rows) byDate[r.date] = r
    return byDate
  }

  async function decideLeave(leaveId, status) {
    try {
      // Trust the server's returned row rather than the status passed in — it carries
      // the real decided_at/decided_by fields the argument alone doesn't have.
      const updated = await apiManagerDecideLeave(token, empId, leaveId, status)
      setTeamLeaves(prev => prev.map(l => (l.id === leaveId ? updated : l)))
      onAudit?.('MANAGER_ACTION', `${status} leave ${leaveId}`)
    } catch (e) {
      throw new Error(`Could not update leave: ${e.message}`)
    }
  }

  async function decideRegularization(regId, status) {
    try {
      await apiManagerDecideReg(token, empId, regId, status)
      setTeamRegs(prev => prev.map(r => (r.id === regId ? { ...r, status } : r)))
      onAudit?.('MANAGER_ACTION', `${status} regularization ${regId}`)
    } catch (e) {
      throw new Error(`Could not update regularization: ${e.message}`)
    }
  }

  // plan.md §33.2 — bound here (token/empId already in scope) rather than in
  // TravelPhotoThumb itself, which only ever sees a plain path.
  const fetchPhotoUrl = useCallback(path => managerGetTeamTravelPhotoUrl(token, empId, path), [token, empId])

  return {
    myTeam, teamLeaves, teamRegs, teamAttn, teamLoading, loadTeamAttendance, decideLeave, decideRegularization,
    teamLocationLogs, teamLocationLoading, loadTeamLocationLogs,
    teamTravelSummary, teamTravelLoading, loadTeamTravelSummary, loadTeamTravelJourney, loadTeamTravelAttendance,
    fetchPhotoUrl, error,
  }
}
