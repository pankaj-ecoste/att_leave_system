import { describe, it, expect } from 'vitest'
import { regularizationQuota, istMonthOf } from './regularizationQuota'

const req = (createdAt, status = 'Pending') => ({ createdAt, status })

describe('istMonthOf', () => {
  it('uses the Indian month, not the UTC month', () => {
    // 30 Sep 20:00 UTC is already 1 Oct 01:30 in India
    expect(istMonthOf('2026-09-30T20:00:00Z')).toBe('2026-10')
    expect(istMonthOf('2026-09-30T18:00:00Z')).toBe('2026-09')
  })
  it('returns null for a bad timestamp', () => expect(istMonthOf('nope')).toBeNull())
})

describe('regularizationQuota', () => {
  it('counts nothing for no requests', () => {
    expect(regularizationQuota([], '2026-10-03')).toEqual({ used: 0, limit: 5, left: 5, reached: false })
    expect(regularizationQuota(undefined, '2026-10-03').used).toBe(0)
  })
  it('counts only this month', () => {
    const regs = [req('2026-10-01T05:00:00Z'), req('2026-10-02T05:00:00Z'), req('2026-09-28T05:00:00Z')]
    expect(regularizationQuota(regs, '2026-10-03').used).toBe(2)
  })
  it('counts rejected and approved requests the same as pending ones', () => {
    const regs = [req('2026-10-01T05:00:00Z', 'Rejected'), req('2026-10-01T06:00:00Z', 'Approved'), req('2026-10-01T07:00:00Z', 'Pending')]
    expect(regularizationQuota(regs, '2026-10-03').used).toBe(3)
  })
  it('is reached at exactly 5 and never goes below 0 left', () => {
    const five = Array.from({ length: 5 }, (_, i) => req(`2026-10-0${i + 1}T05:00:00Z`))
    expect(regularizationQuota(five, '2026-10-09')).toMatchObject({ used: 5, left: 0, reached: true })
    expect(regularizationQuota([...five, req('2026-10-08T05:00:00Z')], '2026-10-09')).toMatchObject({ used: 6, left: 0, reached: true })
  })
  it('4 used is not reached', () => {
    const four = Array.from({ length: 4 }, (_, i) => req(`2026-10-0${i + 1}T05:00:00Z`))
    expect(regularizationQuota(four, '2026-10-09')).toMatchObject({ used: 4, left: 1, reached: false })
  })
  it('resets on the 1st (IST): last night in India belongs to the old month', () => {
    const regs = [req('2026-09-30T18:00:00Z')] // 30 Sep 23:30 IST
    expect(regularizationQuota(regs, '2026-09-30').used).toBe(1)
    expect(regularizationQuota(regs, '2026-10-01').used).toBe(0)
  })
  it('ignores rows with no timestamp', () => {
    expect(regularizationQuota([{ status: 'Pending' }, null], '2026-10-03').used).toBe(0)
  })
})
