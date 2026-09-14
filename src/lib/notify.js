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

// plan.md §25 — probation -> Confirmed ("Fixed" in the UI) needs to open Gmail
// specifically, not whatever the PC's default mail app is, so this builds Gmail's own
// compose URL instead of a plain mailto: link. Pure function, same reasoning as
// buildLeaveNotifyMailto above. Wording is HR's own confirmation-letter template,
// verbatim except for the two placeholder dates (confirmedDate = when probation was
// completed, joiningDate = original date of joining — HR's draft had these swapped).
export function buildConfirmationGmailLink({ employeeName, employeeEmail, managerEmail, adminEmail, confirmedDate, joiningDate }) {
  const cc = [managerEmail, adminEmail].filter(Boolean).join(',')
  const subject = `Confirmation of Employment — ${employeeName}`
  // joiningDate isn't a required field on the employee record (plan.md §25) — when it's
  // missing, drop the clause entirely rather than emailing HR's letter with a literal
  // "since joining on null" in it.
  const thankYouLine = joiningDate
    ? `Thank you for your hard work and dedication since joining on ${joiningDate}. We look forward to your continued success with us.`
    : 'Thank you for your hard work and dedication. We look forward to your continued success with us.'
  const body = [
    `Dear ${employeeName},`,
    '',
    `We are pleased to inform you that you have successfully completed your probation period, effective ${confirmedDate}, and your full-time employment is now confirmed.`,
    '',
    'All other terms and conditions outlined in your original offer letter remain unchanged.',
    '',
    thankYouLine,
    '',
    'Congratulations!',
    '',
    'Best regards,',
    'HR',
  ].join('\n')
  const params = new URLSearchParams({ view: 'cm', fs: '1', to: employeeEmail || '', su: subject, body, tf: '1' })
  if (cc) params.set('cc', cc)
  return `https://mail.google.com/mail/?${params.toString()}`
}
