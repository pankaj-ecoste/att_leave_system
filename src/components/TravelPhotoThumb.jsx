import { useState, useEffect } from 'react'

// Shared by employee/manager/admin Travel screens (plan.md §28) — was three
// near-identical copies, consolidated into one. Loads a short-lived signed URL for a
// private travel-selfies object and shows it as a small clickable thumbnail; tapping it
// hands the full-size URL to onOpen so the caller can show it in <PhotoViewerModal>.
//
// plan.md §33.2 — fetchUrl is injected by the caller rather than imported directly:
// employee/manager/admin each need a different, ownership-checked server call to get a
// signed link now that anon can no longer sign its own (migration 0053), and this
// component has no way to know which role it's rendering inside.
export function TravelPhotoThumb({ path, fetchUrl, onOpen, className = 'w-12 h-12' }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetchUrl(path).then(u => { if (!cancelled) setUrl(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [path, fetchUrl])

  if (!url) return <div className={`${className} rounded-lg bg-white/5 shrink-0 animate-pulse`} />
  return (
    <button type="button" onClick={() => onOpen?.(url)} className={`${className} rounded-lg overflow-hidden shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-400`}>
      <img src={url} alt="" className="w-full h-full object-cover hover:opacity-80 transition-opacity" />
    </button>
  )
}
