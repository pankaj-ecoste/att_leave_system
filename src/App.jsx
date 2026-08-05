import { useState, useEffect } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Spinner } from './components/ui/Spinner'
import { LoginScreen } from './features/auth/LoginScreen'
import { AdminLogin } from './features/auth/AdminLogin'
import { EmployeeDashboard } from './features/employee/EmployeeDashboard'
import { AdminPanel } from './features/admin/AdminPanel'
import { useAuth } from './hooks/useAuth'
import { useEmployeeAttendance } from './hooks/useEmployeeAttendance'
import { useEmployeeLeave } from './hooks/useEmployeeLeave'
import { useTeam } from './hooks/useTeam'
import { useAdminAttendance } from './hooks/useAdminAttendance'
import { useAdminData } from './hooks/useAdminData'
import { useLeaveBalanceImport } from './hooks/useLeaveBalanceImport'
import { useDailyBioImport } from './hooks/useDailyBioImport'
import { useMonthlyBioImport } from './hooks/useMonthlyBioImport'

// Shell only: routing between login / employee / admin, and wiring each role's hooks
// into its feature tree. No business logic lives here — see lib/, api/ and hooks/.
//
// Note on audit trail: audit_logs no longer accepts inserts from the browser (plan.md
// §4.3 #3 — anyone could forge entries). Writes happen server-side, inside the
// SECURITY DEFINER functions that matter most (employee CRUD, leave decisions,
// settings, holidays, imports) via the database's log_audit() helper. Hooks still
// accept an onAudit callback for future local UI feedback, but nothing is passed here
// today — every call is a harmless no-op via `?.`.
export default function App() {
  const auth = useAuth()
  const [showAdminLogin, setShowAdminLogin] = useState(false)
  const [empTab, setEmpTab] = useState('today')

  const empAttendance = useEmployeeAttendance(auth.employeeToken, auth.currentUser?.id, auth.stdHours)
  const empLeave = useEmployeeLeave(auth.employeeToken, auth.currentUser?.id)
  const team = useTeam(auth.employeeToken, auth.currentUser?.id)

  const adminAttendance = useAdminAttendance(auth.adminToken, auth.stdHours)
  const admin = useAdminData(auth.adminToken, auth.stdHours, auth.setStdHours)
  const leaveBalanceImport = useLeaveBalanceImport(auth.adminToken, admin.employees, admin.setEmployees, admin.bulkUpsertLeaveBalances)
  const dailyBioImport = useDailyBioImport(auth.adminToken, admin.employees, admin.setEmployees, adminAttendance.attendance, adminAttendance.bulkUpsert, admin.stdHours)
  const monthlyBioImport = useMonthlyBioImport(auth.adminToken, admin.employees, admin.setEmployees, adminAttendance.attendance, adminAttendance.bulkUpsert, admin.stdHours)

  // Resolve a remembered session (localStorage "remember me") once the directory has
  // loaded — replicates the old app's auto-login without racing the initial fetch.
  // Must run as an effect, not during render: it has side effects (state writes).
  useEffect(() => {
    if (auth.restoredSession && !auth.employeeToken) {
      const { token, emp } = auth.restoredSession
      auth.loginAsEmployee(token, emp, true)
      auth.clearRestoredSession()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.restoredSession])

  if (auth.loading) return <Spinner />

  if (showAdminLogin && auth.view !== 'admin') {
    return <AdminLogin adminLogin={auth.adminLogin} onBack={() => setShowAdminLogin(false)} />
  }

  if (auth.view === 'admin') {
    return (
      <ErrorBoundary>
        <AdminPanel
          token={auth.adminToken}
          onLogout={async () => { await auth.adminLogout(); setShowAdminLogin(false) }}
          admin={admin}
          attendanceHook={adminAttendance}
          imports={{ leaveBalance: leaveBalanceImport, dailyBio: dailyBioImport, monthlyBio: monthlyBioImport }}
        />
      </ErrorBoundary>
    )
  }

  if (auth.view === 'employee' && auth.currentUser) {
    return (
      <ErrorBoundary>
        <EmployeeDashboard
          currentUser={auth.currentUser}
          empTab={empTab}
          setEmpTab={setEmpTab}
          onLogout={auth.employeeLogout}
          attendance={empAttendance.attendance}
          todayRecord={empAttendance.todayRecord}
          stdHours={auth.stdHours}
          punch={(type, currentUser) => empAttendance.punch(type, currentUser)}
          locationStatus={empAttendance.locationStatus}
          locationBlocked={empAttendance.locationBlocked}
          autoTrackingActive={empAttendance.autoTrackingActive}
          odTrackingActive={empAttendance.odTrackingActive}
          odTrackLog={empAttendance.odTrackLog}
          holidays={auth.holidays}
          regularizations={empLeave.regularizations}
          submitRegularization={empLeave.submitRegularization}
          leaves={empLeave.leaves}
          leaveBalances={empLeave.leaveBalances}
          availableLeaveTypes={empLeave.availableLeaveTypes}
          applyLeave={empLeave.applyLeave}
          onOdApplied={empAttendance.startOdTracking}
          team={{
            token: auth.employeeToken, myTeam: team.myTeam, teamLeaves: team.teamLeaves, teamRegs: team.teamRegs,
            teamAttn: team.teamAttn, teamLoading: team.teamLoading, loadTeamAttendance: team.loadTeamAttendance,
            decideLeave: team.decideLeave, decideRegularization: team.decideRegularization,
          }}
        />
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
      <LoginScreen
        directory={auth.directory}
        employeeLogin={auth.employeeLogin}
        onLoggedIn={(token, emp, remember) => {
          auth.loginAsEmployee(token, emp, remember)
          setEmpTab('today')
        }}
        onShowAdminLogin={() => setShowAdminLogin(true)}
      />
    </ErrorBoundary>
  )
}
