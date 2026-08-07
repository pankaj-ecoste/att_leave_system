// Keep this list and tailwind.config.js's safelist pattern in sync — a color used by
// one but not the other is exactly how plan.md §4.5 #2 happened (blue/green were used
// here but missing from the safelist, so Tailwind never generated the classes).
const STAT_CARD_COLORS = {
  indigo: 'from-indigo-600/30 to-indigo-800/10 border-indigo-500/30 text-indigo-300',
  emerald: 'from-emerald-600/30 to-emerald-800/10 border-emerald-500/30 text-emerald-300',
  red: 'from-red-600/30 to-red-800/10 border-red-500/30 text-red-300',
  amber: 'from-amber-600/30 to-amber-800/10 border-amber-500/30 text-amber-300',
  yellow: 'from-yellow-600/30 to-yellow-800/10 border-yellow-500/30 text-yellow-300',
  purple: 'from-purple-600/30 to-purple-800/10 border-purple-500/30 text-purple-300',
  cyan: 'from-cyan-600/30 to-cyan-800/10 border-cyan-500/30 text-cyan-300',
  orange: 'from-orange-600/30 to-orange-800/10 border-orange-500/30 text-orange-300',
  blue: 'from-blue-600/30 to-blue-800/10 border-blue-500/30 text-blue-300',
  green: 'from-green-600/30 to-green-800/10 border-green-500/30 text-green-300',
}

export function StatCard({ label, value, color, sub, onClick, active }) {
  const classes = STAT_CARD_COLORS[color] || STAT_CARD_COLORS.indigo
  const textCol = classes.split(' ')[3]
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      onClick={onClick}
      className={`text-left bg-gradient-to-br ${classes} border rounded-2xl p-4 flex flex-col gap-1 hover:scale-[1.02] transition-transform ${onClick ? 'cursor-pointer' : ''} ${active ? 'ring-2 ring-white/60' : ''}`}
    >
      <span className="text-white/30 text-xs uppercase tracking-widest">{label}</span>
      <p className={`text-4xl font-bold mt-1 ${textCol}`}>{value}</p>
      {sub && <p className="text-white/30 text-xs">{sub}</p>}
    </Tag>
  )
}
