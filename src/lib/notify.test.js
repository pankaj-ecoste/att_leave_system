import { describe, it, expect } from 'vitest'
import { buildLeaveNotifyMailto, buildConfirmationGmailLink } from './notify'

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

describe('buildConfirmationGmailLink', () => {
  const confirmBase = {
    employeeName: 'Asha Rao',
    employeeEmail: 'asha@ecoste.in',
    managerEmail: 'manager@ecoste.in',
    adminEmail: 'admin@ecoste.in',
    confirmedDate: '2026-09-14',
    joiningDate: '2026-06-14',
  }

  it('always opens mail.google.com, not a generic mailto: link', () => {
    const link = buildConfirmationGmailLink(confirmBase)
    expect(link.startsWith('https://mail.google.com/mail/?')).toBe(true)
  })

  it('addresses the employee directly, cc-ing manager and admin', () => {
    const link = buildConfirmationGmailLink(confirmBase)
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('to')).toBe('asha@ecoste.in')
    expect(params.get('cc')).toBe('manager@ecoste.in,admin@ecoste.in')
  })

  it('falls back to whichever cc address is present when the other is missing', () => {
    const link = buildConfirmationGmailLink({ ...confirmBase, managerEmail: null })
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('cc')).toBe('admin@ecoste.in')
  })

  it('omits cc entirely when neither manager nor admin email is on file', () => {
    const link = buildConfirmationGmailLink({ ...confirmBase, managerEmail: null, adminEmail: null })
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.has('cc')).toBe(false)
  })

  it('includes the employee name and confirmed date in the subject/body', () => {
    const link = buildConfirmationGmailLink(confirmBase)
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('su')).toContain('Asha Rao')
    expect(params.get('body')).toContain('effective 2026-09-14')
  })

  it('names the original joining date, not the confirmation date, in the thank-you line', () => {
    const link = buildConfirmationGmailLink(confirmBase)
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('body')).toContain('since joining on 2026-06-14')
  })

  it('drops the joining-date clause instead of printing "null" when joiningDate is missing', () => {
    const link = buildConfirmationGmailLink({ ...confirmBase, joiningDate: null })
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('body')).not.toContain('null')
    expect(params.get('body')).not.toContain('joining on')
    expect(params.get('body')).toContain('Thank you for your hard work and dedication.')
  })

  it('leaves "to" blank instead of "null"/"undefined" when the employee has no email on file', () => {
    const link = buildConfirmationGmailLink({ ...confirmBase, employeeEmail: null })
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('to')).toBe('')
  })
})
