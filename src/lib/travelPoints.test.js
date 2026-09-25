import { describe, it, expect } from 'vitest'
import { googleMapsDirectionsUrl } from './travelPoints'

describe('googleMapsDirectionsUrl', () => {
  it('builds a driving-directions link from exact coordinates', () => {
    const url = googleMapsDirectionsUrl({ lat: 28.6862, lon: 77.053001 }, { lat: 28.487356, lon: 77.089929 })
    expect(url).toBe('https://www.google.com/maps/dir/?api=1&origin=28.686200,77.053001&destination=28.487356,77.089929&travelmode=driving')
  })

  it('accepts numeric strings (values straight from the database)', () => {
    const url = googleMapsDirectionsUrl({ lat: '28.686200', lon: '77.053001' }, { lat: '28.487356', lon: '77.089929' })
    expect(url).toContain('origin=28.686200,77.053001')
  })

  it('returns null when either end is missing, rather than a broken link', () => {
    expect(googleMapsDirectionsUrl(null, { lat: 1, lon: 2 })).toBeNull()
    expect(googleMapsDirectionsUrl({ lat: 1, lon: 2 }, null)).toBeNull()
    expect(googleMapsDirectionsUrl({ lat: null, lon: 2 }, { lat: 1, lon: 2 })).toBeNull()
  })
})
