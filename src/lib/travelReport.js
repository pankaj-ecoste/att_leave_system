import { effectiveLegKm, effectiveReturnLegKm } from './travelPoints'
import { haversineMeters } from './geo'
import { todayIST } from './datetime'
import { expenseLabel } from './travelExpenses'

// plan.md §46 / §50 — shared by admin's Travel.jsx and the staff claim flow in MyJourney.jsx, so
// both produce the same file.

export const TIER_LABELS = { manager: 'Manager', executive: 'Executive' }
const SOURCE_LABELS = { routed: 'Road distance', estimated: 'Estimate (straight-line)', adjusted: 'Manually adjusted' }

// "10:40 AM" in Indian time — same look as the punch-in/out times, whatever timezone the file is opened in.
export function reportTime(iso) {
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase()
}

const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// ---------------------------------------------------------------------------
// The report as plain data (no Excel here, so every number and rule is unit-tested).
//
// plan.md §50 — one sheet per person: for each day the punch-in, visits, standalone expenses (in
// time order) and punch-out, then that day's distance × rate and day total; at the end the
// totals and the final figure. The final distance amount is total km × rate rounded ONCE — the
// same rule the claim uses (§46) — so the sheet's final figure always equals the claim amount.
// A day's amount is rounded for display, so day amounts can differ from the final by paise.
// `visits` must already be limited to the wanted period.
// ---------------------------------------------------------------------------
export function buildTravelReportModel({ employee, dates, journeyByDate, attnByDate, rate, periodLabel, expensesByDate = {} }) {
  const days = []
  let totalKm = 0
  let totalExpense = 0

  for (const date of dates) {
    const visits = journeyByDate[date] || []
    const record = attnByDate[date]
    const lines = []
    let dayKm = 0
    let dayExpense = 0

    if (record?.inTime) lines.push({ kind: 'in', time: record.inTime, type: 'Punch In', site: record.inLocation || '' })

    let lastLat = record?.inLat, lastLon = record?.inLon
    // Visits and standalone expenses interleaved by time, so a toll paid between two sites sits
    // between them. Only visits move the distance chain.
    const items = [
      ...visits.map(v => ({ kind: 'visit', at: v.capturedAt, v })),
      ...(expensesByDate[date] || []).map(x => ({ kind: 'expense', at: x.capturedAt, x })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at))

    for (const item of items) {
      if (item.kind === 'expense') {
        const x = item.x
        lines.push({ kind: 'expense', time: reportTime(x.capturedAt), type: 'Expense', site: '', expenseNote: expenseLabel(x), expense: x.amount })
        dayExpense += x.amount || 0
        continue
      }
      const v = item.v
      const leg = effectiveLegKm(v)
      lines.push({
        kind: 'visit', time: reportTime(v.capturedAt), type: 'Visit', site: v.siteNote,
        km: leg.km, source: SOURCE_LABELS[leg.source], expenseNote: v.expenseNote || '', expense: v.expenseAmount != null ? v.expenseAmount : null,
      })
      dayKm += leg.km
      dayExpense += v.expenseAmount || 0
      lastLat = v.lat; lastLon = v.lon
    }

    if (record?.outTime) {
      // plan.md §53 — the way back to base counts only on a day that has at least one visit (the server
      // never counts it otherwise). On a day with only expenses the Punch Out row still shows, with no km.
      if (visits.length > 0) {
        const fallbackKm = (lastLat != null && record.outLat != null) ? haversineMeters(lastLat, lastLon, record.outLat, record.outLon) / 1000 : 0
        const returnLeg = effectiveReturnLegKm(record, fallbackKm)
        lines.push({ kind: 'out', time: record.outTime, type: 'Punch Out', site: record.outLocation || '', km: returnLeg.km, source: SOURCE_LABELS[returnLeg.source] })
        dayKm += returnLeg.km
      } else {
        lines.push({ kind: 'out', time: record.outTime, type: 'Punch Out', site: record.outLocation || '' })
      }
    }

    const dayDistanceAmount = round2(dayKm * rate)
    days.push({ date, lines, dayKm, dayDistanceAmount, dayExpense, dayTotal: round2(dayDistanceAmount + dayExpense) })
    totalKm += dayKm
    totalExpense += dayExpense
  }

  const distanceAmount = round2(totalKm * rate)
  return {
    employee: {
      name: employee.name, empNum: employee.empNum || '',
      tier: TIER_LABELS[employee.taRateTier] || employee.taRateTier || '',
    },
    rate, periodLabel: periodLabel || '', days,
    totals: { totalKm, distanceAmount, totalExpense: round2(totalExpense), grandTotal: round2(distanceAmount + totalExpense) },
  }
}

// Excel allows 31 characters and none of  : \ / ? * [ ]  in a sheet name.
export function reportSheetName(name) {
  const clean = String(name || '').replace(/[:\\/?*[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31)
  return clean || 'Travel Report'
}

const COLUMNS = [
  { header: 'Date', width: 12 }, { header: 'Time', width: 12 }, { header: 'Type', width: 12 }, { header: 'Site / Client', width: 38 },
  { header: 'Distance (km)', width: 14 }, { header: 'Source', width: 24 }, { header: 'Expense Type / Note', width: 26 },
  { header: 'Expense (₹)', width: 14 }, { header: 'Distance Amount (₹)', width: 20 }, { header: 'Day Total (₹)', width: 16 },
]
const KM_FMT = '0.00'
const MONEY_FMT = '"₹"#,##0.00'

// Writes the model onto an exceljs worksheet. Numbers are real numbers (HR can sum / sort them).
export function writeReportSheet(ws, model) {
  const n = COLUMNS.length
  ws.columns = COLUMNS.map(c => ({ width: c.width }))
  const fill = argb => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } })
  const thin = { style: 'thin', color: { argb: 'FF94A3B8' } }
  const paintRow = (row, argb) => { for (let c = 1; c <= n; c++) row.getCell(c).fill = fill(argb) }
  const boxRow = (row, top) => { for (let c = 1; c <= n; c++) row.getCell(c).border = { top: top ? thin : undefined, bottom: thin } }

  const title = ws.addRow(['Travel Allowance Report'])
  ws.mergeCells(title.number, 1, title.number, n)
  title.getCell(1).font = { bold: true, size: 16, color: { argb: 'FF1E1B4B' } }
  title.height = 26

  const info = (a, b, c, d) => {
    const r = ws.addRow([a, b, '', '', c, d])
    r.getCell(1).font = { bold: true }
    r.getCell(5).font = { bold: true }
    ws.mergeCells(r.number, 2, r.number, 4)
    ws.mergeCells(r.number, 6, r.number, 7)
    r.getCell(5).alignment = { horizontal: 'left' }
  }
  info('Employee', model.employee.name, 'Emp #', model.employee.empNum)
  info('Rate tier', model.employee.tier, 'Rate', `₹${model.rate} per km`)
  info('Period', model.periodLabel, 'Prepared on', todayIST())
  ws.addRow([])

  const head = ws.addRow(COLUMNS.map(c => c.header))
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  head.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  paintRow(head, 'FF3730A3')
  head.height = 24
  ws.views = [{ state: 'frozen', ySplit: head.number }]

  for (const day of model.days) {
    for (const l of day.lines) {
      const r = ws.addRow([day.date, l.time, l.type, l.site, l.km ?? null, l.source || '', l.expenseNote || '', l.expense ?? null, null, null])
      r.getCell(4).alignment = { wrapText: true, vertical: 'top' }
      r.getCell(5).numFmt = KM_FMT
      r.getCell(8).numFmt = MONEY_FMT
      boxRow(r, false)
      if (l.kind === 'in') r.getCell(3).font = { color: { argb: 'FF047857' }, bold: true }
      if (l.kind === 'out') r.getCell(3).font = { color: { argb: 'FFB91C1C' }, bold: true }
      if (l.kind === 'expense') { r.getCell(3).font = { color: { argb: 'FFB45309' }, bold: true }; r.getCell(7).font = { color: { argb: 'FFB45309' } } }
    }
    const t = ws.addRow([`Day total — ${day.date}`, '', '', '', day.dayKm, '', '', day.dayExpense, day.dayDistanceAmount, day.dayTotal])
    ws.mergeCells(t.number, 1, t.number, 4)
    t.font = { bold: true }
    paintRow(t, 'FFE0E7FF')
    t.getCell(5).numFmt = KM_FMT
    for (const c of [8, 9, 10]) t.getCell(c).numFmt = MONEY_FMT
    boxRow(t, true)
  }

  ws.addRow([])
  const sumTitle = ws.addRow(['SUMMARY'])
  sumTitle.font = { bold: true, size: 12, color: { argb: 'FF1E1B4B' } }
  const T = model.totals
  const line = (label, value, fmt, strong) => {
    const r = ws.addRow([label, '', '', '', '', '', '', '', value])
    ws.mergeCells(r.number, 1, r.number, 8)
    r.getCell(9).numFmt = fmt
    r.getCell(9).alignment = { horizontal: 'right' }
    boxRow(r, false)
    if (strong) { r.font = { bold: true, size: 12 }; paintRow(r, 'FFFEF3C7') }
    return r
  }
  line('Total distance (km)', T.totalKm, KM_FMT)
  line(`Distance amount  (${round2(T.totalKm)} km × ₹${model.rate})`, T.distanceAmount, MONEY_FMT)
  line('Total expenses', T.totalExpense, MONEY_FMT)
  line('FINAL TOTAL', T.grandTotal, MONEY_FMT, true)

  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
}

// Builds the one-sheet workbook. ExcelJS is passed in so the app can load it only when a report
// is actually downloaded (plan.md §50) and tests can pass it directly.
export function buildReportWorkbook(ExcelJS, args) {
  const model = buildTravelReportModel(args)
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(reportSheetName(model.employee.name))
  writeReportSheet(ws, model)
  return { wb, model }
}

// Returns the file name it saved under, so the claim email can name the attachment exactly.
export async function downloadTravelReportFile(filenameBase, args) {
  const { default: ExcelJS } = await import('exceljs')
  const { wb } = buildReportWorkbook(ExcelJS, args)
  const buf = await wb.xlsx.writeBuffer()
  const fileName = `${filenameBase}_${todayIST()}.xlsx`
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return fileName
}

// Pre-written claim email. Gmail can't receive an attachment through a link, so the body says
// the report file is attached — the employee attaches the downloaded file themselves.
export function claimEmailText({ name, empNum, periodStart, periodEnd, totalKm, totalExpense, amount, fileName }) {
  const subject = `Travel Allowance Claim — ${name}${empNum ? ` (#${empNum})` : ''} — ${periodStart} to ${periodEnd}`
  const body = [
    'Dear HR team,',
    '',
    `Please find attached my travel allowance claim for ${periodStart} to ${periodEnd}.`,
    '',
    `Total distance: ${totalKm.toFixed(2)} km`,
    `Additional expenses: ₹${totalExpense.toFixed(2)}`,
    `Claim amount: ₹${amount.toFixed(2)}`,
    '',
    `Attached file: ${fileName}`,
    '',
    'Kindly process the payment at your earliest convenience.',
    '',
    'Thank you,',
    name,
  ].join('\n')
  return { subject, body }
}

export const CLAIM_TO = 'careers02@ecoste.in'
export const CLAIM_CC = ['founderoffice@ecoste.in', 'accounts03@ecoste.in']

export function claimGmailUrl({ to = CLAIM_TO, cc = CLAIM_CC, subject, body }) {
  const params = new URLSearchParams({ view: 'cm', fs: '1', to, cc: cc.join(','), su: subject, body })
  return `https://mail.google.com/mail/?${params.toString()}`
}
