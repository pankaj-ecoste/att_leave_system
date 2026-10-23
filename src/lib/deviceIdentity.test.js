import { describe, it, expect } from 'vitest'
import { isValidDeviceId, pickDeviceId, describeClient, buildDeviceNote, safeHost, denialHint } from './deviceIdentity'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

describe('isValidDeviceId', () => {
  it('accepts a UUID', () => expect(isValidDeviceId(A)).toBe(true))
  it('rejects empty, short, non-string and junk', () => {
    for (const v of ['', null, undefined, 'abc', 123, 'has spaces in it that is long enough', '<script>alert(1)</script>xxxx']) {
      expect(isValidDeviceId(v)).toBe(false)
    }
  })
})

describe('pickDeviceId', () => {
  it('prefers localStorage when everything is there', () => {
    expect(pickDeviceId({ local: A, idb: B, cookie: B })).toEqual({ id: A, source: 'localStorage' })
  })
  it('restores from IndexedDB when localStorage was wiped', () => {
    expect(pickDeviceId({ local: null, idb: A, cookie: null })).toEqual({ id: A, source: 'indexedDB' })
  })
  it('restores from the cookie when both browser stores were wiped', () => {
    expect(pickDeviceId({ local: '', idb: undefined, cookie: A })).toEqual({ id: A, source: 'cookie' })
  })
  it('skips a corrupt copy and uses the next good one', () => {
    expect(pickDeviceId({ local: 'junk', idb: null, cookie: A })).toEqual({ id: A, source: 'cookie' })
  })
  it('returns nothing when no copy survives (caller makes a new id)', () => {
    expect(pickDeviceId({ local: null, idb: null, cookie: null })).toEqual({ id: null, source: null })
  })
})

describe('describeClient', () => {
  const chromeAndroid = 'Mozilla/5.0 (Linux; Android 13; SM-A135F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
  const safariIphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
  it('recognises Chrome on Android in a normal tab', () => {
    expect(describeClient(chromeAndroid, false)).toBe('Android Chrome browser-tab')
  })
  it('recognises Safari on iPhone and a home-screen app', () => {
    expect(describeClient(safariIphone, true)).toBe('iPhone Safari home-screen-app')
  })
  it('flags in-app browsers, which keep their own separate storage', () => {
    expect(describeClient(chromeAndroid + ' Instagram 300.0', false)).toContain('InAppBrowser(Instagram)')
  })
  it('flags an Android WebView', () => {
    expect(describeClient('Mozilla/5.0 (Linux; Android 12; Pixel 6; wv) AppleWebKit/537.36 Chrome/110 Mobile Safari/537.36', false)).toContain('AndroidWebView')
  })
  it('survives a missing user agent', () => {
    expect(describeClient(undefined, false)).toBe('UnknownOS UnknownBrowser browser-tab')
  })
})

describe('buildDeviceNote', () => {
  const client = 'Android Chrome browser-tab'
  it('marks a brand-new id', () => {
    expect(buildDeviceNote({ fresh: true, restoredFrom: null, persisted: false, client })).toBe('id:new; persist:no; Android Chrome browser-tab')
  })
  it('marks a restored id and where it came from', () => {
    expect(buildDeviceNote({ fresh: false, restoredFrom: 'cookie', persisted: true, client })).toBe('id:restored-from-cookie; persist:yes; Android Chrome browser-tab')
  })
  it('marks the normal case', () => {
    expect(buildDeviceNote({ fresh: false, restoredFrom: null, persisted: undefined, client })).toBe('id:known; persist:unknown; Android Chrome browser-tab')
  })
  it('appends the web address and storage result after the existing parts (plan.md §49)', () => {
    expect(buildDeviceNote({ fresh: true, restoredFrom: null, persisted: false, client, host: 'att-leave-system.vercel.app', stored: 'LIC' }))
      .toBe('id:new; persist:no; Android Chrome browser-tab; host:att-leave-system.vercel.app; store:LIC')
  })
  it('reports when the browser refused every storage area', () => {
    expect(buildDeviceNote({ fresh: true, restoredFrom: null, persisted: false, client, stored: 'none' })).toContain('store:none')
  })
  it('stays inside the server 120-char cap in the worst realistic case (new id, in-app browser, official host)', () => {
    const note = buildDeviceNote({ fresh: true, restoredFrom: null, persisted: false, client: 'Android InAppBrowser(Instagram) browser-tab', host: 'att-leave-system.vercel.app', stored: 'LIC' })
    expect(note.length).toBeLessThanOrEqual(120)
  })
  it('in the rarest, longest case only the new tail can be trimmed by the server — the original parts come first', () => {
    const note = buildDeviceNote({ fresh: false, restoredFrom: 'indexedDB', persisted: false, client: 'Android InAppBrowser(Instagram) browser-tab', host: 'x'.repeat(80) + '.com', stored: 'LIC' })
    expect(note.startsWith('id:restored-from-indexedDB; persist:no; Android InAppBrowser(Instagram) browser-tab; host:')).toBe(true)
    expect(note.slice(0, 120)).toContain('Android InAppBrowser(Instagram) browser-tab')
  })
})

describe('safeHost', () => {
  it('lowercases and keeps only host characters', () => expect(safeHost('ATT-Leave.Vercel.app/<x>')).toBe('att-leave.vercel.appx'))
  it('copes with nothing', () => expect(safeHost(undefined)).toBe(''))
})

describe('denialHint', () => {
  const official = 'att-leave-system.vercel.app'
  it('names the wrong address first', () => {
    expect(denialHint({ fresh: true, client: 'Android Chrome browser-tab', host: 'old-name.vercel.app', appHost: official })).toContain('official link')
  })
  it('flags an in-app browser', () => {
    expect(denialHint({ fresh: false, client: 'iPhone InAppBrowser(WhatsApp) browser-tab', host: official, appHost: official })).toContain('inside another app')
  })
  it('explains a browser with no saved record', () => {
    expect(denialHint({ fresh: true, client: 'iPhone Safari browser-tab', host: official, appHost: official })).toContain('no saved record')
  })
  it('says nothing for the home-screen app with a new id (nothing specific to advise)', () => {
    expect(denialHint({ fresh: true, client: 'iPhone Safari home-screen-app', host: official, appHost: official })).toBe('')
  })
  it('says nothing when the browser knew its id (genuinely a different phone)', () => {
    expect(denialHint({ fresh: false, client: 'Android Chrome browser-tab', host: official, appHost: official })).toBe('')
  })
})
