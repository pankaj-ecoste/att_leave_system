export function Card({ className = '', children, ...props }) {
  return (
    <div className={`bg-white/[0.06] backdrop-blur-xl rounded-2xl border border-white/10 p-5 ${className}`} {...props}>
      {children}
    </div>
  )
}
