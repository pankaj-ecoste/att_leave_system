import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Dashboard } from './Dashboard'
import { Imports } from './Imports'
import { AttendanceGrid } from './AttendanceGrid'
import { LeaveApprovals } from './LeaveApprovals'
import { Employees } from './Employees'
import { Reports } from './Reports'
import { Database } from './Database'
import { Settings } from './Settings'
import { Sites } from './Sites'
import { todayIST } from '../../lib/datetime'

const TABS = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'attendance', label: 'Attendance' },
  { id: 'leaves', label: 'Leaves' },
  { id: 'employees', label: 'Employees' },
  { id: 'sites', label: 'Sites' },
  { id: 'reports', label: 'Reports' },
  { id: 'database', label: 'Database' },
  { id: 'settings', label: 'Settings' },
]

export function AdminPanel({ token, onLogout, admin, attendanceHook, imports, onAudit }) {
  const [tab, setTab] = useState('dashboard')

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      <div className="bg-gradient-to-r from-indigo-900/40 to-violet-900/40 border-b border-white/10 backdrop-blur-xl sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center">
              <span className="text-white font-bold text-sm">AD</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm">Admin Panel</p>
              <p className="text-white/30 text-xs">HRMS · {todayIST()}</p>
            </div>
          </div>
          <Button variant="secondary" className="text-xs" onClick={onLogout}>Logout</Button>
        </div>
        <div className="max-w-7xl mx-auto px-4 pb-0 flex gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-all ${tab === t.id ? 'border-indigo-400 text-white' : 'border-transparent text-white/40 hover:text-white/70'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="max-w-7xl mx-auto p-4 space-y-4">
        {tab === 'dashboard' && <Dashboard employees={admin.employees} leaves={admin.leaves} attendanceHook={attendanceHook} stdHours={admin.stdHours} todaysBirthdays={admin.todaysBirthdays} markBirthdayWished={admin.markBirthdayWished} />}
        {tab === 'attendance' && (
          <>
            <Imports leaveBalanceImport={imports.leaveBalance} dailyBioImport={imports.dailyBio} monthlyBioImport={imports.monthlyBio} />
            <AttendanceGrid employees={admin.employees} attendanceHook={attendanceHook} stdHours={admin.stdHours} updateStdHours={v => admin.updateSettings(v)} holidays={admin.holidays} />
          </>
        )}
        {tab === 'leaves' && <LeaveApprovals employees={admin.employees} leaves={admin.leaves} adminRegs={admin.adminRegs} decideLeave={admin.decideLeave} decideRegularization={admin.decideRegularization} onAudit={onAudit} />}
        {tab === 'employees' && <Employees employees={admin.employees} leaveBalances={admin.leaveBalances} createEmployee={admin.createEmployee} updateEmployee={admin.updateEmployee} setEmploymentStatus={admin.setEmploymentStatus} toggleEmployeeStatus={admin.toggleEmployeeStatus} deleteEmployee={admin.deleteEmployee} upsertLeaveBalance={admin.upsertLeaveBalance} bulkUpsertLeaveBalances={admin.bulkUpsertLeaveBalances} fetchEmployeeAssets={admin.fetchEmployeeAssets} upsertEmployeeAsset={admin.upsertEmployeeAsset} deleteEmployeeAsset={admin.deleteEmployeeAsset} markAssetsReturned={admin.markAssetsReturned} onAudit={onAudit} />}
        {tab === 'sites' && <Sites sites={admin.sites} createSite={admin.createSite} updateSite={admin.updateSite} deleteSite={admin.deleteSite} onAudit={onAudit} />}
        {tab === 'reports' && <Reports token={token} employees={admin.employees} stdHours={admin.stdHours} onAudit={onAudit} />}
        {tab === 'database' && <Database token={token} employees={admin.employees} attendanceHook={attendanceHook} leaves={admin.leaves} leaveBalances={admin.leaveBalances} auditLogs={admin.auditLogs} />}
        {tab === 'settings' && (
          <Settings
            employees={admin.employees} attendanceCount={Object.keys(attendanceHook.attendance).length} leaves={admin.leaves} auditLogs={admin.auditLogs}
            holidays={admin.holidays} stdHours={admin.stdHours} adminEmail={admin.adminEmail} birthdayMessage={admin.birthdayMessage} updateSettings={admin.updateSettings} resetLeaveBalancesForNewFY={admin.resetLeaveBalancesForNewFY}
            addHoliday={admin.addHoliday} deleteHoliday={admin.deleteHoliday} onAudit={onAudit}
            lastImports={{
              leaveBalance: imports.leaveBalance.sheet?.importedAt,
              dailyBio: imports.dailyBio.sheet?.importedAt,
              monthlyBio: imports.monthlyBio.sheet?.importedAt,
            }}
          />
        )}
      </div>
    </div>
  )
}
