const VARIANTS = {
  primary: 'px-4 py-2 rounded-xl text-sm font-semibold bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white transition-all shadow-lg shadow-indigo-500/20 active:scale-95',
  secondary: 'px-4 py-2 rounded-xl text-sm font-medium bg-white/10 hover:bg-white/20 text-white/80 border border-white/10 transition-all active:scale-95',
  danger: 'px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 transition-all',
}

export function Button({ variant = 'primary', className = '', disabled, children, ...props }) {
  return (
    <button
      className={`${VARIANTS[variant] || VARIANTS.primary} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  )
}
