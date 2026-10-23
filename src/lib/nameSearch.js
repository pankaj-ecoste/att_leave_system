// Search box for lists of employees (plan.md §50 follow-up): matches part of the name or the
// employee number, ignoring capitals and extra spaces. An empty box keeps everyone.
export function filterByNameOrNumber(rows, query, getName, getNum) {
  const words = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return rows
  return rows.filter(r => {
    const haystack = `${getName(r) || ''} ${getNum(r) || ''}`.toLowerCase()
    return words.every(w => haystack.includes(w))
  })
}
