// plan.md §54 — the four employee fields that are dropdowns instead of free text. Pure helpers
// only (no React, no network) so the rules can be tested on their own.

// kind = the list name stored in dropdown_options; field = the key on the employee object
// (see mappers.js); required = must be picked when ADDING an employee.
export const DROPDOWN_LISTS = [
  { kind: 'job_title', field: 'jobTitle', label: 'Job Title' },
  { kind: 'department', field: 'dept', label: 'Department' },
  { kind: 'business_unit', field: 'bu', label: 'Business Unit' },
  { kind: 'location', field: 'locationInfo', label: 'Location' },
]

const squash = s => String(s ?? '').replace(/\s+/g, ' ').trim()

// Same tidy-up the server applies before saving a new option (norm_option in 0069).
export function tidyOption(text) { return squash(text) }

// Rows from the server -> { job_title: [{id, value, inUse}], ... }, each list A-Z.
export function groupOptions(rows) {
  const out = { job_title: [], department: [], business_unit: [], location: [] }
  for (const r of rows || []) if (out[r.kind]) out[r.kind].push(r)
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.value.localeCompare(b.value, undefined, { sensitivity: 'base' }))
  return out
}

// The values to show in a <select>. If the employee holds a value that is not in the list (an old
// value that HR has not decided on yet), it is kept in the list and flagged, so opening the form
// never silently blanks it.
export function selectValues(options, current) {
  const values = (options || []).map(o => ({ value: o.value, notInList: false }))
  const cur = squash(current)
  if (cur && !values.some(v => v.value === current)) values.unshift({ value: current, notInList: true })
  return values
}

// Match a typed/imported cell to a list value, ignoring case and extra spaces. null = no match.
export function matchOption(options, raw) {
  const key = squash(raw).toLowerCase()
  if (!key) return null
  const hit = (options || []).find(o => squash(o.value).toLowerCase() === key)
  return hit ? hit.value : null
}

// Labels of the dropdowns still empty on a NEW employee form.
export function missingRequired(form) {
  return DROPDOWN_LISTS.filter(l => !squash(form[l.field])).map(l => l.label)
}
