// Detects a newer deploy while this tab/home-screen icon is already open (plan.md
// §20) — an installed shortcut rarely gets a fresh page load on its own, so this is
// the only way it finds out a new version shipped. `__BUILD_TIME__` is baked into the
// bundle at build time (vite.config.js); version.json is a plain, un-hashed static
// file rewritten on every build, so it's cheap and safe to re-fetch uncached.
export async function isNewVersionAvailable() {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return false
    const { buildTime } = await res.json()
    return buildTime !== __BUILD_TIME__
  } catch {
    return false // offline or blocked — don't force a reload on a guess
  }
}
