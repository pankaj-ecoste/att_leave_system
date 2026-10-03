import { Button } from '../../components/ui/Button'
import { pendingApprovalsText } from '../../lib/pendingApprovals'

// plan.md §40 — shown at the top of every employee-dashboard tab to a manager while at least
// one request is waiting for their decision, so they know the moment they open the app
// without having to go and look in My Team.
export function PendingApprovalsBanner({ pending, onReview }) {
  const text = pendingApprovalsText(pending)
  if (!text) return null
  return (
    <div role="status" className="rounded-2xl p-4 border bg-amber-500/15 border-amber-400/40 flex items-center justify-between gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <span className="text-2xl" aria-hidden="true">🔔</span>
        <p className="text-amber-100 text-sm font-semibold">{text}</p>
      </div>
      <Button className="text-xs flex-shrink-0" onClick={onReview}>Review now</Button>
    </div>
  )
}
