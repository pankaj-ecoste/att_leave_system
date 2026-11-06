// Guards for the punch screen (plan.md §59). Pure functions, no network, no React.
//
// Background: the Punch In / Punch Out button used to be chosen only from what the phone
// *believed* about today. If that belief was wrong (today's record still loading, or the load
// failed silently) the screen showed "Absent" + "Punch In", and a second punch-in silently
// replaced the morning one. These helpers make the client refuse that case, using a record
// freshly read from the server. The server has the same rule as the real hard block (0073).

// Returns a plain-words reason if this punch must not go ahead, or null if it may.
// `record` must be the FRESH record from the server, not the possibly-stale screen state.
export function punchBlockReason(record, type) {
  if (type === 'in' && record && record.inTime) {
    return `You are already punched in today at ${String(record.inTime).slice(0, 5)}. Use Punch Out when you leave.`
  }
  return null
}

// What the punch tiles should do for a given load state of today's attendance.
//   'ready'   -> tiles work as normal
//   'loading' -> tiles off, short note (a moment, not an error)
//   'error'   -> tiles off, note + Retry (never pretend the day is "Absent")
export function punchAvailability(loadState) {
  if (loadState === 'ready') return { enabled: true, message: '', canRetry: false }
  if (loadState === 'error') {
    return { enabled: false, message: "Couldn't load today's attendance. Check your internet and tap Retry.", canRetry: true }
  }
  return { enabled: false, message: "Loading today's attendance…", canRetry: false }
}
