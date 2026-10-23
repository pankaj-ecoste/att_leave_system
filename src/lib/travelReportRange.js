import { allJourneyDates, groupExpensesByDate } from './travelExpenses'

// plan.md §50 — admin picks a start and end date for a travel report. Pure, so every edge is tested.
// Empty from / to means "no limit on that side". Both ends are inclusive.
// Returns { error } when the range is unusable, otherwise exactly what the report builder needs.
export function filterReportRange({ from, to, journey, expenses }) {
  if (from && to && from > to) return { error: 'The start date is after the end date' }

  const inRange = d => (!from || d >= from) && (!to || d <= to)
  const visits = (journey || []).filter(v => inRange(v.date))
  const exp = (expenses || []).filter(x => inRange(x.date))
  const dates = allJourneyDates(visits, exp)
  if (dates.length === 0) {
    const where = from && to ? `between ${from} and ${to}` : from ? `from ${from}` : to ? `up to ${to}` : ''
    return { error: `No travel or expenses ${where}`.trim() }
  }

  const journeyByDate = {}
  for (const v of visits) (journeyByDate[v.date] ||= []).push(v)

  return {
    dates,
    journeyByDate,
    expensesByDate: groupExpensesByDate(exp),
    // The period shown on the report is what it actually contains, not what was typed.
    periodLabel: `${dates[0]} to ${dates[dates.length - 1]}`,
    rangeSuffix: `${dates[0]}_to_${dates[dates.length - 1]}`,
  }
}
