import { statusStyle } from '../../lib/format'

// Renders an attendance/leave status pill (Present, Absent, Half Day, Leave, ...).
// Color mapping lives in lib/format.js — this component is display only.
export function Badge({ status }) {
  const st = statusStyle(status)
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${st.bg} ${st.text} ${st.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
      {status}
    </span>
  )
}
