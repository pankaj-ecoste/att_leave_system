// The Reporting Manager dropdown on the employee form. Any active employee can be anyone's manager,
// whichever company either of them is in (the manager functions in the database never look at the
// company — they use the manager link only), so one person such as Ankur Hora needs just one entry.

const shortCompany = c => String(c || '').split(' ')[0]

// Active employees except the person being edited, A-Z by name, each with a label that tells people
// apart: "Name (Job Title) · Company". The employee's own company is not hidden or preferred.
export function managerChoices(employees, selfId) {
  return (employees || [])
    .filter(e => e.active && e.id !== selfId)
    .slice()
    .sort((a, b) => a.name.trim().localeCompare(b.name.trim(), undefined, { sensitivity: 'base' }))
    .map(e => ({
      id: e.id,
      name: e.name.trim(),
      label: `${e.name.trim()}${e.jobTitle ? ` (${e.jobTitle})` : ''} · ${shortCompany(e.company)}`,
    }))
}
