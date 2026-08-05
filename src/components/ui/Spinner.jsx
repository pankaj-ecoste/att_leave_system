export function Spinner({ label = 'Loading System...', sub = 'HRMS' }) {
  return (
    <div className="fixed inset-0 bg-slate-950 flex items-center justify-center z-50">
      <div className="text-center">
        <div className="relative w-20 h-20 mx-auto mb-4">
          <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full" />
          <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <div
            className="absolute inset-3 border-4 border-violet-500 border-b-transparent rounded-full animate-spin"
            style={{ animationDirection: 'reverse', animationDuration: '0.8s' }}
          />
        </div>
        <p className="text-white font-semibold text-lg">{label}</p>
        <p className="text-white/40 text-sm mt-1">{sub}</p>
      </div>
    </div>
  )
}
