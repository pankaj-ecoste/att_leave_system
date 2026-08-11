// Display-only helpers — no business rules here, those live in datetime.js and the
// database. Kept separate so a change to how something *looks* can never accidentally
// change how it's *calculated*.

export function fmt2(n) {
  return String(n).padStart(2, '0')
}

export function fmtHrs(h) {
  if (h === null || h === undefined || h === '') return '--'
  const hh = Math.floor(Math.abs(h))
  const mm = Math.round((Math.abs(h) - hh) * 60)
  return `${hh}h ${fmt2(mm)}m`
}

const STATUS_STYLES = {
  Present: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', border: 'border-emerald-500/40', dot: 'bg-emerald-400' },
  'Half Day': { bg: 'bg-yellow-500/20', text: 'text-yellow-300', border: 'border-yellow-500/40', dot: 'bg-yellow-400' },
  Leave: { bg: 'bg-amber-500/20', text: 'text-amber-300', border: 'border-amber-500/40', dot: 'bg-amber-400' },
  'Half Day Leave': { bg: 'bg-orange-500/20', text: 'text-orange-300', border: 'border-orange-500/40', dot: 'bg-orange-400' },
  Absent: { bg: 'bg-red-500/20', text: 'text-red-300', border: 'border-red-500/40', dot: 'bg-red-400' },
  WFH: { bg: 'bg-indigo-500/20', text: 'text-indigo-300', border: 'border-indigo-500/40', dot: 'bg-indigo-400' },
  'On Duty': { bg: 'bg-purple-500/20', text: 'text-purple-300', border: 'border-purple-500/40', dot: 'bg-purple-400' },
  'Week Off': { bg: 'bg-slate-500/20', text: 'text-slate-300', border: 'border-slate-500/40', dot: 'bg-slate-400' },
  Holiday: { bg: 'bg-sky-500/20', text: 'text-sky-300', border: 'border-sky-500/40', dot: 'bg-sky-400' },
}
const DEFAULT_STATUS_STYLE = { bg: 'bg-white/10', text: 'text-white/60', border: 'border-white/20', dot: 'bg-white/40' }

export function statusStyle(status) {
  return STATUS_STYLES[status] || DEFAULT_STATUS_STYLE
}
