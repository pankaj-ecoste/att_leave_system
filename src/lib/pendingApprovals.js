// What is waiting for THIS manager to decide (plan.md §40). "Waiting for the manager" means
// status 'Pending' — the same filter TeamPanel uses for its two pending lists, so the
// number in the banner always matches what the manager finds when they open My Team.
// (A leave a manager already approved shows 'Manager Approved' and is waiting on admin,
// not on them, so it is deliberately not counted.)
//
// plan.md §60 — On Duty and Work From Home are counted on their own (`onDuty`, `wfh`) so a same-day
// request is not hidden among ordinary leave; `leaves` is every OTHER leave type. The total is unchanged.
export function countPendingApprovals(teamLeaves, teamRegs) {
  const pendingLeaves = (teamLeaves || []).filter(l => l?.status === 'Pending')
  const onDuty = pendingLeaves.filter(l => l.leaveType === 'On Duty').length
  const wfh = pendingLeaves.filter(l => l.leaveType === 'Work From Home').length
  const leaves = pendingLeaves.length - onDuty - wfh
  const regs = (teamRegs || []).filter(r => r?.status === 'Pending').length
  return { leaves, onDuty, wfh, regs, total: leaves + onDuty + wfh + regs }
}

// One plain sentence for the banner, e.g. "4 requests waiting for your approval
// (1 On Duty, 1 WFH, 1 leave, 1 correction)". Returns null when nothing is waiting.
export function pendingApprovalsText({ leaves, onDuty, wfh, regs, total }) {
  if (!total) return null
  const parts = []
  if (onDuty) parts.push(`${onDuty} On Duty`)
  if (wfh) parts.push(`${wfh} WFH`)
  if (leaves) parts.push(`${leaves} leave`)
  if (regs) parts.push(`${regs} correction`)
  return `${total} ${total === 1 ? 'request' : 'requests'} waiting for your approval (${parts.join(', ')})`
}

// Browser-tab title with the count in front, so a manager with the app in a background
// tab still sees it. Zero (or nothing) puts the plain title back.
export function titleWithCount(baseTitle, total) {
  return total > 0 ? `(${total}) ${baseTitle}` : baseTitle
}
