import { useEffect, useRef } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'

// plan.md §28 — route line connecting a day's selfie points. Free (OpenStreetMap tiles,
// no API key), and this file is only ever reached via a lazy `import()` from wherever
// it's used, so Leaflet never ends up in the main bundle for the ~98% of people who
// never open a journey (same posture as AdminPanel's own lazy chunk, plan.md §26).
//
// `points` — ordered array of { id, lat, lon, label, kind, address? } where kind is
// 'start' | 'visit' | 'end'; clicking a 'visit' marker calls onSelectVisit(id).
// `address`, when already known (punch-in/out already have a stored reverse-geocoded
// location — dayPoints() passes it through), is shown immediately; a 'visit' point
// never has one stored, so it's fetched live on click via the same reverse_geocode()
// RPC the punch screen already uses (0005_field_staff_and_geo.sql) — so admin can see,
// right on the map, what the employee typed next to what GPS actually found there
// (plan.md §28's whole point: cross-check the claim against the real location).
async function fetchAddress(lat, lon) {
  try {
    const { data, error } = await supabase.rpc('reverse_geocode', { p_lat: lat, p_lon: lon })
    if (error) throw error
    return data || 'Address unavailable'
  } catch {
    return 'Address unavailable'
  }
}

function popupHtml(label, addressLine) {
  return `
    <div style="min-width:180px;max-width:240px">
      <div style="font-weight:600;color:#1e1b4b;margin-bottom:2px">${label}</div>
      <div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.03em;margin-top:4px">GPS location</div>
      <div style="font-size:12px;color:#374151">${addressLine}</div>
    </div>
  `
}

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
      const label = p.label || `Stop ${i + 1}`
      marker.bindTooltip(label, { direction: 'top' })

      // Address already known (punch-in/out) -> show immediately. Otherwise (a client
      // visit) fetch live the moment the popup opens, replacing "Fetching..." in place.
      marker.bindPopup(popupHtml(label, p.address || 'Fetching...'))
      if (!p.address) {
        marker.on('popupopen', async () => {
          const address = await fetchAddress(p.lat, p.lon)
          marker.setPopupContent(popupHtml(label, address))
        })
      }

      if (p.kind === 'visit' && onSelectVisit) {
        marker.on('click', () => onSelectVisit(p.id))
      }
    })

    map.fitBounds(latlngs, { padding: [30, 30], maxZoom: 16 })
  }, [points, selectedId, onSelectVisit])

  return <div ref={containerRef} className="w-full h-72 rounded-xl overflow-hidden border border-white/10" />
}
