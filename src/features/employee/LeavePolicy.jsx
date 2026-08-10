import { Card } from '../../components/ui/Card'
import { LEAVE_POLICY } from '../../lib/constants'

// Plain-language walkthrough of ATPL|HR|22|1002 (the Leave Management Policy) — P4B-15.
// Numbers that the app actually enforces (CL/EL/SL quotas) come from LEAVE_POLICY so
// this page can never drift out of sync with what the system really does; everything
// else here is policy text that isn't stored as a constant anywhere (Marriage/Maternity
// day counts, the 18-month rule, LOP rules) — copied faithfully from the source PDF.

function Section({ title, children }) {
  return (
    <div className="mb-5 last:mb-0">
      <h3 className="text-white font-semibold text-sm mb-2">{title}</h3>
      <div className="text-white/60 text-sm space-y-1.5">{children}</div>
    </div>
  )
}

export function LeavePolicy() {
  return (
    <Card>
      <h2 className="text-white font-semibold mb-1">Leave Policy</h2>
      <p className="text-white/30 text-xs mb-5">ATPL|HR|22|1002 — plain-language summary. The official document is the final word.</p>

      <Section title="Leave year">
        <p>Runs 1 April to 31 March. Casual and Earned Leave are credited monthly (see below), not all at once — if you joined partway through the year, your first year's leave is pro-rated from your joining month, same as everyone else's monthly credit.</p>
      </Section>

      <Section title={`Casual Leave — ${LEAVE_POLICY.CASUAL.perYear} days/year`}>
        <p>Credited 1 day/month, full day or half day. Unused Casual Leave lapses at year-end — it doesn't carry forward.</p>
      </Section>

      <Section title={`Earned Leave — ${LEAVE_POLICY.EARNED.perYear} days/year`}>
        <p>Credited ½ day/month, full day or half day. At year-end, up to 3 unused days are paid out to you in May; anything beyond 3 lapses.</p>
      </Section>

      <Section title={`Sick Leave — ${LEAVE_POLICY.SICK.perYear} days/year`}>
        <p>Not pro-rated — every employee gets the full {LEAVE_POLICY.SICK.perYear} days regardless of joining date. Requires a medical certificate. Can be applied same-day (no advance notice needed).</p>
      </Section>

      <Section title="Marriage Leave">
        <p>Requires 18 months of service. 4 days for a first-degree family member's marriage, 7 days for your own — both need Manager + HR approval and a copy of the invitation card.</p>
      </Section>

      <Section title="Maternity Leave">
        <p>Requires 18 months of service. 1 week paid, covering before and after delivery. Up to 15 additional unpaid days and up to 1 month of WFH can be requested — both are at your manager's discretion. Available for up to 2 children.</p>
      </Section>

      <Section title="Paternity Leave">
        <p>Listed in the policy as an available leave type, but the policy document doesn't specify a number of days. Applications are reviewed case-by-case by your manager and HR.</p>
      </Section>

      <Section title="Bereavement Leave">
        <p>Up to 4 days, paid, for the death of an immediate family member (parents, grandparents, siblings, spouse, children, in-laws).</p>
      </Section>

      <Section title="LOP (Leave Without Pay)">
        <p>Applies when no other leave is available, or when leave is taken without approval. No pay for LOP days. If an unapproved absence spans a week-off or holiday, those days count as LOP too, not just the working days.</p>
        <p>An unapproved absence is treated as double: 1 day absent without permission = 2 days LOP.</p>
      </Section>

      <Section title="Half-day leave">
        <p>Casual, Sick and Earned Leave can each be taken as a half day (morning or afternoon) — deducts half a day from your balance instead of a full day.</p>
      </Section>

      <Section title="Compensatory Leave (Comp-Off)">
        <p>Earned automatically — working a full day on a Sunday or a listed holiday credits 1 Compensatory Leave day, no request needed. Applied through the portal exactly like Casual Leave (manager, then admin approval).</p>
        <p>Unused Compensatory Leave doesn't carry forward — any balance left at the end of a month is recorded as a payout for HR, not carried into the next month.</p>
      </Section>

      <Section title="Applying for leave">
        <p>Apply through the portal at least a day before you plan to take leave — except Sick Leave and Bereavement Leave, which can be applied for on the day itself.</p>
        <p>Your manager decides first; final approval is from admin. You'll see both stages reflected in your application's status.</p>
      </Section>

      <Section title="Probation and Notice Period">
        <p>Only 1 leave is allowed during Probation or your Notice Period. Any further leave during that time is treated as LOP. Taking more than 5 leaves during probation can affect your confirmation.</p>
      </Section>
    </Card>
  )
}
