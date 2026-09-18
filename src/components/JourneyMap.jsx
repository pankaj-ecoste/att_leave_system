import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// plan.md §28 — route line connecting a day's selfie points. Free (OpenStreetMap tiles,
// no API key), and this file is only ever reached via a lazy `import()` from wherever
// it's used, so Leaflet never ends up in the main bundle for the ~98% of people who
// never open a journey (same posture as AdminPanel's own lazy chunk, plan.md §26).
//
// `points` — ordered array of { id, lat, lon, label, kind } where kind is
// 'start' | 'visit' | 'end'; clicking a 'visit' marker calls onSelectVisit(id).
export function JourneyMap({ points, onSelectVisit, selectedId }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    mapRef.current = L.map(containerRef.current, { scrollWheelZoom: false })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(mapRef.current)
    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (layerRef.current) { layerRef.current.remove() }
    const group = L.layerGroup().addTo(map)
    layerRef.current = group

    if (!points || points.length === 0) return

    const latlngs = points.map(p => [p.lat, p.lon])
    L.polyline(latlngs, { color: '#818cf8', weight: 3, opacity: 0.8, dashArray: '6 6' }).addTo(group)

    points.forEach((p, i) => {
      const isSelected = p.id === selectedId
      const color = p.kind === 'start' ? '#34d399' : p.kind === 'end' ? '#f87171' : isSelected ? '#fbbf24' : '#818cf8'
      const marker = L.circleMarker([p.lat, p.lon], {
        radius: p.kind === 'visit' ? (isSelected ? 10 : 8) : 7,
        color,
        weight: 2,
        fillColor: color,
        fillOpacity: 0.85,
      }).addTo(group)
      marker.bindTooltip(p.label || `Stop ${i + 1}`, { direction: 'top' })
      if (p.kind === 'visit' && onSelectVisit) {
        marker.on('click', () => onSelectVisit(p.id))
      }
    })

    map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 16 })
  }, [points, selectedId, onSelectVisit])

  return <div ref={containerRef} className="w-full h-72 rounded-xl overflow-hidden border border-white/10" />
}
