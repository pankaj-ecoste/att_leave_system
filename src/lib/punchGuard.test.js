import { describe, it, expect } from 'vitest'
import { punchBlockReason, punchAvailability } from './punchGuard'

describe('punchBlockReason', () => {
  it('blocks a second punch-in and names the existing time', () => {
    expect(punchBlockReason({ inTime: '10:03:56.1' }, 'in')).toMatch(/already punched in today at 10:03/)
  })
  it('allows the first punch-in', () => {
    expect(punchBlockReason({}, 'in')).toBeNull()
    expect(punchBlockReason(null, 'in')).toBeNull()
    expect(punchBlockReason({ inTime: null }, 'in')).toBeNull()
  })
  it('never blocks a punch-out (re-punching out is a legitimate correction)', () => {
    expect(punchBlockReason({ inTime: '10:00', outTime: '18:00' }, 'out')).toBeNull()
    expect(punchBlockReason({}, 'out')).toBeNull()
  })
})

describe('punchAvailability', () => {
  it('ready enables the tiles', () => expect(punchAvailability('ready')).toEqual({ enabled: true, message: '', canRetry: false }))
  it('loading disables without offering retry', () => {
    const a = punchAvailability('loading')
    expect(a.enabled).toBe(false); expect(a.canRetry).toBe(false); expect(a.message).toMatch(/Loading/)
  })
  it('error disables and offers retry', () => {
    const a = punchAvailability('error')
    expect(a.enabled).toBe(false); expect(a.canRetry).toBe(true)
  })
  it('an unknown state is treated as not ready (fails safe)', () => {
    expect(punchAvailability(undefined).enabled).toBe(false)
  })
})
