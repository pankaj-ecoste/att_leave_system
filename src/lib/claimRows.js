import { allJourneyDates } from './travelExpenses'

// plan.md §53 — which visits / expenses belong to a claim.
//
// The server decides this by `claim_id` (employee_submit_travel_claim stamps every unclaimed row dated
// up to the end date). Reports and screens must use the same rule — NOT "rows whose date falls in the
// claim's period", which also picks up a visit saved after the claim on its end date, and rows of an
// earlier claim that share a date. Pure, so each case is unit-tested.

export function groupByDate(rows) {
  const out = {}
  for (const r of rows || []) (out[r.date] ||= []).push(r)
  return out
}

// Exactly the rows stamped with this claim.
export function rowsOfClaim({ visits, expenses, claimId }) {
  const v = (visits || []).filter(x => x.claimId === claimId)
  const e = (expenses || []).filter(x => x.claimId === claimId)
  return { visits: v, expenses: e, dates: allJourneyDates(v, e) }
}

// What a claim submitted now, with this end date, will contain: rows with no claim yet, dated on or
// before the end date (the same rows the server will stamp).
export function rowsForNewClaim({ visits, expenses, endDate }) {
  const keep = x => !x.claimId && x.date <= endDate
  const v = (visits || []).filter(keep)
  const e = (expenses || []).filter(keep)
  return { visits: v, expenses: e, dates: allJourneyDates(v, e) }
}

// First day that still has something unclaimed (null if nothing). The server measures its 5-day
// minimum from this same date.
export function firstUnclaimedDate(visits, expenses) {
  const dates = allJourneyDates((visits || []).filter(x => !x.claimId), (expenses || []).filter(x => !x.claimId))
  return dates[0] || null
}
