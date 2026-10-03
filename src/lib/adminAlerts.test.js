import { describe, it, expect } from 'vitest'
import {
  probationCompleted, workAnniversariesToday, awaitingAdminApproval, countAdminAlerts,
  whatsappDigits, whatsappLink, birthdayWishText, anniversaryWishText,
  overdueRequests, missingDetails,
} from './adminAlerts'

const TODAY = '2026-10-03'

describe('whatsappDigits', () => {
  it('adds the India code to a plain 10-digit number', () => {
    expect(whatsappDigits('9876543210')).toBe('919876543210')
  })
  it('strips spaces, dashes, brackets and +', () => {
    expect(whatsappDigits('+91 98765-43210')).toBe('919876543210')
    expect(whatsappDigits('(98765) 43210')).toBe('919876543210')
  })
  it('drops a leading 0 trunk prefix', () => {
    expect(whatsappDigits('09876543210')).toBe('919876543210')
  })
  it('keeps an already-complete 91 number as is (no double 91)', () => {
    expect(whatsappDigits('919876543210')).toBe('919876543210')
  })
  it('keeps another country full number', () => {
    expect(whatsappDigits('+44 7911 123456')).toBe('447911123456')
  })
  it('rejects empty, too short and junk', () => {
    for (const v of [null, undefined, '', 'abc', '12345', '98765']) expect(whatsappDigits(v)).toBeNull()
  })
  it('rejects absurdly long strings', () => {
    expect(whatsappDigits('1234567890123456789')).toBeNull()
  })
  it('handles a number stored as a number', () => {
    expect(whatsappDigits(9876543210)).toBe('919876543210')
  })
})

describe('whatsappLink', () => {
  it('builds a wa.me link with the message encoded', () => {
    const link = whatsappLink('9876543210', 'Dear A,\nHappy Birthday! 🎂')
    expect(link.startsWith('https://wa.me/919876543210?text=')).toBe(true)
    expect(decodeURIComponent(link.split('text=')[1])).toBe('Dear A,\nHappy Birthday! 🎂')
  })
  it('returns null when there is no usable phone', () => {
    expect(whatsappLink('', 'hi')).toBeNull()
    expect(whatsappLink('12', 'hi')).toBeNull()
  })
})

describe('wish texts', () => {
  it('birthday wish carries the name and company, and is signed by HR', () => {
    const t = birthdayWishText({ name: 'Harsh Sharma', company: 'Metamask Design Solutions LLP' })
    expect(t).toContain('Dear Harsh Sharma,')
    expect(t).toContain('Happy Birthday')
    expect(t).toContain('Metamask Design Solutions LLP')
    expect(t).toContain('HR Team')
  })
  it('birthday wish still reads well with no company', () => {
    const t = birthdayWishText({ name: 'A', company: '' })
    expect(t).toContain('our company')
    expect(t.endsWith('\n')).toBe(false)
  })
  it('anniversary wish says how many years, singular for one', () => {
    expect(anniversaryWishText({ name: 'A', company: 'X', years: 1 })).toContain('completing 1 year with X')
    expect(anniversaryWishText({ name: 'A', company: 'X', years: 3 })).toContain('completing 3 years with X')
  })
})

describe('probationCompleted', () => {
  const emp = (o) => ({ id: o.id, active: true, employmentStatus: 'Probation', ...o })
  it('lists active Probation staff whose end date has arrived', () => {
    const r = probationCompleted([
      emp({ id: 1, probationEndDate: '2026-10-03' }),
      emp({ id: 2, probationEndDate: '2026-09-01' }),
      emp({ id: 3, probationEndDate: '2026-10-04' }),
    ], TODAY)
    expect(r.map(e => e.id)).toEqual([1, 2])
  })
  it('ignores people already Confirmed or inactive', () => {
    const r = probationCompleted([
      emp({ id: 1, employmentStatus: 'Confirmed', probationEndDate: '2026-01-01' }),
      emp({ id: 2, active: false, probationEndDate: '2026-01-01' }),
    ], TODAY)
    expect(r).toEqual([])
  })
  it('falls back to joining date + 3 months when the end date is missing', () => {
    const r = probationCompleted([emp({ id: 1, probationEndDate: null, joiningDate: '2026-06-01' })], TODAY)
    expect(r.map(e => e.id)).toEqual([1])
    expect(r[0].probationEndDate).toBe('2026-09-01')
  })
  it('survives empty input', () => {
    expect(probationCompleted(undefined, TODAY)).toEqual([])
  })
})

describe('workAnniversariesToday', () => {
  it('finds same month/day with at least one year done, and counts years', () => {
    const r = workAnniversariesToday([
      { id: 1, active: true, joiningDate: '2023-10-03' },
      { id: 2, active: true, joiningDate: '2025-10-03' },
    ], TODAY)
    expect(r.map(e => [e.id, e.years])).toEqual([[1, 3], [2, 1]])
  })
  it('skips someone who joined today or this year (0 years), other dates and inactive staff', () => {
    const r = workAnniversariesToday([
      { id: 1, active: true, joiningDate: '2026-10-03' },
      { id: 2, active: true, joiningDate: '2024-10-04' },
      { id: 3, active: false, joiningDate: '2024-10-03' },
      { id: 4, active: true, joiningDate: null },
    ], TODAY)
    expect(r).toEqual([])
  })
  it('a 29 Feb joiner gets nothing on a non-leap-year day', () => {
    expect(workAnniversariesToday([{ id: 1, active: true, joiningDate: '2024-02-29' }], '2026-02-28')).toEqual([])
  })
})

describe('awaitingAdminApproval + countAdminAlerts', () => {
  const leaves = [{ status: 'Pending' }, { status: 'Manager Approved' }, { status: 'Approved' }, { status: 'Rejected' }]
  const regs = [{ status: 'Pending' }, { status: 'Approved' }]
  it('counts what the admin can act on', () => {
    expect(awaitingAdminApproval(leaves, regs)).toEqual({ leaves: 2, regs: 1, total: 3 })
    expect(awaitingAdminApproval(undefined, undefined).total).toBe(0)
  })
  it('adds everything into one badge number; wished birthdays no longer count', () => {
    const employees = [
      { id: 1, active: true, employmentStatus: 'Probation', probationEndDate: '2026-09-01' },
      { id: 2, active: true, joiningDate: '2024-10-03' },
    ]
    const birthdays = [{ acked: false }, { acked: true }]
    expect(countAdminAlerts({ employees, leaves, regs, birthdays, today: TODAY })).toBe(1 + 1 + 1 + 3)
  })
})

describe('overdueRequests', () => {
  // TODAY = 2026-10-03 (IST)
  const leave = (appliedAt, status = 'Pending', name = 'A') => ({ appliedAt, status, empName: name, leaveType: 'Casual' })
  it('flags requests waiting 3+ days, oldest first, leave and correction together', () => {
    const r = overdueRequests(
      [leave('2026-09-30T05:00:00Z', 'Pending', 'P'), leave('2026-09-27T05:00:00Z', 'Manager Approved', 'Q'), leave('2026-10-01T05:00:00Z', 'Pending', 'R')],
      [{ createdAt: '2026-09-29T05:00:00Z', status: 'Pending', empName: 'S' }],
      TODAY,
    )
    expect(r.map(x => [x.name, x.days])).toEqual([['Q', 6], ['P', 3], ['S', 4]].sort((a, b) => b[1] - a[1]))
  })
  it('does not flag recent ones (under 3 days)', () => {
    expect(overdueRequests([leave('2026-10-01T05:00:00Z')], [], TODAY)).toEqual([])
  })
  it('ignores decided requests', () => {
    expect(overdueRequests([leave('2026-09-01T05:00:00Z', 'Approved'), leave('2026-09-01T05:00:00Z', 'Rejected')], [{ createdAt: '2026-09-01T05:00:00Z', status: 'Approved' }], TODAY)).toEqual([])
  })
  it('counts Indian calendar days: filed late on 30 Sep UTC is 1 Oct in India', () => {
    // 2026-09-30T19:00Z = 2026-10-01 00:30 IST -> 2 days old on 3 Oct, so NOT yet overdue
    expect(overdueRequests([leave('2026-09-30T19:00:00Z')], [], TODAY)).toEqual([])
    // 2026-09-30T17:00Z = 2026-09-30 22:30 IST -> 3 days old on 3 Oct -> overdue
    expect(overdueRequests([leave('2026-09-30T17:00:00Z')], [], TODAY)).toHaveLength(1)
  })
  it('skips rows with no usable filing time and survives empty input', () => {
    expect(overdueRequests([{ status: 'Pending' }, leave('garbage')], [{ status: 'Pending' }], TODAY)).toEqual([])
    expect(overdueRequests(undefined, undefined, TODAY)).toEqual([])
  })
})

describe('missingDetails', () => {
  const ok = { active: true, phone: '9876543210', dateOfBirth: '1990-01-01', email: 'a@b.com' }
  it('lists exactly what each active person is missing, sorted by name', () => {
    const r = missingDetails([
      { id: 2, name: 'Zed', ...ok, phone: '' },
      { id: 1, name: 'Amy', ...ok, dateOfBirth: null, email: '  ' },
      { id: 3, name: 'Fine', ...ok },
    ])
    expect(r.map(x => [x.name, x.missing])).toEqual([['Amy', ['birthday', 'email']], ['Zed', ['phone']]])
  })
  it('treats an invalid phone as missing', () => {
    expect(missingDetails([{ id: 1, name: 'A', ...ok, phone: '12345' }])[0].missing).toEqual(['phone'])
  })
  it('skips inactive staff and survives empty input', () => {
    expect(missingDetails([{ id: 1, name: 'Gone', active: false }])).toEqual([])
    expect(missingDetails(undefined)).toEqual([])
  })
})
