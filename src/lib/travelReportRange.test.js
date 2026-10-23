import { describe, it, expect } from 'vitest'
import { filterReportRange } from './travelReportRange'

const journey = [
  { id: 'a', date: '2026-10-01' }, { id: 'b', date: '2026-10-03' }, { id: 'c', date: '2026-10-03' }, { id: 'd', date: '2026-10-08' },
]
const expenses = [{ id: 'x', date: '2026-10-03', amount: 10 }, { id: 'y', date: '2026-10-09', amount: 20 }]

describe('filterReportRange', () => {
  it('no dates = everything', () => {
    const r = filterReportRange({ journey, expenses })
    expect(r.dates).toEqual(['2026-10-01', '2026-10-03', '2026-10-08', '2026-10-09'])
    expect(r.periodLabel).toBe('2026-10-01 to 2026-10-09')
  })
  it('keeps only days inside the range, both ends included', () => {
    const r = filterReportRange({ from: '2026-10-03', to: '2026-10-08', journey, expenses })
    expect(r.dates).toEqual(['2026-10-03', '2026-10-08'])
    expect(r.journeyByDate['2026-10-03'].map(v => v.id)).toEqual(['b', 'c'])
    expect(r.expensesByDate['2026-10-03']).toHaveLength(1)
    expect(r.expensesByDate['2026-10-09']).toBeUndefined()
  })
  it('a single day works', () => {
    const r = filterReportRange({ from: '2026-10-03', to: '2026-10-03', journey, expenses })
    expect(r.dates).toEqual(['2026-10-03'])
    expect(r.rangeSuffix).toBe('2026-10-03_to_2026-10-03')
  })
  it('only a start date, or only an end date', () => {
    expect(filterReportRange({ from: '2026-10-08', journey, expenses }).dates).toEqual(['2026-10-08', '2026-10-09'])
    expect(filterReportRange({ to: '2026-10-01', journey, expenses }).dates).toEqual(['2026-10-01'])
  })
  it('a day with only an expense is included', () => {
    expect(filterReportRange({ from: '2026-10-09', to: '2026-10-09', journey, expenses }).dates).toEqual(['2026-10-09'])
  })
  it('refuses a start date after the end date', () => {
    expect(filterReportRange({ from: '2026-10-09', to: '2026-10-01', journey, expenses }).error).toBe('The start date is after the end date')
  })
  it('says so when nothing falls in the range', () => {
    expect(filterReportRange({ from: '2026-11-01', to: '2026-11-30', journey, expenses }).error).toBe('No travel or expenses between 2026-11-01 and 2026-11-30')
  })
  it('copes with missing lists', () => {
    expect(filterReportRange({ journey: undefined, expenses: undefined }).error).toBe('No travel or expenses')
  })
})
