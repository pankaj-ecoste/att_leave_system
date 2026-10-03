import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import {
  probationCompleted, workAnniversariesToday, awaitingAdminApproval, overdueRequests, missingDetails, OVERDUE_DAYS,
  whatsappLink, birthdayWishText, anniversaryWishText,
} from '../../lib/adminAlerts'

// plan.md §42 — "Needs your attention", at the top of the admin Dashboard: probation
// completions, today's birthdays and work anniversaries (each with a WhatsApp wish button),
// and what is waiting for the admin's decision. Shows nothing at all when there is nothing.
//
// The WhatsApp button opens a chat with the person and the official wish already typed
// (WhatsApp's click-to-chat link). It does not send anything — the admin presses Send.

const WA_BUTTON = 'text-xs py-1 px-2.5 rounded-lg font-medium bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 transition-all'

function WishButton({ phone, text }) {
  const href = whatsappLink(phone, text)
  if (!href) return <span className="text-white/30 text-xs">No valid phone on file</span>
  return <a href={href} target="_blank" rel="noopener noreferrer" className={WA_BUTTON}>Send WhatsApp wish</a>
}

export function AdminAlerts({ employees, leaves, adminRegs, todaysBirthdays, markBirthdayWished, onNavigate, today }) {
  const probation = probationCompleted(employees, today)
  const anniversaries = workAnniversariesToday(employees, today)
  const waiting = awaitingAdminApproval(leaves, adminRegs)
  const overdue = overdueRequests(leaves, adminRegs, today)
  const missing = missingDetails(employees)
  const phoneOf = empId => employees.find(e => e.id === empId)?.phone

  if (!probation.length && !anniversaries.length && !todaysBirthdays.length && !waiting.total && !missing.length) return null

  return (
    <Card>
      <h3 className="text-white font-semibold text-sm mb-3">🔔 Needs your attention</h3>
      <div className="space-y-4">
        {waiting.total > 0 && (
          <div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-white/80 text-xs">
                <span className="text-amber-300 font-semibold">{waiting.total} request{waiting.total !== 1 ? 's' : ''} waiting for your approval</span>
                {' '}({waiting.leaves} leave, {waiting.regs} correction)
              </p>
              <Button variant="secondary" className="text-xs py-1 px-2.5 flex-shrink-0" onClick={() => onNavigate('leaves')}>Review</Button>
            </div>
            {overdue.length > 0 && (
              // Already counted above — this only singles out the ones that have waited too long.
              <p className="text-red-300 text-xs mt-1.5">
                ⏰ {overdue.length} waiting {OVERDUE_DAYS}+ days:{' '}
                {overdue.slice(0, 3).map(o => `${o.name || 'Employee'} (${o.kind === 'leave' ? o.label : 'correction'}, ${o.days} days)`).join(', ')}
                {overdue.length > 3 ? ` and ${overdue.length - 3} more` : ''}
              </p>
            )}
          </div>
        )}

        {probation.length > 0 && (
          <div>
            <p className="text-amber-300 text-xs font-semibold mb-1.5">
              ✅ {probation.length} employee{probation.length !== 1 ? 's' : ''} completed probation — change their tag to Fixed
            </p>
            <div className="space-y-1.5">
              {probation.map(e => (
                <div key={e.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/70">{e.name} — {e.company?.split(' ')[0]} · probation ended {e.probationEndDate}</span>
                  <Button variant="secondary" className="text-xs py-1 px-2.5 flex-shrink-0" onClick={() => onNavigate('employees')}>Review &amp; confirm</Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {todaysBirthdays.length > 0 && (
          <div>
            <p className="text-amber-300 text-xs font-semibold mb-1.5">🎂 {todaysBirthdays.length} birthday{todaysBirthdays.length !== 1 ? 's' : ''} today</p>
            <div className="space-y-1.5">
              {todaysBirthdays.map(b => (
                <div key={b.empId} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/70">{b.name} — {b.company?.split(' ')[0]}</span>
                  {b.acked ? (
                    <span className="text-emerald-400">Wished ✓</span>
                  ) : (
                    <span className="flex items-center gap-2 flex-shrink-0">
                      <WishButton phone={phoneOf(b.empId)} text={birthdayWishText({ name: b.name, company: b.company })} />
                      <Button variant="secondary" className="text-xs py-1 px-2.5" onClick={() => markBirthdayWished(b.empId)}>Mark as done</Button>
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {anniversaries.length > 0 && (
          <div>
            <p className="text-amber-300 text-xs font-semibold mb-1.5">🎉 {anniversaries.length} work anniversar{anniversaries.length !== 1 ? 'ies' : 'y'} today</p>
            <div className="space-y-1.5">
              {anniversaries.map(e => (
                <div key={e.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/70">{e.name} — {e.company?.split(' ')[0]} · {e.years} year{e.years !== 1 ? 's' : ''}</span>
                  <span className="flex-shrink-0">
                    <WishButton phone={e.phone} text={anniversaryWishText({ name: e.name, company: e.company, years: e.years })} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {missing.length > 0 && (
          // A long-running tidy-up list, not something that happened today: collapsed by default
          // and not part of the badge number, so it can't drown out the real alerts.
          <details>
            <summary className="text-white/50 text-xs cursor-pointer select-none">
              📇 {missing.length} employee{missing.length !== 1 ? 's' : ''} missing a phone, birthday or email — wishes and emails can't reach them
            </summary>
            <div className="mt-2 space-y-1.5">
              {missing.slice(0, 8).map(m => (
                <div key={m.id} className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-white/70">{m.name} — {m.company?.split(' ')[0]}</span>
                  <span className="text-white/40 flex-shrink-0">missing {m.missing.join(', ')}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 pt-1">
                <span className="text-white/30 text-xs">{missing.length > 8 ? `…and ${missing.length - 8} more` : ''}</span>
                <Button variant="secondary" className="text-xs py-1 px-2.5" onClick={() => onNavigate('employees')}>Open Employees</Button>
              </div>
            </div>
          </details>
        )}
      </div>
    </Card>
  )
}
