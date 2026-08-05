const inputClass = 'w-full bg-white/5 border border-white/15 rounded-xl px-3 py-2.5 text-white text-sm focus:outline-none focus:border-indigo-400 focus:bg-white/10 transition-all placeholder-white/20'
const labelClass = 'text-white/50 text-xs font-medium mb-1.5 block uppercase tracking-wide'

export function Label({ children, ...props }) {
  return <label className={labelClass} {...props}>{children}</label>
}

export function Input({ className = '', ...props }) {
  return <input className={`${inputClass} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return <select className={`${inputClass} ${className}`} {...props}>{children}</select>
}

export function Field({ label, children }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  )
}
