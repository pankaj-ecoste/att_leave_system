-- V2 Phase C follow-up (2026-08-10, live user feedback after seeing 0024 in the app):
-- `0024_v2_phase_c_comp_off_and_accrual.sql` deliberately grandfathered every existing
-- employee's current CL/EL balance — nobody's number would drop, monthly credits would
-- only add on top going forward. After seeing that live, the user reversed that call:
-- every employee's CL/EL balance should reflect literal months-elapsed-since-joining
-- (same "1 CL/month, 0.5 EL/month" pace a brand new hire gets under 0024), not the old
-- front-loaded full-year amount — for EVERYONE, not just recent joiners. Confirmed
-- explicitly, including the consequence: an employee who already used more than the new
-- pace would've given them by now (e.g. used 11 CL when only 5 months have accrued)
-- shows a negative balance. That's intentional, not a bug — the existing
-- insufficient-balance check in employee_apply_leave (unchanged) already blocks any
-- further Casual/Earned Leave application once balance is at or below what's needed and
-- points the employee at LOP instead, which is exactly the policy described: "credit
-- allows only what's accrued; want more, take LOP."
--
-- Impact confirmed via a read-only dry run before writing anything: 276 CL/EL balance
-- rows, 274 reduced, 105 going negative (up to -6 for the largest cases). The user
-- confirmed this scale explicitly before this migration was written.

-- ============ months_elapsed_in_fy — mirrors months_remaining_in_fy's exact same
-- effective-start / <=15th-cutoff rule, counting elapsed months instead of remaining
-- ones. Kept as a real function (not inlined) since it's a genuine, reusable concept —
-- "how much has this person actually earned by today" — not just a one-off calculation.

create or replace function public.months_elapsed_in_fy(p_joining_date date)
 returns numeric
 language plpgsql
 stable
as $function$
declare
  v_fy_start date := make_date(current_fy(), 4, 1);
  v_effective_start date;
  v_elapsed int;
begin
  if p_joining_date is null or p_joining_date <= v_fy_start then
    v_effective_start := v_fy_start;
  else
    v_effective_start := case when extract(day from p_joining_date) <= 15
      then p_joining_date
      else (date_trunc('month', p_joining_date) + interval '1 month')::date
    end;
  end if;
  if v_effective_start > current_date then return 0; end if;
  v_elapsed := (extract(year from date_trunc('month', current_date)) - extract(year from v_effective_start))::int * 12
    + (extract(month from date_trunc('month', current_date)) - extract(month from v_effective_start))::int + 1;
  return greatest(0, least(12, v_elapsed));
end;
$function$;

revoke execute on function public.months_elapsed_in_fy(date) from public, anon, authenticated;

-- ============ One-time correction ============
-- Not wrapped in a reusable "run_" function — this is a single policy-reversal event,
-- not a recurring job. The recurring monthly crediting stays exactly as 0024 built it
-- (run_monthly_leave_accrual, CL +1/EL +0.5 on the 1st of every month); this just
-- re-anchors the STARTING point every current employee's drip continues from, so it
-- lines up with what they'd have if they'd been on the monthly model since 1 April.
--
-- Recording ONE ledger row per employee/type (not a fabricated row per elapsed month)
-- is deliberate — this codebase doesn't actually have real month-by-month history for
-- when in the past leave was consumed relative to monthly boundaries, so inventing
-- monthly rows would be dishonest bookkeeping. One clearly-labelled correction entry,
-- dated with period = the current month, is both accurate and — because its period
-- matches exactly what run_monthly_leave_accrual would use if it ran today — makes that
-- job's existing idempotency guard correctly skip re-crediting these same employees for
-- the current month; next month's real cron run adds the next increment on top, same as
-- for everyone else.

do $$
declare
  v_period date := date_trunc('month', current_date)::date;
  v_rec record;
  v_new_accrued numeric;
  v_new_balance numeric;
  v_delta numeric;
begin
  for v_rec in
    select lb.id, lb.emp_id, lb.leave_type, lb.accrued, lb.consumed, lb.quota, e.joining_date
    from leave_balances lb
    join employees e on e.id = lb.emp_id
    where lb.financial_year = current_fy() and lb.leave_type in ('Casual Leave', 'Earned Leave')
  loop
    v_new_accrued := case v_rec.leave_type
      when 'Casual Leave' then least(v_rec.quota, months_elapsed_in_fy(v_rec.joining_date) * 1)
      when 'Earned Leave' then least(v_rec.quota, months_elapsed_in_fy(v_rec.joining_date) * 0.5)
    end;
    v_delta := v_new_accrued - v_rec.accrued;
    continue when v_delta = 0;
    v_new_balance := v_new_accrued - v_rec.consumed;

    update leave_balances set accrued = v_new_accrued, balance = v_new_balance where id = v_rec.id;

    insert into leave_accruals (emp_id, leave_type, period, credited, used, running_balance, note)
    values (
      v_rec.emp_id, v_rec.leave_type, v_period,
      greatest(v_delta, 0), greatest(-v_delta, 0), v_new_balance,
      'v2_phase_c_elapsed_accrual_correction'
    )
    on conflict (emp_id, leave_type, period) do update set
      credited = excluded.credited, used = excluded.used, running_balance = excluded.running_balance, note = excluded.note;
  end loop;
end $$;
