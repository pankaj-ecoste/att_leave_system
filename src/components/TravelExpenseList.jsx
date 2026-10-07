import { useState } from 'react'
import { TravelPhotoThumb } from './TravelPhotoThumb'

// plan.md §48 — one day's standalone expenses (toll / lunch / other), shared by the staff,
// manager and admin travel screens. `onDelete` is passed only on the staff screen; the delete
// button then shows for expenses not yet in a submitted claim, and needs a second tap to confirm.
export function TravelExpenseList({ expenses, fetchPhotoUrl, onOpenPhoto, onDelete }) {
  const [confirmId, setConfirmId] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const [err, setErr] = useState('')
  if (!expenses || expenses.length === 0) return null

  async function remove(x) {
    if (confirmId !== x.id) { setConfirmId(x.id); return }
    setBusyId(x.id)
    setErr('')
    try {
      await onDelete(x)
    } catch (e) {
      setErr(e.message)
    } finally {
      setBusyId(null)
      setConfirmId(null)
    }
  }

  return (
    <div className="space-y-1.5 mt-2">
      {expenses.map(x => (
        <div key={x.id} className="flex items-center gap-3 p-2 rounded-xl border border-amber-500/20 bg-amber-500/5">
          <TravelPhotoThumb path={x.photoPath} fetchUrl={fetchPhotoUrl} onOpen={onOpenPhoto} className="w-10 h-10" />
          <div className="flex-1 min-w-0">
            <p className="text-amber-300 text-sm font-medium">{x.category} · ₹{x.amount.toFixed(2)}</p>
            <p className="text-white/30 text-xs">{new Date(x.capturedAt).toLocaleTimeString()}</p>
          </div>
          {onDelete && !x.claimId && (
            <button
              className={`text-xs ${confirmId === x.id ? 'text-red-400' : 'text-white/30 hover:text-white/60'}`}
              disabled={busyId === x.id} onClick={() => remove(x)}
            >
              {busyId === x.id ? 'Deleting...' : confirmId === x.id ? 'Tap again to delete' : 'Delete'}
            </button>
          )}
        </div>
      ))}
      {err && <p className="text-red-400 text-xs">{err}</p>}
    </div>
  )
}
