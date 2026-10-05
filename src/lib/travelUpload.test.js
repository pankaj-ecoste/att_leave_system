import { describe, it, expect, vi } from 'vitest'
import { isNetworkError, withRetry, friendlySaveError } from './travelUpload'

describe('isNetworkError', () => {
  it('recognises browser network failures', () => {
    expect(isNetworkError(new Error('Load failed'))).toBe(true)
    expect(isNetworkError({ message: 'TypeError: Failed to fetch' })).toBe(true)
  })
  it('does not treat server rejections as network errors', () => {
    expect(isNetworkError({ message: 'Punch in before logging a site visit' })).toBe(false)
  })
})

describe('withRetry', () => {
  it('retries a network failure and then succeeds', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('Load failed')).mockResolvedValueOnce('ok')
    await expect(withRetry(fn, { baseDelayMs: 0 })).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('never retries a server rejection', async () => {
    const fn = vi.fn().mockRejectedValue({ message: 'Already punched out for this date' })
    await expect(withRetry(fn, { baseDelayMs: 0 })).rejects.toMatchObject({ message: 'Already punched out for this date' })
    expect(fn).toHaveBeenCalledTimes(1)
  })
  it('gives up after the last attempt', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Load failed'))
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toThrow('Load failed')
    expect(fn).toHaveBeenCalledTimes(3)
  })
})

describe('friendlySaveError', () => {
  it('explains a network failure in plain words', () => {
    expect(friendlySaveError(new Error('Load failed'))).toMatch(/check your signal/)
  })
  it('keeps real server messages', () => {
    expect(friendlySaveError({ message: 'Site/client name is required' })).toBe('Site/client name is required')
  })
})
