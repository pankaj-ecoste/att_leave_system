// What to tell the person on the admin login screen, from the answer admin_login gave
// (plan.md §37). Pure so every case is unit-tested — the old single message ("wrong PIN, or
// too many attempts") hid whether the PIN was mistyped or the login was locked.
//
// result = { token, error, lockedUntil, triesLeft } from api/auth.js adminLogin().
export function adminLoginMessage(result, formatTime = defaultFormatTime) {
  switch (result?.error) {
    case 'wrong_pin': {
      const left = result.triesLeft
      if (left === 1) return 'Incorrect PIN. 1 try left before this device is locked for 20 minutes.'
      if (left > 1) return `Incorrect PIN. ${left} tries left before this device is locked for 20 minutes.`
      return 'Incorrect PIN.'
    }
    case 'locked':
      return `Too many wrong PINs on this device. Locked until ${formatTime(result.lockedUntil)}. Other devices are not affected.`
    case 'locked_global':
      return `Admin login is temporarily locked for everyone because of many wrong PINs. Try again after ${formatTime(result.lockedUntil)}.`
    case 'network':
      return 'Could not reach the server. Check your connection and try again.'
    default:
      return 'Could not log in. Please try again.'
  }
}

function defaultFormatTime(iso) {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return 'a few minutes from now'
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}
