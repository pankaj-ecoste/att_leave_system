// Pure logic behind the admin "Needs your attention" panel (plan.md §42): who completed
// probation, whose birthday / work anniversary is today, what is waiting for the admin, and
// the WhatsApp wish links. No browser or database calls here, so every case is unit-tested.
import { effectiveProbationEnd } from './datetime'

// Active employees still tagged Probation whose 3 months are up (plan.md §25 — notify on
// actual completion, not early). Same rule the Employees tab banner uses; both call this so
// they can never disagree. An inactive person is skipped (they left during probation — no
// reason to nag HR about them forever).
export function probationCompleted(employees, today) {
  return (employees || [])
    .filter(e => e && e.active !== false && e.employmentStatus === 'Probation')
    .map(e => ({ ...e, probationEndDate: effectiveProbationEnd(e.probationEndDate, e.joiningDate) }))
    .filter(e => e.probationEndDate && e.probationEndDate <= today)
}

// Active employees whose joining date falls on today's month+day, with at least one full
// year completed. `today` is 'YYYY-MM-DD'. (29 Feb joiners simply get no anniversary in a
// non-leap year — better to miss one than to wish on the wrong day.)
export function workAnniversariesToday(employees, today) {
  const [year, month, day] = String(today).split('-')
  return (employees || [])
    .filter(e => e && e.active !== false && e.joiningDate)
    .map(e => {
      const [jy, jm, jd] = String(e.joiningDate).slice(0, 10).split('-')
      return { e, years: Number(year) - Number(jy), same: jm === month && jd === day }
    })
    .filter(x => x.same && x.years >= 1)
    .map(x => ({ ...x.e, years: x.years }))
}

// Leaves and correction requests the ADMIN can act on right now — the same filter
// LeaveApprovals.jsx uses ('Pending' or legacy 'Manager Approved').
export function awaitingAdminApproval(leaves, regs) {
  const l = (leaves || []).filter(x => x && (x.status === 'Pending' || x.status === 'Manager Approved')).length
  const r = (regs || []).filter(x => x && x.status === 'Pending').length
  return { leaves: l, regs: r, total: l + r }
}

// Everything on the panel in one number, for the badge on the Dashboard tab.
export function countAdminAlerts({ employees, leaves, regs, birthdays, today }) {
  const waiting = awaitingAdminApproval(leaves, regs).total
  const bdaysOpen = (birthdays || []).filter(b => !b.acked).length
  return probationCompleted(employees, today).length + workAnniversariesToday(employees, today).length + bdaysOpen + waiting
}

// Turn a stored phone number into the digits WhatsApp's link needs (country code included,
// no + or spaces). Indian numbers are the norm here: 10 digits -> add 91; 91XXXXXXXXXX and
// 0XXXXXXXXXX are tidied. Anything that can't be a real number returns null so the button
// can say "no phone on file" instead of opening a broken chat.
export function whatsappDigits(phone) {
  let d = String(phone ?? '').replace(/\D/g, '')
  if (!d) return null
  d = d.replace(/^0+/, '') // trunk prefix (09876543210)
  if (d.length === 10) return `91${d}`
  if (d.length === 12 && d.startsWith('91')) return d
  if (d.length >= 11 && d.length <= 15 && !d.startsWith('0')) return d // another country's full number
  return null
}

// WhatsApp's own click-to-chat link: opens a chat with the person and the message already
// typed. It does NOT send anything — the admin still presses Send in WhatsApp.
export function whatsappLink(phone, text) {
  const digits = whatsappDigits(phone)
  if (!digits) return null
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
}

export function birthdayWishText({ name, company }) {
  return [
    `Dear ${name},`,
    '',
    'Wishing you a very Happy Birthday! 🎂',
    '',
    `On behalf of everyone at ${company || 'our company'}, thank you for your dedication and valuable contribution. May the year ahead bring you good health, happiness and continued success.`,
    '',
    'Warm regards,',
    'HR Team',
    company || '',
  ].filter((line, i, arr) => !(line === '' && i === arr.length - 1)).join('\n')
}

export function anniversaryWishText({ name, company, years }) {
  const span = years === 1 ? '1 year' : `${years} years`
  return [
    `Dear ${name},`,
    '',
    `Congratulations on completing ${span} with ${company || 'us'}! 🎉`,
    '',
    'Thank you for your commitment and the contribution you have made to the team. We look forward to many more successful years together.',
    '',
    'Warm regards,',
    'HR Team',
    company || '',
  ].filter((line, i, arr) => !(line === '' && i === arr.length - 1)).join('\n')
}
