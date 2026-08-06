// P4-6 (revised) — real transactional email needs DNS records on ecoste.in that were
// never granted (Q-2/Q-3). Manager and admin already see every pending leave the moment
// they open their own panel, so the email was only ever a nudge, not the data channel.
// This builds a mailto: link instead: the employee's own mail client sends it, addressed
// to the manager and the admin notification address together, with a link back into the
// app. Pure function — no network, no DOM — so it's testable on its own (§8C).
import { APP_URL, DAY_PARTS } from './constants'

export function buildLeaveNotifyMailto({ employeeName, leaveType, date, dayPart, reason, managerEmail, adminEmail }) {
  const to = [managerEmail, adminEmail].filter(Boolean).join(',')
  const durationLabel = DAY_PARTS.find(dp => dp.id === dayPart)?.label || 'Full Day'
  const subject = `Leave Application — ${employeeName} — ${leaveType} — ${date}`
  const body = [
    `${employeeName} has applied for ${leaveType} (${durationLabel}) on ${date}.`,
    '',
    `Reason: ${reason || '—'}`,
    '',
    'Please review and approve/reject in the HRMS app:',
    APP_URL,
  ].join('\n')
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}
