import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input, Label } from '../../components/ui/Input'

const EMPTY_FORM = { name: '', latitude: '', longitude: '', radiusM: 100, active: true }

// Admin screen for the `sites` table (P3-1, plan.md §6B) — the office tiles on the
// punch screen render straight off however many active rows exist here, so this is the
// only place office locations get added, moved or retired. No hardcoded count of 3:
// the punch screen is data-driven off this list.
export function Sites({ sites, createSite, updateSite, deleteSite, onAudit }) {
  const [form, setForm] = useState(null)
  const [msg, setMsg] = useState('')
  const [listMsg, setListMsg] = useState('')

  function startCreate() {
    setForm(EMPTY_FORM)
    setMsg('')
  }
  function startEdit(site) {
    setForm({ ...site })
    setMsg('')
  }

  async function save() {
    if (!form.name.trim()) { setMsg('Name is required.'); return }
    const lat = Number(form.latitude)
    const lon = Number(form.longitude)
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) { setMsg('Latitude must be a number between -90 and 90.'); return }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) { setMsg('Longitude must be a number between -180 and 180.'); return }
    const radius = Number(form.radiusM)
    if (!Number.isFinite(radius) || radius <= 0) { setMsg('Radius must be a positive number of metres.'); return }
    const payload = { name: form.name.trim(), latitude: lat, longitude: lon, radiusM: radius, active: !!form.active }
    try {
      if (form.id) {
        const updated = await updateSite(form.id, payload)
        onAudit?.('SITE_UPDATE', `Site updated: ${updated.name}`, 'admin')
      } else {
        const created = await createSite(payload)
        onAudit?.('SITE_CREATE', `Site added: ${created.name}`, 'admin')
      }
      setForm(null)
    } catch (err) {
      setMsg(`Error: ${err.message}`)
    }
  }

  async function remove(site) {
    if (!window.confirm(`Remove "${site.name}"? Employees tagged Office will lose this punch tile.`)) return
    try {
      await deleteSite(site.id)
      onAudit?.('SITE_DELETE', `Site removed: ${site.name}`, 'admin')
      setListMsg('')
    } catch (err) {
      setListMsg(err.message)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-semibold">Office Sites</h3>
            <p className="text-white/30 text-xs mt-1">
              Each active site becomes a punch tile for Office-tagged staff, with a hard geofence — outside the radius, the punch is rejected server-side (plan.md §6B).
            </p>
          </div>
          {!form && <Button className="text-xs whitespace-nowrap" onClick={startCreate}>+ Add Site</Button>}
        </div>
        {listMsg && <p className="text-red-400 text-xs mb-3">{listMsg}</p>}

        {form && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 p-3 bg-white/5 rounded-xl border border-white/10">
            <div className="md:col-span-2">
              <Label>Site Name</Label>
              <Input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Head Office" />
            </div>
            <div>
              <Label>Latitude</Label>
              <Input type="number" step="0.000001" value={form.latitude} onChange={e => setForm(f => ({ ...f, latitude: e.target.value }))} placeholder="28.704100" />
            </div>
            <div>
              <Label>Longitude</Label>
              <Input type="number" step="0.000001" value={form.longitude} onChange={e => setForm(f => ({ ...f, longitude: e.target.value }))} placeholder="77.102500" />
            </div>
            <div>
              <Label>Radius (metres)</Label>
              <Input type="number" min="10" value={form.radiusM} onChange={e => setForm(f => ({ ...f, radiusM: e.target.value }))} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 text-white/60 text-sm cursor-pointer pb-2.5">
                <input type="checkbox" checked={!!form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} className="accent-indigo-500 w-4 h-4" />
                Active (shown as a punch tile)
              </label>
            </div>
            <div className="md:col-span-2 flex gap-2 items-center">
              <Button className="text-xs" onClick={save}>{form.id ? 'Save Changes' : 'Add Site'}</Button>
              <Button variant="secondary" className="text-xs" onClick={() => setForm(null)}>Cancel</Button>
              {msg && <p className="text-red-400 text-xs">{msg}</p>}
            </div>
          </div>
        )}

        {sites.length === 0 ? (
          <p className="text-white/30 text-sm text-center py-4">No sites added yet — punch screens show only Field/WFH tiles until at least one is added here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-white/70">
              <thead>
                <tr className="border-b border-white/10">
                  {['Name', 'Coordinates', 'Radius', 'Status', ''].map(h => (
                    <th key={h} className="text-left py-2 pr-4 text-white/30 font-medium uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sites.map(s => (
                  <tr key={s.id} className="border-b border-white/5 hover:bg-white/5">
                    <td className="py-2 pr-4 text-white/80 font-medium">{s.name}</td>
                    <td className="py-2 pr-4 font-mono text-white/50">{s.latitude.toFixed(6)}, {s.longitude.toFixed(6)}</td>
                    <td className="py-2 pr-4">{s.radiusM} m</td>
                    <td className="py-2 pr-4">
                      <span className={`px-2 py-0.5 rounded-full text-xs border ${s.active ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' : 'bg-white/5 text-white/40 border-white/10'}`}>
                        {s.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="py-2 flex gap-2">
                      <Button className="text-xs" onClick={() => startEdit(s)}>Edit</Button>
                      <Button variant="danger" className="text-xs" onClick={() => remove(s)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
