import { describe, it, expect } from 'vitest'
import {
  monthBounds, rankTop, graceRanking, leaveRanking, regularizationRanking, deviceResetRanking,
  visitsMonthRanking, visitsDayRanking, kmMonthRanking, lateOutRanking,
} from './analytics'

describe('monthBounds', () => {
  it('gives first and last day, including leap February and 30/31-day months', () => {
    expect(monthBounds('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' })
    expect(monthBounds('2026-09')).toEqual({ from: '2026-09-01', to: '2026-09-30' })
    expect(monthBounds('2028-02')).toEqual({ from: '2028-02-01', to: '2028-02-29' })
    expect(monthBounds('2026-02').to).toBe('2026-02-28')
  })
})

describe('rankTop', () => {
  it('sorts highest first, breaks ties by name, drops zeros, and caps the list', () => {
    const rows = [{ name: 'B', value: 3 }, { name: 'A', value: 3 }, { name: 'C', value: 5 }, { name: 'Z', value: 0 }, { name: 'Y', value: undefined }]
    expect(rankTop(rows).map(r => r.name)).toEqual(['C', 'A', 'B'])
    expect(rankTop(Array.from({ length: 15 }, (_, i) => ({ name: `n${i}`, value: i + 1 }))).length).toBe(10)
  })
  it('returns an empty list when nobody qualifies', () => {
    expect(rankTop([{ name: 'A', value: 0 }])).toEqual([])
  })
})

// 9h day: 09:00 -> 17:50 is 8h50m = 10 min short (inside the 15 min grace).
const emp = (id, name, extra = {}) => ({ id, name, company: 'Acme', ...extra })
const day = (empId, inTime, outTime, extra = {}) => ({ empId, inTime, outTime, ...extra })

describe('graceRanking', () => {
  const employees = [emp('a', 'Asha'), emp('b', 'Bala')]
  it('counts days that were 1-15 minutes short, and the minutes forgiven', () => {
    const r = graceRanking([
      day('a', '09:00', '17:50'), // 10 min short
      day('a', '09:00', '17:55'), // 5 min short
      day('b', '09:00', '17:50'),
      day('b', '09:00', '18:00'), // exactly 9h -> not short
    ], employees, 9)
    expect(r.map(x => [x.name, x.value])).toEqual([['Asha', 2], ['Bala', 1]])
    expect(r[0].detail).toBe('2 days · 15 min forgiven in total')
  })
  it('does not count a day more than 15 minutes short, a day with no punch-out, or full-day leave', () => {
    expect(graceRanking([day('a', '09:00', '17:30'), day('a', '09:00', null), day('a', null, null, { leaveType: 'Casual Leave' })], employees, 9)).toEqual([])
  })
  it("uses each person's own hours target when they have one", () => {
    // an 8h target: 09:00 -> 16:50 is 10 min short for them
    const r = graceRanking([day('a', '09:00', '16:50')], [emp('a', 'Asha', { stdHoursOverride: 8 })], 9)
    expect(r.map(x => x.value)).toEqual([1])
  })
  it('ignores records of people not in the list', () => {
    expect(graceRanking([day('zzz', '09:00', '17:50')], employees, 9)).toEqual([])
  })
})

describe('leaveRanking', () => {
  const L = (o) => ({ empId: 'a', empName: 'Asha', company: 'Acme', status: 'Approved', leaveType: 'Casual Leave', dayPart: 'full', date: '2026-10-05', ...o })
  it('counts approved real leave in the month; half days are 0.5', () => {
    const r = leaveRanking([L({}), L({ date: '2026-10-06', dayPart: 'first_half' }), L({ empId: 'b', empName: 'Bala' })], '2026-10-01', '2026-10-31')
    expect(r.map(x => [x.name, x.value])).toEqual([['Asha', 1.5], ['Bala', 1]])
    expect(r[0].detail).toContain('2 approved applications')
  })
  it('leaves out pending/rejected, other months, WFH, On Duty and hour-long Partial Leave', () => {
    const r = leaveRanking([
      L({ status: 'Pending' }), L({ status: 'Rejected' }), L({ date: '2026-09-30' }), L({ date: '2026-11-01' }),
      L({ leaveType: 'Work From Home' }), L({ leaveType: 'On Duty' }), L({ leaveType: 'Partial Leave - 1 Hour' }),
      L({ leaveType: 'Not A Real Type' }),
    ], '2026-10-01', '2026-10-31')
    expect(r).toEqual([])
  })
  it('counts LOP and Sick as time off', () => {
    const r = leaveRanking([L({ leaveType: 'LOP' }), L({ leaveType: 'Sick Leave', date: '2026-10-07' })], '2026-10-01', '2026-10-31')
    expect(r[0].value).toBe(2)
  })
})

describe('regularizationRanking', () => {
  const R = (o) => ({ empId: 'a', empName: 'Asha', company: 'Acme', status: 'Pending', createdAt: '2026-10-05T05:00:00Z', ...o })
  it('counts requests filed in the month, whatever their status, and how many were approved', () => {
    const r = regularizationRanking([R({}), R({ status: 'Approved' }), R({ status: 'Rejected' }), R({ empId: 'b', empName: 'Bala' })], '2026-10-01', '2026-10-31')
    expect(r.map(x => [x.name, x.value])).toEqual([['Asha', 3], ['Bala', 1]])
    expect(r[0].detail).toBe('3 requests filed, 1 approved')
  })
  it('uses the Indian filing date: late evening 30 Sep UTC is already 1 Oct in India', () => {
    const regs = [R({ createdAt: '2026-09-30T19:00:00Z' })]
    expect(regularizationRanking(regs, '2026-10-01', '2026-10-31')).toHaveLength(1)
    expect(regularizationRanking(regs, '2026-09-01', '2026-09-30')).toEqual([])
  })
  it('skips rows with no usable filing time', () => {
    expect(regularizationRanking([R({ createdAt: null }), R({ createdAt: 'junk' })], '2026-10-01', '2026-10-31')).toEqual([])
  })
})

describe('database-fact rankings', () => {
  it('device resets: ranks by this month, mentions the yearly total', () => {
    const r = deviceResetRanking([{ name: 'A', inRange: 1, total: 5 }, { name: 'B', inRange: 3, total: 3 }, { name: 'C', inRange: 0, total: 9 }])
    expect(r.map(x => x.name)).toEqual(['B', 'A'])
    expect(r[1].detail).toBe('1 reset this month · 5 in the last year')
  })
  it('visits per month, visits in the best single day, and km per month', () => {
    const rows = [
      { name: 'A', visits: 20, km: 150.26, bestDayVisits: 4, bestDayDate: '2026-10-03' },
      { name: 'B', visits: 25, km: 90.04, bestDayVisits: 7, bestDayDate: '2026-10-09' },
    ]
    expect(visitsMonthRanking(rows).map(x => x.name)).toEqual(['B', 'A'])
    expect(visitsDayRanking(rows).map(x => [x.name, x.value])).toEqual([['B', 7], ['A', 4]])
    expect(visitsDayRanking(rows)[0].detail).toBe('7 visits in one day, on 2026-10-09')
    expect(kmMonthRanking(rows).map(x => [x.name, x.value])).toEqual([['A', 150.3], ['B', 90]])
  })
  it('empty input gives empty lists', () => {
    expect(visitsMonthRanking(undefined)).toEqual([])
    expect(deviceResetRanking(undefined)).toEqual([])
  })
})

describe('lateOutRanking', () => {
  const employees = [emp('a', 'Asha'), emp('b', 'Bala')]
  it('counts days punched out strictly after 19:00 and remembers the latest time', () => {
    const r = lateOutRanking([
      day('a', '09:00', '19:30'), day('a', '09:00', '20:15'), day('a', '09:00', '19:00'), // 19:00 exactly is NOT beyond 7 pm
      day('b', '09:00', '19:01'),
      day('b', '09:00', '18:00'),
    ], employees)
    expect(r.map(x => [x.name, x.value])).toEqual([['Asha', 2], ['Bala', 1]])
    expect(r[0].detail).toBe('2 days after 7 pm · latest 20:15')
  })
  it('handles seconds in the time, missing punch-outs and unknown people', () => {
    expect(lateOutRanking([day('a', '09:00', '19:30:45'), day('a', '09:00', null), day('zzz', '09:00', '22:00')], employees).map(x => x.value)).toEqual([1])
  })
})
