import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { claimEmailText, claimGmailUrl, CLAIM_TO, CLAIM_CC, buildTravelReportWorkbook } from './travelReport'

describe('claimEmailText', () => {
  it('writes subject, body and the attachment line', () => {
    const { subject, body } = claimEmailText({
      name: 'Puneet Sharma', empNum: '1171', periodStart: '2026-09-21', periodEnd: '2026-09-27',
      totalKm: 120.5, totalExpense: 300, amount: 1505, fileName: 'travel_allowance.xlsx',
    })
    expect(subject).toBe('Travel Allowance Claim — Puneet Sharma (#1171) — 2026-09-21 to 2026-09-27')
    expect(body).toContain('Total distance: 120.50 km')
    expect(body).toContain('Claim amount: ₹1505.00')
    expect(body).toContain('Attached file: travel_allowance.xlsx')
  })
})

describe('claimGmailUrl', () => {
  it('opens Gmail compose with To, both CCs, subject and body, all encoded', () => {
    const url = new URL(claimGmailUrl({ subject: 'Hi & bye', body: 'line one\nline two' }))
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/')
    expect(url.searchParams.get('view')).toBe('cm')
    expect(url.searchParams.get('to')).toBe(CLAIM_TO)
    expect(url.searchParams.get('cc')).toBe(CLAIM_CC.join(','))
    expect(url.searchParams.get('su')).toBe('Hi & bye')
    expect(url.searchParams.get('body')).toBe('line one\nline two')
  })
})

describe('buildTravelReportWorkbook — standalone expenses (plan.md §48)', () => {
  const employee = { name: 'Test', empNum: '1', taRateTier: 'executive' }
  const visit = { id: 'v1', date: '2026-10-01', capturedAt: '2026-10-01T05:00:00Z', siteNote: 'Site A', lat: 28.6, lon: 77.2, legDistanceKm: 10, roadLegKm: null, distanceOverridden: false, expenseAmount: 40, expenseNote: 'Tea' }
  const toll = { id: 'x1', date: '2026-10-01', capturedAt: '2026-10-01T09:00:00Z', category: 'Toll', amount: 150.5 }
  const lunch = { id: 'x2', date: '2026-10-02', capturedAt: '2026-10-02T07:00:00Z', category: 'Lunch', amount: 200 }

  it('adds each expense as its own row with type, date and amount, and counts it in the totals', () => {
    const { wb, totalExpense } = buildTravelReportWorkbook({
      employee, dates: ['2026-10-01'], journeyByDate: { '2026-10-01': [visit] }, attnByDate: {}, rate: 5,
      expensesByDate: { '2026-10-01': [toll] },
    })
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Day-wise Journey'])
    const exp = rows.find(r => r.Type === 'Expense')
    expect(exp).toMatchObject({ Date: '2026-10-01', 'Expense Note': 'Toll', 'Expense Amount (₹)': '150.50' })
    expect(totalExpense).toBeCloseTo(190.5) // 40 visit expense + 150.50 toll
    const summary = XLSX.utils.sheet_to_json(wb.Sheets['Summary'])[0]
    expect(summary['Total Expenses (₹)']).toBe('190.50')
  })

  it('puts the expense after the visit when it was paid later (time order)', () => {
    const { wb } = buildTravelReportWorkbook({
      employee, dates: ['2026-10-01'], journeyByDate: { '2026-10-01': [visit] }, attnByDate: {}, rate: 5,
      expensesByDate: { '2026-10-01': [toll] },
    })
    const types = XLSX.utils.sheet_to_json(wb.Sheets['Day-wise Journey']).map(r => r.Type)
    expect(types).toEqual(['Visit', 'Expense'])
  })

  it('includes a day that has only an expense and no visit', () => {
    const { wb, totalExpense, totalKm } = buildTravelReportWorkbook({
      employee, dates: ['2026-10-02'], journeyByDate: {}, attnByDate: {}, rate: 5,
      expensesByDate: { '2026-10-02': [lunch] },
    })
    expect(XLSX.utils.sheet_to_json(wb.Sheets['Day-wise Journey'])).toHaveLength(1)
    expect(totalExpense).toBe(200)
    expect(totalKm).toBe(0)
  })

  it('works unchanged when there are no standalone expenses', () => {
    const { totalExpense } = buildTravelReportWorkbook({
      employee, dates: ['2026-10-01'], journeyByDate: { '2026-10-01': [visit] }, attnByDate: {}, rate: 5,
    })
    expect(totalExpense).toBe(40)
  })
})
