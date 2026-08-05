import { useState, useEffect } from 'react'
import { employeeGetMyTeam } from '../api/employees'
import { managerGetTeamLeaves, managerDecideLeave as apiManagerDecideLeave } from '../api/leave'
import { managerGetTeamAttendance, managerGetTeamRegularizations, managerDecideRegularization as apiManagerDecideReg } from '../api/attendance'
import { managerGetTeamLocationLogs } from '../api/location'

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

  useEffect(() => {
    if (!token || !empId) {
      setMyTeam([]); setTeamLeaves([]); setTeamRegs([]); setTeamAttn({})
      return
    }
    ;(async () => {
      try {
        setTeamLoading(true)
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
      } finally {
        setTeamLoading(false)
      }
    })()
  }, [token, empId])

  async function loadTeamAttendance(month, year) {
    try {
      setTeamAttn(await managerGetTeamAttendance(token, empId, month, year))
    } catch (e) {
      console.error('loadTeamAttendance:', e)
    }
  }

  async function loadTeamLocationLogs(date) {
    try {
      setTeamLocationLoading(true)
      setTeamLocationLogs(await managerGetTeamLocationLogs(token, empId, date))
    } catch (e) {
      console.error('loadTeamLocationLogs:', e)
    } finally {
      setTeamLocationLoading(false)
    }
  }

  async function decideLeave(leaveId, status) {
    try {
      // Trust the server's returned row rather than the status passed in — an
      // 'Approved' manager decision lands on 'Manager Approved' (P4-1, two-stage
      // approval), not 'Approved' outright, so echoing the argument back would show
      // the wrong state until the next refetch.
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

  return {
    myTeam, teamLeaves, teamRegs, teamAttn, teamLoading, loadTeamAttendance, decideLeave, decideRegularization,
    teamLocationLogs, teamLocationLoading, loadTeamLocationLogs,
  }
}
