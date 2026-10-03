import { describe, it, expect } from 'vitest'
import { adminLoginMessage } from './adminLoginMessage'

const fmt = () => '3:40 PM'

describe('adminLoginMessage', () => {
  it('says how many tries are left on a wrong PIN', () => {
    expect(adminLoginMessage({ error: 'wrong_pin', triesLeft: 2 }, fmt)).toMatch(/2 tries left/)
  })
  it('uses singular for the last try', () => {
    expect(adminLoginMessage({ error: 'wrong_pin', triesLeft: 1 }, fmt)).toMatch(/1 try left/)
  })
  it('falls back to a plain message if tries are unknown', () => {
    expect(adminLoginMessage({ error: 'wrong_pin' }, fmt)).toBe('Incorrect PIN.')
  })
  it('tells a locked device the unlock time and that other devices are fine', () => {
    const m = adminLoginMessage({ error: 'locked', lockedUntil: 'x' }, fmt)
    expect(m).toMatch(/3:40 PM/)
    expect(m).toMatch(/Other devices are not affected/)
  })
  it('explains the company-wide lock separately from a device lock', () => {
    const m = adminLoginMessage({ error: 'locked_global', lockedUntil: 'x' }, fmt)
    expect(m).toMatch(/everyone/)
    expect(m).toMatch(/3:40 PM/)
  })
  it('reports network trouble as network trouble, not a wrong PIN', () => {
    expect(adminLoginMessage({ error: 'network' }, fmt)).toMatch(/reach the server/)
  })
  it('never shows an empty message for an unknown error', () => {
    expect(adminLoginMessage({ error: 'something_new' }, fmt)).toBeTruthy()
    expect(adminLoginMessage(null, fmt)).toBeTruthy()
  })
  it('default time formatter survives a missing or bad time', () => {
    expect(adminLoginMessage({ error: 'locked', lockedUntil: null })).toMatch(/a few minutes/)
    expect(adminLoginMessage({ error: 'locked', lockedUntil: 'garbage' })).toMatch(/a few minutes/)
  })
})
