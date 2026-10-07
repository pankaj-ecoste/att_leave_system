import * as XLSX from 'xlsx'
import { effectiveLegKm, effectiveReturnLegKm } from './travelPoints'
import { haversineMeters } from './geo'
import { todayIST } from './datetime'

// plan.md §46 — shared by admin's Travel.jsx and the staff claim flow in MyJourney.jsx, so
// both produce the same file. Moved out of Travel.jsx unchanged in logic.

export const TIER_LABELS = { manager: 'Manager', executive: 'Executive' }
const SOURCE_LABELS = { routed: 'Road distance', estimated: 'Estimate (straight-line)', adjusted: 'Manually adjusted' }

// Day-wise Punch In -> visits -> Punch Out, then a summary sheet. `visits` must already be
// limited to the wanted period.
export function buildTravelReportWorkbook({ employee, dates, journeyByDate, attnByDate, rate, periodLabel, expensesByDate = {} }) {
  const rows = []
  let totalKm = 0
  let totalExpense = 0

  for (const date of dates) {
    const visits = journeyByDate[date] || []
    const record = attnByDate[date]
    if (record?.inTime) {
      rows.push({ Date: date, Time: record.inTime, Type: 'Punch In', 'Site / Client': record.inLocation || '', 'Distance (km)': '', Source: '', 'Expense Note': '', 'Expense Amount (₹)': '' })
    }
    let lastLat = record?.inLat, lastLon = record?.inLon
    // Visits and standalone expenses (plan.md §48) interleaved by time, so a toll paid between
    // two sites sits between them in the file. Only visits move the distance chain.
    const items = [
      ...visits.map(v => ({ kind: 'visit', at: v.capturedAt, v })),
      ...(expensesByDate[date] || []).map(x => ({ kind: 'expense', at: x.capturedAt, x })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at))
    for (const item of items) {
      if (item.kind === 'expense') {
        const x = item.x
        rows.push({
          Date: date, Time: new Date(x.capturedAt).toLocaleTimeString(), Type: 'Expense', 'Site / Client': '',
          'Distance (km)': '', Source: '', 'Expense Note': x.category, 'Expense Amount (₹)': x.amount.toFixed(2),
        })
        totalExpense += x.amount || 0
        continue
      }
      const v = item.v
      const leg = effectiveLegKm(v)
      rows.push({
        Date: date, Time: new Date(v.capturedAt).toLocaleTimeString(), Type: 'Visit', 'Site / Client': v.siteNote,
        'Distance (km)': leg.km.toFixed(2), Source: SOURCE_LABELS[leg.source], 'Expense Note': v.expenseNote || '',
        'Expense Amount (₹)': v.expenseAmount != null ? v.expenseAmount.toFixed(2) : '',
      })
      totalKm += leg.km
      totalExpense += v.expenseAmount || 0
      lastLat = v.lat; lastLon = v.lon
    }
    if (record?.outTime) {
      const fallbackKm = (lastLat != null && record.outLat != null) ? haversineMeters(lastLat, lastLon, record.outLat, record.outLon) / 1000 : 0
      const returnLeg = effectiveReturnLegKm(record, fallbackKm)
      rows.push({ Date: date, Time: record.outTime, Type: 'Punch Out', 'Site / Client': record.outLocation || '', 'Distance (km)': returnLeg.km.toFixed(2), Source: SOURCE_LABELS[returnLeg.source], 'Expense Note': '', 'Expense Amount (₹)': '' })
      totalKm += returnLeg.km
    }
  }

  const distanceAmount = totalKm * rate
  const summaryRows = [{
    Employee: employee.name, 'Emp #': employee.empNum || '', 'Rate Tier': TIER_LABELS[employee.taRateTier] || employee.taRateTier || '',
    'Rate (₹/km)': rate, Period: periodLabel || '',
    'Total Distance (km)': totalKm.toFixed(2), 'Distance Amount (₹)': distanceAmount.toFixed(2),
    'Total Expenses (₹)': totalExpense.toFixed(2), 'Grand Total (₹)': (distanceAmount + totalExpense).toFixed(2),
  }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Day-wise Journey')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary')
  return { wb, totalKm, totalExpense, distanceAmount, grandTotal: distanceAmount + totalExpense }
}

// Returns the file name it saved under, so the claim email can name the attachment exactly.
export function downloadTravelReportFile(filenameBase, args) {
  const { wb } = buildTravelReportWorkbook(args)
  const fileName = `${filenameBase}_${todayIST()}.xlsx`
  XLSX.writeFile(wb, fileName)
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
