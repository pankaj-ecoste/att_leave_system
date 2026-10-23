import { describe, it, expect } from 'vitest'
import { rowsOfClaim, rowsForNewClaim, firstUnclaimedDate, groupByDate } from './claimRows'

// The Anirudh case: claim submitted at noon on 19 Oct (end date 19 Oct); a visit saved that afternoon is NOT in it.
const visits = [
  { id: 'a', date: '2026-10-17', claimId: 'c1' },
  { id: 'b', date: '2026-10-19', claimId: 'c1' }, // saved before the claim
  { id: 'c', date: '2026-10-19', claimId: null }, // saved AFTER the claim, same date
  { id: 'd', date: '2026-10-21', claimId: null },
]
const expenses = [
  { id: 'x', date: '2026-10-10', claimId: 'c1' },
  { id: 'y', date: '2026-10-22', claimId: null },
]

describe('rowsOfClaim', () => {
  it('is exactly the rows stamped with the claim — not every row dated inside its period', () => {
    const r = rowsOfClaim({ visits, expenses, claimId: 'c1' })
    expect(r.visits.map(v => v.id)).toEqual(['a', 'b'])
    expect(r.expenses.map(e => e.id)).toEqual(['x'])
    expect(r.dates).toEqual(['2026-10-10', '2026-10-17', '2026-10-19'])
  })
  it('a claim that owns nothing gives nothing', () => {
    expect(rowsOfClaim({ visits, expenses, claimId: 'none' }).dates).toEqual([])
  })
  it('copes with missing lists', () => expect(rowsOfClaim({ claimId: 'c1' }).dates).toEqual([]))
})

describe('rowsForNewClaim', () => {
  it('takes unclaimed rows up to the end date, including one saved later on an earlier claim\'s end date', () => {
    const r = rowsForNewClaim({ visits, expenses, endDate: '2026-10-21' })
    expect(r.visits.map(v => v.id)).toEqual(['c', 'd'])
    expect(r.expenses.map(e => e.id)).toEqual([])
    expect(r.dates).toEqual(['2026-10-19', '2026-10-21'])
  })
  it('never re-lists rows that already belong to a claim', () => {
    const r = rowsForNewClaim({ visits, expenses, endDate: '2026-10-30' })
    expect(r.visits.map(v => v.id)).not.toContain('a')
    expect(r.visits.map(v => v.id)).not.toContain('b')
    expect(r.expenses.map(e => e.id)).toEqual(['y'])
  })
  it('the end date is inclusive', () => {
    expect(rowsForNewClaim({ visits, expenses, endDate: '2026-10-19' }).visits.map(v => v.id)).toEqual(['c'])
  })
})

describe('firstUnclaimedDate', () => {
  it('is the earliest date with an unclaimed visit or expense (what the server counts 5 days from)', () => {
    expect(firstUnclaimedDate(visits, expenses)).toBe('2026-10-19')
  })
  it('an unclaimed expense before the first unclaimed visit counts too', () => {
    expect(firstUnclaimedDate([{ date: '2026-10-21', claimId: null }], [{ date: '2026-10-18', claimId: null }])).toBe('2026-10-18')
  })
  it('null when everything is claimed or empty', () => {
    expect(firstUnclaimedDate([{ date: '2026-10-21', claimId: 'c1' }], [])).toBeNull()
    expect(firstUnclaimedDate([], [])).toBeNull()
    expect(firstUnclaimedDate(undefined, undefined)).toBeNull()
  })
})

describe('groupByDate', () => {
  it('groups rows by their date', () => {
    const g = groupByDate(visits)
    expect(Object.keys(g)).toEqual(['2026-10-17', '2026-10-19', '2026-10-21'])
    expect(g['2026-10-19']).toHaveLength(2)
  })
})
