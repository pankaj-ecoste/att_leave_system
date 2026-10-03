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
export function buildDeviceNote({ fresh, restoredFrom, persisted, client }) {
  const id = fresh ? 'new' : restoredFrom ? `restored-from-${restoredFrom}` : 'known'
  const persist = persisted === true ? 'yes' : persisted === false ? 'no' : 'unknown'
  return `id:${id}; persist:${persist}; ${client}`
}
