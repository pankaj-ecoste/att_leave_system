// Pure helpers for the device id (plan.md §38) — no browser APIs here, so every case is
// unit-tested. The storage reading/writing lives in deviceId.js.

// A stored id is only trusted if it looks like one we made (a UUID). Anything else — empty,
// junk, a different app's value under the same key — is treated as "not there".
export function isValidDeviceId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9-]{16,64}$/.test(v)
}

// The id may survive in several places. Pick the first good one, in this order, and say
// which place it came from (so we can tell "restored from backup" apart from "was there").
export function pickDeviceId({ local, idb, cookie }) {
  const candidates = [['localStorage', local], ['indexedDB', idb], ['cookie', cookie]]
  for (const [source, value] of candidates) {
    if (isValidDeviceId(value)) return { id: value, source }
  }
  return { id: null, source: null }
}

// A coarse, human-readable description of how the app was opened — enough for HR to
// recognise "WhatsApp's own browser" or "home-screen icon" in the audit log. Never
// identifies a person, and is deliberately short.
export function describeClient(userAgent, standalone) {
  const ua = String(userAgent || '')
  let os = 'UnknownOS'
  if (/android/i.test(ua)) os = 'Android'
  else if (/iPhone/i.test(ua)) os = 'iPhone'
  else if (/iPad/i.test(ua)) os = 'iPad'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'Mac'
  else if (/Linux/i.test(ua)) os = 'Linux'

  // In-app browsers keep their OWN storage, separate from Chrome/Safari — the prime suspect
  // when "same phone, same browser" still means a new device id.
  const inApp = ua.match(/FBAN|FBAV|Instagram|WhatsApp|Line\/|MicroMessenger|Snapchat|Telegram/i)
  let browser = 'UnknownBrowser'
  if (inApp) browser = `InAppBrowser(${inApp[0].replace(/\W/g, '')})`
  else if (/; wv\)/i.test(ua)) browser = 'AndroidWebView'
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung'
  else if (/EdgA?\//i.test(ua)) browser = 'Edge'
  else if (/Firefox|FxiOS/i.test(ua)) browser = 'Firefox'
  else if (/CriOS|Chrome\//i.test(ua)) browser = 'Chrome'
  else if (/Safari\//i.test(ua)) browser = 'Safari'

  return `${os} ${browser} ${standalone ? 'home-screen-app' : 'browser-tab'}`
}

// The short note sent with login so a blocked/registered/restored event in the audit log
// says WHY. id: new = this browser had no id at all (storage wiped, private tab, a truly
// different phone, or first ever visit); restored-from-X = the main copy was gone but a
// backup copy saved the day; known = the normal case.
//
// plan.md §49 — two optional extras, appended AFTER the existing parts so the server's 120-char
// cap can only ever trim the new tail: host = which web address the app was opened from
// (browser storage is separate per address), stored = which storage areas accepted the id
// (L localStorage, I IndexedDB, C cookie; "none" = the browser refused all three).
export function buildDeviceNote({ fresh, restoredFrom, persisted, client, host, stored }) {
  const id = fresh ? 'new' : restoredFrom ? `restored-from-${restoredFrom}` : 'known'
  const persist = persisted === true ? 'yes' : persisted === false ? 'no' : 'unknown'
  let note = `id:${id}; persist:${persist}; ${client}`
  const h = safeHost(host)
  if (h) note += `; host:${h}`
  if (typeof stored === 'string' && stored) note += `; store:${stored}`
  return note
}

// Only plain host characters, capped — the server strips anything else anyway; this keeps the
// note readable and short.
export function safeHost(host) {
  return String(host || '').toLowerCase().replace(/[^a-z0-9.-]/g, '').slice(0, 30)
}

// plan.md §49 — one extra sentence for the "not your registered device" message, chosen from
// what we know about HOW the app was opened. Advice only: it never changes who is allowed in.
// '' means "nothing specific to add".
export function denialHint({ fresh, client, host, appHost }) {
  const h = safeHost(host)
  const official = safeHost(appHost)
  if (h && official && h !== official) {
    return `You opened the app from ${h}. Please use the official link (${official}) and try again.`
  }
  if (/InAppBrowser/.test(client || '')) {
    return 'You opened the app inside another app. Open it in Chrome or Safari, or from your home-screen icon, and try again.'
  }
  if (fresh && !/home-screen-app/.test(client || '')) {
    return 'This browser has no saved record of your phone. If this is your own phone, avoid Private tabs, open the app the same way each time, and tell HR how you opened it.'
  }
  return ''
}
