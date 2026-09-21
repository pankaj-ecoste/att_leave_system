// Supabase's API silently caps any single request at ~1000 rows (its "max rows"
// setting), no matter what `p_limit` we send. Asking for limit 100000 does NOT return
// 100000 rows — it returns the first ~1000 and says nothing. That is exactly how 1 Sep
// vanished from the attendance report (2026-09-21, plan.md §29): September had 1,054
// rows, the newest-first sort filled the 1,000 quota with 21 Sep..2 Sep, and the last
// 54 rows — all 1 Sep — were dropped.
//
// So every "give me all the rows for this range" call must go through here instead of
// trusting a single request. It keeps asking for the next batch until the database has
// nothing more to give. Two deliberate choices:
//   - it advances by the number of rows it ACTUALLY got, not by the page size it asked
//     for — so it stays correct even if the server's cap is smaller than we think;
//   - it stops only on an EMPTY batch (or once `limit` rows are collected), never on a
//     "short" batch — a short batch is exactly what a capped server returns.
// The price is one extra (empty) request at the end. Worth it: a missing row in a payroll
// report is much worse than 100ms.
export const SERVER_PAGE_SIZE = 1000

// fetchPage(count, offset) -> Promise<array of up to `count` rows starting at `offset`>
// `limit` is the most rows the caller wants in total (Infinity = everything).
export async function fetchAllPages(fetchPage, { limit = Infinity, offset = 0, pageSize = SERVER_PAGE_SIZE } = {}) {
  const all = []
  let next = offset
  while (all.length < limit) {
    const want = Math.min(pageSize, limit - all.length)
    const page = await fetchPage(want, next)
    if (!page || page.length === 0) break
    all.push(...page)
    next += page.length
  }
  return all
}
