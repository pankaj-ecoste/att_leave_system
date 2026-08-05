export function Modal({ open, onClose, title, children, wide = false }) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className={`bg-slate-900 border border-white/10 rounded-2xl p-6 w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold text-lg">{title}</h3>
            <button className="text-white/40 hover:text-white text-xl leading-none" onClick={onClose}>
              &times;
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}
