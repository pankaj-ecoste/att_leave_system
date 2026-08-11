// Generic helpers shared by Excel importers: pulling a value out of a row by trying
// several possible column-name spellings, and matching an import row against the
// current employee list by code or name.

export function normCode(c) {
  return String(c || '').trim()
}

// Pulls a value out of an imported spreadsheet row by trying several possible
// column-name spellings (exports from different sources label the same field
// differently — "Emp Code" vs "EmpCode" vs "EMP CODE").
export function gField(row, ...keys) {
  for (const k of keys) {
    if (row[k] !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim()
    const kn = k.toLowerCase().replace(/[\s._]/g, '')
    for (const rk of Object.keys(row)) {
      if (rk.toLowerCase().replace(/[\s._]/g, '') === kn && String(row[rk]).trim() !== '') {
        return String(row[rk]).trim()
      }
    }
  }
  return ''
}

// Finds the best-matching employee for a given code/name pair, trying an exact code
// match first, then exact name match, then first-name match.
export function findEmpInSnap(codeRaw, nameRaw, snap) {
  const code = normCode(codeRaw)
  const name = String(nameRaw || '').trim().toLowerCase()
  let emp = null
  if (code) {
    emp = snap.find(e =>
      e.empNum && (
        e.empNum === code ||
        e.empNum.replace(/^0+/, '') === code.replace(/^0+/, '') ||
        String(parseInt(e.empNum, 10)) === String(parseInt(code, 10))
      )
    )
  }
  if (!emp && name.length > 2) emp = snap.find(e => e.name && e.name.trim().toLowerCase() === name)
  if (!emp && name.length > 2) {
    const fw = name.split(/\s+/)[0]
    if (fw.length > 2) emp = snap.find(e => e.name && e.name.toLowerCase().startsWith(fw))
  }
  return emp || null
}
