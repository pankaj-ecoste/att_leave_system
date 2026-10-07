import { describe, it, expect } from 'vitest'
import { validateExpenseInput, groupExpensesByDate, sumExpenses, allJourneyDates, dayExpenseTotal, EXPENSE_CATEGORIES } from './travelExpenses'

describe('validateExpenseInput', () => {
  const good = { category: 'Toll', amount: '120', hasPhoto: true }
  it('accepts a complete form', () => expect(validateExpenseInput(good)).toBeNull())
  it('offers exactly Toll, Lunch, Other', () => expect(EXPENSE_CATEGORIES).toEqual(['Toll', 'Lunch', 'Other']))
  it('needs a known type', () => {
    expect(validateExpenseInput({ ...good, category: '' })).toBe('Choose an expense type')
    expect(validateExpenseInput({ ...good, category: 'Petrol' })).toBe('Choose an expense type')
  })
  it('needs a positive number', () => {
    for (const amount of ['', null, undefined, '0', '-5', 'abc', NaN]) {
      expect(validateExpenseInput({ ...good, amount })).toBe('Enter a valid amount')
    }
  })
  it('accepts decimals', () => expect(validateExpenseInput({ ...good, amount: '99.5' })).toBeNull())
  it('rejects an absurd amount (stray zeros)', () => {
    expect(validateExpenseInput({ ...good, amount: '5000000' })).toBe('That amount looks too large — please check it')
    expect(validateExpenseInput({ ...good, amount: '100000' })).toBeNull()
  })
  it('needs the bill photo', () => expect(validateExpenseInput({ ...good, hasPhoto: false })).toBe('A bill photo is required'))
})

describe('grouping and totals', () => {
  const ex = [
    { date: '2026-10-01', amount: 100 }, { date: '2026-10-01', amount: 50.5 }, { date: '2026-10-03', amount: 200 },
  ]
  it('groups by date', () => {
    const g = groupExpensesByDate(ex)
    expect(Object.keys(g)).toEqual(['2026-10-01', '2026-10-03'])
    expect(g['2026-10-01']).toHaveLength(2)
  })
  it('handles empty/missing input', () => {
    expect(groupExpensesByDate(undefined)).toEqual({})
    expect(sumExpenses(null)).toBe(0)
  })
  it('sums amounts', () => expect(sumExpenses(ex)).toBeCloseTo(350.5))
  it('lists dates from visits and expenses together, sorted, no repeats', () => {
    const visits = [{ date: '2026-10-02' }, { date: '2026-10-01' }]
    expect(allJourneyDates(visits, ex)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
  })
  it('a day with only an expense still appears', () => expect(allJourneyDates([], ex)).toEqual(['2026-10-01', '2026-10-03']))
  it('day total = visit expenses + standalone expenses', () => {
    expect(dayExpenseTotal([{ expenseAmount: 40 }, { expenseAmount: null }], [{ amount: 10 }])).toBe(50)
  })
})
