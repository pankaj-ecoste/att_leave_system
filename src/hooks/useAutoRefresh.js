import { useEffect, useRef, useState } from 'react'
import { isNewVersionAvailable } from '../lib/versionCheck'

const CHECK_INTERVAL_MS = 5 * 60 * 1000 // backup, for a tab that's never backgrounded

// Auto-reloads the app when a newer version has been deployed (plan.md §20) — checked
// whenever the tab becomes visible again (the realistic "reopened the home-screen
// icon" moment for this staff) and on a periodic timer as a backup. Never interrupts
// an in-flight punch: `isPunching` is the same in-flight guard useEmployeeAttendance
// already uses to ignore double-taps, so a background check can't cut off a GPS
// capture or punch save partway through — it just checks again next time.
export function useAutoRefresh(isPunching) {
  const [updating, setUpdating] = useState(false)
  const isPunchingRef = useRef(isPunching)
  isPunchingRef.current = isPunching

  useEffect(() => {
    let cancelled = false

    async function check() {
      if (isPunchingRef.current || cancelled) return
      const isNew = await isNewVersionAvailable()
      if (isNew && !isPunchingRef.current && !cancelled) {
        setUpdating(true)
        setTimeout(() => window.location.reload(), 800)
      }
    }

    function onVisible() {
      if (document.visibilityState === 'visible') check()
    }

    document.addEventListener('visibilitychange', onVisible)
    const interval = setInterval(check, CHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(interval)
    }
  }, [])

  return updating
}
