import { describe, it, expect } from 'vitest'
import { buildLeaveNotifyMailto } from './notify'

const base = {
  employeeName: 'Asha Rao',
  leaveType: 'Casual Leave',
  date: '2026-08-10',
  dayPart: 'full',
  reason: 'Family function',
  managerEmail: 'manager@ecoste.in',
  adminEmail: 'admin@ecoste.in',
}

describe('buildLeaveNotifyMailto', () => {
  it('addresses both the manager and admin', () => {
    const link = buildLeaveNotifyMailto(base)
    expect(link.startsWith('mailto:manager@ecoste.in,admin@ecoste.in?')).toBe(true)
  })

  it('falls back to whichever address is present when the other is missing', () => {
    expect(buildLeaveNotifyMailto({ ...base, managerEmail: null }).startsWith('mailto:admin@ecoste.in?')).toBe(true)
    expect(buildLeaveNotifyMailto({ ...base, adminEmail: null }).startsWith('mailto:manager@ecoste.in?')).toBe(true)
  })

  it('encodes the subject and includes the app link in the body', () => {
    const link = buildLeaveNotifyMailto(base)
    expect(link).toContain(encodeURIComponent('Leave Application — Asha Rao — Casual Leave — 2026-08-10'))
    expect(decodeURIComponent(link.split('body=')[1])).toContain('https://att-leave-system.vercel.app')
  })

  it('names the half-day duration when dayPart is not full', () => {
    const link = buildLeaveNotifyMailto({ ...base, dayPart: 'first_half' })
    expect(decodeURIComponent(link.split('body=')[1])).toContain('First Half')
  })
})
