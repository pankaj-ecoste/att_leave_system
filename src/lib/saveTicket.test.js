import { describe, it, expect } from 'vitest'
import { makeTicketStore } from './saveTicket'

const counter = () => { let n = 0; return () => `ticket-${++n}` }

describe('makeTicketStore', () => {
  it('gives the same ticket for the same attempt, however many times it is asked', () => {
    const s = makeTicketStore(counter())
    const photo = {}
    expect(s.get(photo)).toBe('ticket-1')
    expect(s.get(photo)).toBe('ticket-1')
    expect(s.get(photo)).toBe('ticket-1')
  })
  it('a different photo is a new attempt with a new ticket', () => {
    const s = makeTicketStore(counter())
    const a = {}, b = {}
    expect(s.get(a)).toBe('ticket-1')
    expect(s.get(b)).toBe('ticket-2')
  })
  it('after clear (a successful save) the same photo would get a fresh ticket', () => {
    const s = makeTicketStore(counter())
    const a = {}
    expect(s.get(a)).toBe('ticket-1')
    s.clear()
    expect(s.get(a)).toBe('ticket-2')
  })
  it('going back to an earlier photo after another one is a new attempt', () => {
    const s = makeTicketStore(counter())
    const a = {}, b = {}
    s.get(a); s.get(b)
    expect(s.get(a)).toBe('ticket-3')
  })
})
