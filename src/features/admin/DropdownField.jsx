import { useState } from 'react'
import { Button } from '../../components/ui/Button'
import { Input, Label, Select } from '../../components/ui/Input'
import { selectValues } from '../../lib/dropdownOptions'

// plan.md §54 — one of the four employee dropdowns. Picks from the list; "+ Add new…" opens a small
// box to add a value to the list for everyone (the server tidies it and refuses a duplicate).
const ADD = '__add_new__'

export function DropdownField({ label, required, options, value, onChange, onAdd }) {
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [err, setErr] = useState('')

  async function add() {
    try {
      const created = await onAdd(text)
      onChange(created.value)
      setAdding(false); setText(''); setErr('')
    } catch (e) { setErr(e.message) }
  }

  return (
    <div>
      <Label>{label}{required ? '*' : ''}</Label>
      {adding ? (
        <div className="space-y-1.5">
          <Input autoFocus placeholder={`New ${label.toLowerCase()}`} value={text} onChange={e => setText(e.target.value)} />
          <div className="flex gap-1.5">
            <Button className="text-xs py-1 px-3" onClick={add}>Add</Button>
            <Button variant="secondary" className="text-xs py-1 px-3" onClick={() => { setAdding(false); setText(''); setErr('') }}>Cancel</Button>
          </div>
          {err && <p className="text-red-400 text-xs">{err}</p>}
        </div>
      ) : (
        <Select value={value || ''} onChange={e => (e.target.value === ADD ? setAdding(true) : onChange(e.target.value))}>
          <option value="">— Select —</option>
          {selectValues(options, value).map(v => <option key={v.value} value={v.value}>{v.value}{v.notInList ? ' (not in list)' : ''}</option>)}
          <option value={ADD}>+ Add new…</option>
        </Select>
      )}
    </div>
  )
}
