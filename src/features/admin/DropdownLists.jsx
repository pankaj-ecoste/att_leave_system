import { useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { DROPDOWN_LISTS } from '../../lib/dropdownOptions'

// plan.md §54 — Settings panel for the four employee dropdown lists: see every value and how many
// staff use it, add one, remove one that nobody uses (the server refuses to remove a used one).
export function DropdownLists({ dropdowns, addDropdownOption, removeDropdownOption, onAudit }) {
  const [drafts, setDrafts] = useState({})
  const [msg, setMsg] = useState({})

  const say = (kind, text) => setMsg(p => ({ ...p, [kind]: text }))

  async function add(kind) {
    try {
      const created = await addDropdownOption(kind, drafts[kind] || '')
      setDrafts(p => ({ ...p, [kind]: '' })); say(kind, '')
      onAudit?.('DROPDOWN_ADD', `${kind}: ${created.value}`, 'admin')
    } catch (e) { say(kind, e.message) }
  }

  async function remove(kind, o) {
    try {
      await removeDropdownOption(o.id); say(kind, '')
      onAudit?.('DROPDOWN_REMOVE', `${kind}: ${o.value}`, 'admin')
    } catch (e) { say(kind, e.message) }
  }

  return (
    <Card>
      <h3 className="text-white font-semibold mb-1">Dropdown Lists</h3>
      <p className="text-white/30 text-xs mb-4">The choices offered for Job Title, Department, Business Unit and Location when adding or editing an employee. A value can only be removed once no employee uses it.</p>
      <div className="space-y-4">
        {DROPDOWN_LISTS.map(l => (
          <div key={l.kind} className="bg-white/5 border border-white/10 rounded-xl p-3">
            <p className="text-white text-sm font-medium mb-2">{l.label} <span className="text-white/30 font-normal">({dropdowns?.[l.kind]?.length || 0})</span></p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {(dropdowns?.[l.kind] || []).map(o => (
                <span key={o.id} className="inline-flex items-center gap-1.5 text-xs bg-white/10 text-white/80 rounded-full pl-2.5 pr-1.5 py-1">
                  {o.value}<span className="text-white/30">{o.inUse}</span>
                  {o.inUse === 0 && <button className="text-red-300 hover:text-red-200 px-1" title="Remove (nobody uses it)" onClick={() => remove(l.kind, o)}>×</button>}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <Input className="py-2 text-sm" placeholder={`Add a ${l.label.toLowerCase()}`} value={drafts[l.kind] || ''} onChange={e => setDrafts(p => ({ ...p, [l.kind]: e.target.value }))} />
              <Button className="text-xs" onClick={() => add(l.kind)}>Add</Button>
            </div>
            {msg[l.kind] && <p className="text-red-400 text-xs mt-2">{msg[l.kind]}</p>}
          </div>
        ))}
      </div>
    </Card>
  )
}
