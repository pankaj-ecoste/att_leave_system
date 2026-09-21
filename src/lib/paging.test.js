import { describe, it, expect } from 'vitest'
import { fetchAllPages } from './paging'

// A fake server that behaves like Supabase: it holds `total` rows, honours offset, but
// silently clamps every response to `serverCap` rows regardless of the count requested —
// the exact behaviour that hid 1 Sep from the attendance report.
function cappedServer(total, serverCap = 1000) {
  const rows = Array.from({ length: total }, (_, i) => ({ n: i }))
  const calls = []
  const fetchPage = async (count, offset) => {
    calls.push({ count, offset })
    return rows.slice(offset, offset + Math.min(count, serverCap))
  }
  return { rows, calls, fetchPage }
}

describe('fetchAllPages', () => {
  it('returns every row even when the server caps each response (the 1 Sep bug)', async () => {
    const s = cappedServer(1054) // September's real row count
    const got = await fetchAllPages(s.fetchPage, { limit: 100000 })
    expect(got).toHaveLength(1054)
    expect(got[0]).toEqual({ n: 0 })
    expect(got[1053]).toEqual({ n: 1053 }) // the last rows are the ones a single call lost
  })

  it('returns rows in order with no duplicates across pages', async () => {
    const s = cappedServer(3500)
    const got = await fetchAllPages(s.fetchPage, { limit: 100000 })
    expect(got.map(r => r.n)).toEqual(s.rows.map(r => r.n))
  })

  it('still gets everything if the server cap is smaller than the page size', async () => {
    const s = cappedServer(1300, 500)
    const got = await fetchAllPages(s.fetchPage, { limit: 100000 })
    expect(got).toHaveLength(1300)
  })

  it('handles an exact multiple of the page size', async () => {
    const s = cappedServer(2000)
    expect(await fetchAllPages(s.fetchPage, { limit: 100000 })).toHaveLength(2000)
  })

  it('returns an empty list when there are no rows', async () => {
    const s = cappedServer(0)
    expect(await fetchAllPages(s.fetchPage, { limit: 100000 })).toEqual([])
  })

  it('respects the caller\'s limit as a total, and never over-asks', async () => {
    const s = cappedServer(5000)
    const got = await fetchAllPages(s.fetchPage, { limit: 1500 })
    expect(got).toHaveLength(1500)
    expect(Math.max(...s.calls.map(c => c.count))).toBeLessThanOrEqual(1000)
    expect(s.calls.every(c => c.count > 0)).toBe(true)
  })

  it('starts from the given offset', async () => {
    const s = cappedServer(50)
    const got = await fetchAllPages(s.fetchPage, { limit: 100, offset: 40 })
    expect(got.map(r => r.n)).toEqual([40, 41, 42, 43, 44, 45, 46, 47, 48, 49])
  })

  it('propagates a fetch error instead of returning partial data', async () => {
    let call = 0
    const fetchPage = async () => {
      if (++call === 2) throw new Error('network down')
      return Array.from({ length: 1000 }, (_, i) => ({ n: i }))
    }
    await expect(fetchAllPages(fetchPage, { limit: 100000 })).rejects.toThrow('network down')
  })
})
