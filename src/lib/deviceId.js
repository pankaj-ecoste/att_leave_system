const STORAGE_KEY = 'hrms_device_id'

// A random id for this browser install, created once and kept in localStorage — the
// basis for punch device binding (plan.md §18). Not tied to a person; it just names
// "this phone/browser" so employee_punch can tell whether a punch is coming from the
// device an employee already bound, or a different one.
export function getDeviceId() {
  try {
    let id = localStorage.getItem(STORAGE_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, id)
    }
    return id
  } catch {
    // localStorage unavailable (private mode edge cases) — punch still works, it just
    // won't bind to a stable device id this session.
    return null
  }
}
