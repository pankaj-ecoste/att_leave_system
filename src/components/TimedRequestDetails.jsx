import { isTimedLeaveType, timesLabel } from '../lib/requestTimes'

// plan.md §60 — what an approver needs in front of them to verify an On Duty / Work From Home request:
// the tag, the hours the person asked for, and the location they captured when applying. Shows nothing for
// any other leave type and for old requests (no times), so it is safe to drop into any leave card.
export function TimedRequestDetails({ leave }) {
  if (!leave || !isTimedLeaveType(leave.leaveType)) return null
  const times = timesLabel(leave)
  const tone = leave.leaveType === 'On Duty'
    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
    : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
  return (
    <div className="mt-1.5 space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${tone}`}>{leave.leaveType === 'On Duty' ? 'On Duty' : 'WFH'}</span>
        {times
          ? <span className="text-white text-xs font-mono font-semibold">{times}</span>
          : <span className="text-white/30 text-xs">no times on this older request</span>}
      </div>
      {leave.location && <p className="text-white/40 text-xs">📍 {leave.location}</p>}
    </div>
  )
}
