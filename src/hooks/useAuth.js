import { useState, useEffect, useCallback } from 'react'
import { fetchDirectory, fetchAppSettings, employeeLogin as apiEmployeeLogin, employeeLogout as apiEmployeeLogout, adminLogin as apiAdminLogin, adminLogout as apiAdminLogout } from '../api/auth'
import { fetchHolidays } from '../api/admin'
import { fetchSites } from '../api/sites'

const SESSION_KEY = 'hrms_session'

// Session + bootstrap data (directory, std hours, holidays) — the pieces every screen
// needs before anything role-specific loads. Role-specific data (attendance, leaves,
// team) lives in useEmployeeData / useAdminData / useTeam, which watch the tokens this
// hook produces.
export function useAuth() {
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState('login') // 'login' | 'employee' | 'admin'
  const [directory, setDirectory] = useState([])
  const [stdHours, setStdHours] = useState(9)
  const [adminEmail, setAdminEmail] = useState(null)
  const [birthdayMessage, setBirthdayMessage] = useState(null)
  const [holidays, setHolidays] = useState([])
  const [sites, setSites] = useState([])

  const [currentUser, setCurrentUser] = useState(null)
  const [employeeToken, setEmployeeToken] = useState(null)
  const [adminToken, setAdminToken] = useState(null)

  const [restoredSession, setRestoredSession] = useState(null) // { token, empId } from localStorage, resolved once directory loads
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState(null) // plan.md §13 — set when the server tells us the employee session died

  useEffect(() => {
    ;(async () => {
      try {
        const [dir, settings, hols, sts] = await Promise.all([fetchDirectory(), fetchAppSettings(), fetchHolidays(), fetchSites()])
        setDirectory(dir)
        setStdHours(settings.stdHours)
        setAdminEmail(settings.adminEmail)
        setBirthdayMessage(settings.birthdayMessage)
        setHolidays(hols)
        setSites(sts)
        try {
          const saved = localStorage.getItem(SESSION_KEY)
          if (saved) {
            const { token, empId } = JSON.parse(saved)
            const emp = token && empId ? dir.find(e => e.id === empId) : null
            if (emp) setRestoredSession({ token, empId, emp })
            else localStorage.removeItem(SESSION_KEY)
          }
        } catch {
          localStorage.removeItem(SESSION_KEY)
        }
      } catch (err) {
        console.error(err)
      }
      setLoading(false)
    })()
  }, [])

  // plan.md §13 — fired by the supabase.rpc wrapper (lib/supabase.js) the moment any
  // employee API call reports a dead session. Drops straight back to the login screen
  // instead of leaving the dashboard stuck looking logged-in but non-functional.
  useEffect(() => {
    function handleExpired() {
      setEmployeeToken(null)
      setCurrentUser(null)
      setView('login')
      setSessionExpiredMessage('Your session expired — please log in again.')
      try {
        localStorage.removeItem(SESSION_KEY)
      } catch {
        /* ignore */
      }
    }
    window.addEventListener('hrms:employee-session-expired', handleExpired)
    return () => window.removeEventListener('hrms:employee-session-expired', handleExpired)
  }, [])

  const loginAsEmployee = useCallback((token, emp, remember) => {
    setEmployeeToken(token)
    setCurrentUser(emp)
    setView('employee')
    setSessionExpiredMessage(null)
    if (remember) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({ token, empId: emp.id }))
      } catch {
        // localStorage may be unavailable (private browsing) — remember-me just won't persist
      }
    }
  }, [])

  async function employeeLogin(empId, pin) {
    const result = await apiEmployeeLogin(empId, pin)
    return result // { token, error, lockedUntil }
  }

  async function employeeLogout() {
    if (employeeToken) await apiEmployeeLogout(employeeToken)
    setEmployeeToken(null)
    setCurrentUser(null)
    setView('login')
    try {
      localStorage.removeItem(SESSION_KEY)
    } catch {
      /* ignore */
    }
  }

  async function adminLogin(pin) {
    const token = await apiAdminLogin(pin)
    if (token) {
      setAdminToken(token)
      setView('admin')
    }
    return token
  }

  async function adminLogout() {
    if (adminToken) await apiAdminLogout(adminToken)
    setAdminToken(null)
    setView('login')
  }

  return {
    loading, view, setView,
    directory, stdHours, setStdHours, adminEmail, setAdminEmail, birthdayMessage, setBirthdayMessage, holidays, setHolidays, sites, setSites,
    currentUser, setCurrentUser, employeeToken, adminToken,
    restoredSession, clearRestoredSession: () => setRestoredSession(null), loginAsEmployee,
    sessionExpiredMessage, clearSessionExpiredMessage: () => setSessionExpiredMessage(null),
    employeeLogin, employeeLogout, adminLogin, adminLogout,
  }
}
