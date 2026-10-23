import { describe, it, expect } from 'vitest'
import { suspectDuplicateIds } from './travelDuplicates'

const v = (id, site, at, lat = 28.6, lon = 77.2, extra = {}) => ({ id, empId: 'e1', date: '2026-10-05', siteNote: site, capturedAt: at, lat, lon, ...extra })

describe('suspectDuplicateIds', () => {
  it('marks the repeat, not the first one', () => {
    const f = suspectDuplicateIds([v('a', 'Siddharth', '2026-10-05T09:28:20.000Z'), v('b', 'Siddharth', '2026-10-05T09:28:20.300Z')])
    expect([...f]).toEqual(['b'])
  })
  it('ignores capitals and extra spaces in the site name', () => {
    expect([...suspectDuplicateIds([v('a', 'Airport', '2026-10-05T05:00:00Z'), v('b', '  AIRPORT ', '2026-10-05T05:02:00Z')])]).toEqual(['b'])
  })
  it('marks every later copy of a group (9 saves of one place → 8 marks)', () => {
    const rows = Array.from({ length: 9 }, (_, i) => v(`r${i}`, 'Airport', new Date(Date.UTC(2026, 9, 5, 5, i)).toISOString()))
    expect(suspectDuplicateIds(rows).size).toBe(8)
  })
  it('different site name at the same spot is a genuine second client', () => {
    expect(suspectDuplicateIds([v('a', 'Rishita B3', '2026-10-05T05:00:00Z'), v('b', 'Rishita Tower E3', '2026-10-05T05:01:00Z')]).size).toBe(0)
  })
  it('same name but far away (over 200 m) is genuine', () => {
    expect(suspectDuplicateIds([v('a', 'Site', '2026-10-05T05:00:00Z'), v('b', 'Site', '2026-10-05T05:01:00Z', 28.7, 77.3)]).size).toBe(0)
  })
  it('same name and spot but over 10 minutes later is a genuine return visit', () => {
    expect(suspectDuplicateIds([v('a', 'Site', '2026-10-05T05:00:00Z'), v('b', 'Site', '2026-10-05T05:11:00Z')]).size).toBe(0)
  })
  it('exactly 10 minutes apart still counts as a repeat', () => {
    expect(suspectDuplicateIds([v('a', 'Site', '2026-10-05T05:00:00Z'), v('b', 'Site', '2026-10-05T05:10:00Z')]).size).toBe(1)
  })
  it('different people or different days never count', () => {
    expect(suspectDuplicateIds([v('a', 'Site', '2026-10-05T05:00:00Z'), v('b', 'Site', '2026-10-05T05:01:00Z', 28.6, 77.2, { empId: 'e2' })]).size).toBe(0)
    expect(suspectDuplicateIds([v('a', 'Site', '2026-10-05T05:00:00Z'), v('b', 'Site', '2026-10-05T05:01:00Z', 28.6, 77.2, { date: '2026-10-06' })]).size).toBe(0)
  })
  it('works regardless of the order the rows arrive in', () => {
    const f = suspectDuplicateIds([v('b', 'Site', '2026-10-05T05:01:00Z'), v('a', 'Site', '2026-10-05T05:00:00Z')])
    expect([...f]).toEqual(['b'])
  })
  it('empty or missing input', () => {
    expect(suspectDuplicateIds([]).size).toBe(0)
    expect(suspectDuplicateIds(undefined).size).toBe(0)
  })
})
