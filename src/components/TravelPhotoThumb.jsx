import { useState, useEffect } from 'react'
import { getTravelPhotoUrl } from '../api/travel'

// Shared by employee/manager/admin Travel screens (plan.md §28) — was three
// near-identical copies, consolidated into one. Loads a short-lived signed URL for a
// private travel-selfies object and shows it as a small clickable thumbnail; tapping it
// hands the full-size URL to onOpen so the caller can show it in <PhotoViewerModal>.
export function TravelPhotoThumb({ path, onOpen, className = 'w-12 h-12' }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    let cancelled = false
    getTravelPhotoUrl(path).then(u => { if (!cancelled) setUrl(u) }).catch(() => {})
    return () => { cancelled = true }
  }, [path])

  if (!url) return <div className={`${className} rounded-lg bg-white/5 shrink-0 animate-pulse`} />
  return (
    <button type="button" onClick={() => onOpen?.(url)} className={`${className} rounded-lg overflow-hidden shrink-0 focus:outline-none focus:ring-2 focus:ring-indigo-400`}>
      <img src={url} alt="" className="w-full h-full object-cover hover:opacity-80 transition-opacity" />
    </button>
  )
}
