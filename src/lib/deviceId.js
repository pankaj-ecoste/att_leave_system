import { pickDeviceId, describeClient, buildDeviceNote } from './deviceIdentity'

const STORAGE_KEY = 'hrms_device_id'
const IDB_NAME = 'hrms'
const IDB_STORE = 'kv'
const COOKIE_MAX_AGE_S = 400 * 24 * 60 * 60 // browsers cap cookie life at ~400 days anyway
const IDB_TIMEOUT_MS = 1500

// A random id for this browser install — the basis for device binding (plan.md §18/§19).
// Not tied to a person; it just names "this phone/browser".
//
// plan.md §38 — the id used to live ONLY in localStorage, which a phone can lose without
// anyone noticing (cleaner apps, "clear data", Safari's 7-day cleanup, in-app browsers...).
// A lost id looks to the server like a stranger's phone. So it is now kept in three places
// (localStorage, IndexedDB, a cookie); if one is wiped, another puts it back, and we also
// ask the browser not to auto-delete our storage. Nothing here makes a borrowed PIN work
// on someone else's phone — a friend's phone has no copy of the id in ANY of the places.

let state = null // { id, fresh, restoredFrom, persisted } once initDeviceId() has run
let initPromise = null

function readLocal() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}
function writeLocal(id) {
  try { localStorage.setItem(STORAGE_KEY, id); return true } catch { return false }
}

function readCookie() {
  try {
    const hit = document.cookie.split('; ').find(c => c.startsWith(`${STORAGE_KEY}=`))
    return hit ? decodeURIComponent(hit.slice(STORAGE_KEY.length + 1)) : null
  } catch { return null }
}
function writeCookie(id) {
  try {
    const secure = location.protocol === 'https:' ? '; Secure' : ''
    document.cookie = `${STORAGE_KEY}=${encodeURIComponent(id)}; max-age=${COOKIE_MAX_AGE_S}; path=/; SameSite=Lax${secure}`
    return readCookie() === id
  } catch { return false }
}

function openIdb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}
async function readIdb() {
  const db = await openIdb()
  try {
    return await new Promise((resolve, reject) => {
      const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(STORAGE_KEY)
      req.onsuccess = () => resolve(req.result ?? null)
      req.onerror = () => reject(req.error)
    })
  } finally { db.close() }
}
async function writeIdb(id) {
  const db = await openIdb()
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite')
      tx.objectStore(IDB_STORE).put(id, STORAGE_KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    return true
  } finally { db.close() }
}

// IndexedDB can hang or throw in private/locked-down browsers — it must never be able to
// block the login screen. Anything slow or broken just counts as "that copy isn't there".
function guarded(promiseFactory, fallback) {
  return Promise.race([
    (async () => { try { return await promiseFactory() } catch { return fallback } })(),
    new Promise(resolve => setTimeout(() => resolve(fallback), IDB_TIMEOUT_MS)),
  ])
}

async function requestPersistence() {
  try {
    if (!navigator.storage?.persist) return undefined
    return await navigator.storage.persist()
  } catch { return undefined }
}

// Run once at app start, before the login screen is usable. Never throws.
export function initDeviceId() {
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const found = pickDeviceId({
          local: readLocal(),
          idb: await guarded(readIdb, null),
          cookie: readCookie(),
        })
        const fresh = !found.id
        const id = found.id || crypto.randomUUID()
        const saved = [writeLocal(id), writeCookie(id), await guarded(() => writeIdb(id), false)]
        state = {
          // If NOTHING could store it, behave like before: no id, so no binding is made
          // to a throwaway value that would be "lost" by the next page load.
          id: saved.some(Boolean) ? id : null,
          fresh,
          restoredFrom: found.source && found.source !== 'localStorage' ? found.source : null,
          persisted: await requestPersistence(),
        }
      } catch {
        state = null
      }
    })()
  }
  return initPromise
}

export function getDeviceId() {
  if (state) return state.id
  // initDeviceId() hasn't finished (it normally has, at app start) — old localStorage-only path.
  try {
    let id = readLocal()
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

// Short "why" note sent with login so the server's audit log can say what kind of event a
// device block was (new id vs restored vs known, and how the app was opened).
export function getDeviceNote() {
  try {
    const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true
    return buildDeviceNote({
      fresh: state ? state.fresh : false,
      restoredFrom: state ? state.restoredFrom : null,
      persisted: state ? state.persisted : undefined,
      client: describeClient(navigator.userAgent, standalone),
    })
  } catch {
    return null
  }
}
