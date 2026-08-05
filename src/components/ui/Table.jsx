// Thin styling wrapper, not a data-grid abstraction — each screen still defines its own
// columns/rows, this just keeps the borders/spacing/hover consistent everywhere so one
// table doesn't quietly drift from another.

export function TableWrap({ children }) {
  return <div className="overflow-x-auto rounded-xl border border-white/10">{children}</div>
}

export function Table({ children }) {
  return <table className="w-full text-sm text-left">{children}</table>
}

export function Thead({ children }) {
  return <thead className="bg-white/5 text-white/40 text-xs uppercase tracking-wide">{children}</thead>
}

export function Th({ children, className = '' }) {
  return <th className={`px-3 py-2.5 font-medium whitespace-nowrap ${className}`}>{children}</th>
}

export function Tbody({ children }) {
  return <tbody className="divide-y divide-white/5">{children}</tbody>
}

export function Td({ children, className = '' }) {
  return <td className={`px-3 py-2.5 text-white/80 whitespace-nowrap ${className}`}>{children}</td>
}

export function Tr({ children, ...props }) {
  return <tr className="hover:bg-white/[0.03] transition-colors" {...props}>{children}</tr>
}
