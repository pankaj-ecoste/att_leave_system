import { describe, it, expect } from 'vitest'
import { claimEmailText, claimGmailUrl, CLAIM_TO, CLAIM_CC } from './travelReport'

describe('claimEmailText', () => {
  it('writes subject, body and the attachment line', () => {
    const { subject, body } = claimEmailText({
      name: 'Puneet Sharma', empNum: '1171', periodStart: '2026-09-21', periodEnd: '2026-09-27',
      totalKm: 120.5, totalExpense: 300, amount: 1505, fileName: 'travel_allowance.xlsx',
    })
    expect(subject).toBe('Travel Allowance Claim — Puneet Sharma (#1171) — 2026-09-21 to 2026-09-27')
    expect(body).toContain('Total distance: 120.50 km')
    expect(body).toContain('Claim amount: ₹1505.00')
    expect(body).toContain('Attached file: travel_allowance.xlsx')
  })
})

describe('claimGmailUrl', () => {
  it('opens Gmail compose with To, both CCs, subject and body, all encoded', () => {
    const url = new URL(claimGmailUrl({ subject: 'Hi & bye', body: 'line one\nline two' }))
    expect(url.origin + url.pathname).toBe('https://mail.google.com/mail/')
    expect(url.searchParams.get('view')).toBe('cm')
    expect(url.searchParams.get('to')).toBe(CLAIM_TO)
    expect(url.searchParams.get('cc')).toBe(CLAIM_CC.join(','))
    expect(url.searchParams.get('su')).toBe('Hi & bye')
    expect(url.searchParams.get('body')).toBe('line one\nline two')
  })
})
