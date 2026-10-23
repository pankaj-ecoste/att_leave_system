import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import { claimEmailText, claimGmailUrl, CLAIM_TO, CLAIM_CC, buildTravelReportModel, buildReportWorkbook, reportSheetName, reportTime } from './travelReport'

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

// ---------------------------------------------------------------------------
// plan.md §50 — one formatted sheet per person
// ---------------------------------------------------------------------------
const employee = { name: 'Himanshu Bansal', empNum: '1171', taRateTier: 'manager' }
const rate = 10
const visit1 = { id: 'v1', date: '2026-10-01', capturedAt: '2026-10-01T05:00:00Z', siteNote: 'Site A', lat: 28.6, lon: 77.2, legDistanceKm: 10, roadLegKm: 12, distanceOverridden: false, expenseAmount: 40, expenseNote: 'Tea' }
const visit2 = { id: 'v2', date: '2026-10-01', capturedAt: '2026-10-01T08:00:00Z', siteNote: 'Site B', lat: 28.7, lon: 77.3, legDistanceKm: 5, roadLegKm: null, distanceOverridden: false, expenseAmount: null, expenseNote: '' }
const toll = { id: 'x1', date: '2026-10-01', capturedAt: '2026-10-01T06:30:00Z', category: 'Toll', description: null, amount: 150.5 }
const day2visit = { id: 'v3', date: '2026-10-02', capturedAt: '2026-10-02T05:00:00Z', siteNote: 'Site C', lat: 28.6, lon: 77.2, legDistanceKm: 7.5, roadLegKm: null, distanceOverridden: false, expenseAmount: null, expenseNote: '' }
const other = { id: 'x2', date: '2026-10-02', capturedAt: '2026-10-02T07:00:00Z', category: 'Other', description: 'parking', amount: 60 }
const attn = {
  '2026-10-01': { inTime: '09:00', inLocation: 'Office', inLat: 28.5, inLon: 77.1, outTime: '18:00', outLocation: 'Home', outLat: 28.5, outLon: 77.1, travelReturnRoadKm: 20 },
}
const baseArgs = {
  employee, rate, periodLabel: '2026-10-01 to 2026-10-02', dates: ['2026-10-01', '2026-10-02'],
  journeyByDate: { '2026-10-01': [visit1, visit2], '2026-10-02': [day2visit] },
  attnByDate: attn, expensesByDate: { '2026-10-01': [toll], '2026-10-02': [other] },
}

describe('buildTravelReportModel — the numbers', () => {
  const m = buildTravelReportModel(baseArgs)
  const d1 = m.days[0]
  const d2 = m.days[1]

  it('day km = visits (road distance when known) + the return leg', () => {
    expect(d1.dayKm).toBe(12 + 5 + 20)
    expect(d2.dayKm).toBe(7.5)
  })
  it('day distance amount = day km × rate', () => {
    expect(d1.dayDistanceAmount).toBe(370)
    expect(d2.dayDistanceAmount).toBe(75)
  })
  it('day expenses = visit expense + standalone expenses', () => {
    expect(d1.dayExpense).toBeCloseTo(190.5)
    expect(d2.dayExpense).toBe(60)
  })
  it('day total = day distance amount + day expenses', () => {
    expect(d1.dayTotal).toBeCloseTo(560.5)
    expect(d2.dayTotal).toBe(135)
  })
  it('totals add up: km, distance amount, expenses, final', () => {
    expect(m.totals.totalKm).toBe(44.5)
    expect(m.totals.distanceAmount).toBe(445)
    expect(m.totals.totalExpense).toBeCloseTo(250.5)
    expect(m.totals.grandTotal).toBeCloseTo(695.5)
    expect(m.totals.grandTotal).toBeCloseTo(d1.dayTotal + d2.dayTotal)
  })
  it('rounds the final distance amount once (same rule as the claim)', () => {
    const odd = buildTravelReportModel({ ...baseArgs, rate: 7.33 })
    expect(odd.totals.distanceAmount).toBe(Math.round(44.5 * 7.33 * 100) / 100)
  })
  it('lists the day in order: punch in, then time-ordered visits and expenses, then punch out', () => {
    expect(d1.lines.map(l => l.type)).toEqual(['Punch In', 'Visit', 'Expense', 'Visit', 'Punch Out'])
  })
  it('shows the "Other" description on its expense line', () => {
    expect(d2.lines.find(l => l.type === 'Expense').expenseNote).toBe('Other – parking')
  })
  it('a day with only an expense still gets a total', () => {
    const only = buildTravelReportModel({ employee, rate, dates: ['2026-10-05'], journeyByDate: {}, attnByDate: {}, expensesByDate: { '2026-10-05': [{ ...other, date: '2026-10-05' }] } })
    expect(only.days[0].dayKm).toBe(0)
    expect(only.days[0].dayTotal).toBe(60)
    expect(only.totals.grandTotal).toBe(60)
  })
  it('works with no standalone expenses and no attendance record', () => {
    const plain = buildTravelReportModel({ employee, rate, dates: ['2026-10-02'], journeyByDate: { '2026-10-02': [day2visit] }, attnByDate: {} })
    expect(plain.totals).toMatchObject({ totalKm: 7.5, distanceAmount: 75, totalExpense: 0, grandTotal: 75 })
  })
})

describe('reportTime', () => {
  it('shows Indian time as hh:mm AM/PM', () => {
    expect(reportTime('2026-10-20T05:10:00Z')).toBe('10:40 AM')
    expect(reportTime('2026-10-20T13:40:00Z')).toBe('07:10 PM')
  })
})

describe('reportSheetName', () => {
  it('uses the name', () => expect(reportSheetName('Himanshu Bansal')).toBe('Himanshu Bansal'))
  it('removes characters Excel forbids and trims', () => expect(reportSheetName('  A/B:C*D?[E]\\F ')).toBe('A B C D E F'))
  it('cuts to 31 characters', () => expect(reportSheetName('x'.repeat(50))).toHaveLength(31))
  it('falls back when empty', () => expect(reportSheetName('  ')).toBe('Travel Report'))
})

describe('buildReportWorkbook — the actual sheet', () => {
  const { wb } = buildReportWorkbook(ExcelJS, baseArgs)
  const ws = wb.worksheets[0]
  const rows = []
  ws.eachRow({ includeEmpty: false }, (row, n) => rows.push({ n, vals: row.values.slice(1) }))
  const find = text => rows.find(r => r.vals.some(v => typeof v === 'string' && v.includes(text)))

  it('is ONE sheet, named after the employee', () => {
    expect(wb.worksheets).toHaveLength(1)
    expect(ws.name).toBe('Himanshu Bansal')
  })
  it('has the header block with name, rate and period', () => {
    expect(find('Employee').vals).toContain('Himanshu Bansal')
    expect(find('Rate tier').vals).toContain('Manager')
    expect(find('Rate tier').vals).toContain('₹10 per km')
    expect(find('Period').vals).toContain('2026-10-01 to 2026-10-02')
  })
  it('has a bold heading row and frozen panes', () => {
    const head = find('Distance Amount (₹)')
    expect(ws.getRow(head.n).font.bold).toBe(true)
    expect(ws.views[0].state).toBe('frozen')
  })
  it('writes day totals as real numbers with km × rate', () => {
    const t1 = find('Day total — 2026-10-01')
    expect(t1.vals[4]).toBe(37)
    expect(t1.vals[8]).toBe(370)
    expect(t1.vals[9]).toBeCloseTo(560.5)
    expect(typeof t1.vals[4]).toBe('number')
  })
  it('ends with the summary and the final total', () => {
    expect(find('Total distance (km)').vals[8]).toBe(44.5)
    expect(find('Total expenses').vals[8]).toBeCloseTo(250.5)
    const fin = find('FINAL TOTAL')
    expect(fin.vals[8]).toBeCloseTo(695.5)
    expect(ws.getRow(fin.n).font.bold).toBe(true)
    expect(rows[rows.length - 1]).toBe(fin)
  })
  it('survives being written to a real .xlsx file and read back', async () => {
    const buf = await wb.xlsx.writeBuffer()
    const back = new ExcelJS.Workbook()
    await back.xlsx.load(buf)
    expect(back.worksheets).toHaveLength(1)
    expect(back.worksheets[0].name).toBe('Himanshu Bansal')
  })
})
