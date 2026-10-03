// What is waiting for THIS manager to decide (plan.md §40). "Waiting for the manager" means
// status 'Pending' — the same filter TeamPanel uses for its two pending lists, so the
// number in the banner always matches what the manager finds when they open My Team.
// (A leave a manager already approved shows 'Manager Approved' and is waiting on admin,
// not on them, so it is deliberately not counted.)
export function countPendingApprovals(teamLeaves, teamRegs) {
  const leaves = (teamLeaves || []).filter(l => l?.status === 'Pending').length
  const regs = (teamRegs || []).filter(r => r?.status === 'Pending').length
  return { leaves, regs, total: leaves + regs }
}

// One plain sentence for the banner, e.g. "3 requests waiting for your approval
// (2 leave, 1 correction)". Returns null when nothing is waiting.
export function pendingApprovalsText({ leaves, regs, total }) {
  if (!total) return null
  const parts = []
  if (leaves) parts.push(`${leaves} leave`)
  if (regs) parts.push(`${regs} correction`)
  return `${total} ${total === 1 ? 'request' : 'requests'} waiting for your approval (${parts.join(', ')})`
}

// Browser-tab title with the count in front, so a manager with the app in a background
// tab still sees it. Zero (or nothing) puts the plain title back.
export function titleWithCount(baseTitle, total) {
  return total > 0 ? `(${total}) ${baseTitle}` : baseTitle
}
