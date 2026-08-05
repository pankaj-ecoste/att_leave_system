import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { PunchPanel } from './PunchPanel'
import { AttendanceHistory } from './AttendanceHistory'
import { LeaveApply } from './LeaveApply'
import { MonthlySummary } from './MonthlySummary'
import { TeamPanel } from '../manager/TeamPanel'
import { statusStyle } from '../../lib/format'
import { todayIST } from '../../lib/datetime'

export function EmployeeDashboard({
  currentUser, empTab, setEmpTab, onLogout,
  attendance, todayRecord, stdHours, punch, isPunching, locationStatus, locationBlocked, odTrackingActive, odTrackLog,
  holidays, sites, directory, regularizations, submitRegularization,
  leaves, leaveBalances, availableLeaveTypes, applyLeave, onOdApplied,
  team,
}) {
  const tabs = [
    { id: 'today', label: 'Work Status' },
    { id: 'leaves', label: 'Apply For' },
    { id: 'history', label: 'History' },
    { id: 'summary', label: 'Summary' },
    ...(team.myTeam.length > 0 ? [{ id: 'team', label: `My Team (${team.myTeam.length})` }] : []),
  ]
  const status = todayRecord.status || 'Absent'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      <div className="bg-gradient-to-r from-indigo-900/50 to-violet-900/50 border-b border-white/10 px-4 py-4 sticky top-0 z-40 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center font-bold text-white text-lg">
              {currentUser.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <p className="text-white font-bold">{currentUser.name}</p>
              <p className="text-white/40 text-xs">{currentUser.company?.split(' ').slice(0, 2).join(' ')} · {todayIST()}</p>
            </div>
          </div>
          <Button variant="secondary" className="text-xs" onClick={onLogout}>Logout</Button>
        </div>
      </div>
      <div className="max-w-2xl mx-auto p-4 space-y-4">
        <div className={`rounded-2xl p-4 border ${statusStyle(status).bg} ${statusStyle(status).border}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/50 text-xs uppercase tracking-wide mb-1">Today's Status</p>
              <Badge status={status} />
            </div>
          </div>
        </div>
        <div className="flex gap-2 bg-white/5 rounded-2xl p-1 border border-white/10">
          {tabs.map(t => (
            <button key={t.id} onClick={() => setEmpTab(t.id)} className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${empTab === t.id ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-lg' : 'text-white/50 hover:text-white/80'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {empTab === 'today' && (
          <PunchPanel
            currentUser={currentUser} record={todayRecord} stdHours={stdHours} holidays={holidays} sites={sites}
            punch={(type, opts) => punch(type, currentUser, opts)} isPunching={isPunching}
            locationStatus={locationStatus} locationBlocked={locationBlocked}
            odTrackingActive={odTrackingActive} odTrackLog={odTrackLog}
          />
        )}
        {empTab === 'history' && (
          <AttendanceHistory currentUser={currentUser} attendance={attendance} stdHours={stdHours} regularizations={regularizations} submitRegularization={submitRegularization} />
        )}
        {empTab === 'leaves' && (
          <LeaveApply currentUser={currentUser} leaves={leaves} balances={leaveBalances[currentUser.id] || {}} availableLeaveTypes={availableLeaveTypes} applyLeave={applyLeave} onOdApplied={onOdApplied} directory={directory} />
        )}
        {empTab === 'summary' && (
          <MonthlySummary currentUser={currentUser} attendance={attendance} stdHours={stdHours} holidays={holidays} />
        )}
        {empTab === 'team' && (
          <TeamPanel {...team} />
        )}
      </div>
    </div>
  )
}
