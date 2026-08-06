-- Day 3 morning/midday — accrual, pro-rata for joiners, year-end lapse + EL payout
-- (plan.md Day 3, PROGRESS.md P4B-6, P4B-7, P4B-8).
--
-- Policy doc (ATPL|HR|22|1002): "For the first Ecoste year after joining, an employee
-- will be entitled for leaves on a Pro-rata basis" · "Balance CL at end of financial
-- year will lapse" · "Balance EL at end of financial year (upto 3 earned leaves per
-- year) will be paid to employee ... Example: balance of 5 EL -> 3 EL carried forward
-- for payment, 2 EL lapse."

-- ============ months_remaining_in_fy — same formula as scripts/seed-employees-and-holidays.mjs's
-- monthsRemainingInFY, moved into the database so a NEW hire gets the identical pro-rata
-- math the initial 131-employee import used, instead of a second hand-written copy that
-- could quietly drift out of sync. Counts the joining month as full if joined on/before
-- the 15th (same simple cutoff as the import script; admin can hand-adjust afterwards).
create or replace function public.months_remaining_in_fy(p_joining_date date)
 returns numeric
 language plpgsql
 immutable
as $function$
declare
  v_fy int := current_fy();
  v_fy_start date := make_date(v_fy, 4, 1);
  v_fy_end date := make_date(v_fy + 1, 3, 31);
  v_effective_start date;
  v_months int;
begin
  if p_joining_date is null then return 12; end if;
  if p_joining_date <= v_fy_start then return 12; end if;
  if p_joining_date > v_fy_end then return 0; end if;
  v_effective_start := case when extract(day from p_joining_date) <= 15
    then p_joining_date
    else (date_trunc('month', p_joining_date) + interval '1 month')::date
  end;
  v_months := (extract(year from v_fy_end) - extract(year from v_effective_start))::int * 12
    + (extract(month from v_fy_end) - extract(month from v_effective_start))::int + 1;
  return greatest(0, least(12, v_months));
end;
$function$;

-- ============ admin_create_employee — auto-generate pro-rata leave balances (P4B-7) ============
-- Previously a brand-new hire got zero leave_balances rows until either the next annual
-- reset or a manual admin_upsert_leave_balance call — the app would show them with no
-- balance at all (not even a pro-rated one) until someone noticed. Now every new hire
-- gets Casual/Earned/Sick balance rows the moment they're created, same pro-rata rule
-- the initial migration used (CL 1/month, EL 0.5/month, SL flat 4 — not pro-rated per
-- policy, lib/constants.js LEAVE_POLICY).

create or replace function public.admin_create_employee(p_token uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare v_row employees; v_joining_date date; v_months numeric; v_cl numeric; v_el numeric;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  v_joining_date := nullif(p_data->>'joiningDate', '')::date;
  insert into employees(name, pin, company, emp_num, job_title, business_unit, department, sub_department,
    location_info, cost_center, manager, email, phone, joining_date, shift_type, manager_emp_id,
    probation_end_date)
  values(
    p_data->>'name', crypt(coalesce(nullif(p_data->>'pin', ''), substr(md5(random()::text), 1, 4)), gen_salt('bf')),
    p_data->>'company',
    p_data->>'empNum', p_data->>'jobTitle', p_data->>'bu', p_data->>'dept',
    p_data->>'subDept', p_data->>'locationInfo', p_data->>'costCenter',
    p_data->>'manager', p_data->>'email', p_data->>'phone', v_joining_date,
    coalesce(nullif(p_data->>'shiftType', ''), 'none'),
    nullif(p_data->>'managerEmpId', '')::uuid,
    case when v_joining_date is not null then v_joining_date + interval '3 months' end
  )
  returning * into v_row;

  v_months := months_remaining_in_fy(v_joining_date);
  v_cl := least(12, v_months);
  v_el := least(6, v_months * 0.5);
  insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
  values
    (v_row.id, 'Casual Leave', v_cl, 0, v_cl, v_cl, 'Days'),
    (v_row.id, 'Earned Leave', v_el, 0, v_el, v_el, 'Days'),
    (v_row.id, 'Sick Leave', 4, 0, 4, 4, 'Days')
  on conflict (emp_id, leave_type, financial_year) do nothing;

  return v_row;
end;
$function$;

-- ============ leave_payouts — EL payout record at year-end (P4B-8) ============
-- A separate table, not just a bigger leave_balances row: the payout is money HR owes
-- the employee, not leave days they still hold — keeping it out of leave_balances means
-- next year's EL balance can never accidentally include it.

create table if not exists "public"."leave_payouts" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "leave_type" text not null,
  "financial_year" integer not null,
  "days_paid" numeric not null default 0,
  "days_lapsed" numeric not null default 0,
  "created_at" timestamp with time zone default now() not null,
  unique (emp_id, leave_type, financial_year)
);

create index if not exists idx_leave_payouts_financial_year on leave_payouts (financial_year);

-- ============ run_annual_leave_rollover — the shared logic behind both the automatic
-- 1-April cron and the existing manual "Reset for New FY" admin button (P4B-6, P4B-8) ============
-- p_new_fy is the year being CREATED (e.g. 2027 for the FY that starts 1 April 2027).
-- When called with no argument (the cron path, firing exactly at the boundary),
-- current_fy() has already rolled over to the new year by the time cron fires, so it's
-- used directly rather than "+1" (which is only correct when called *before* the
-- boundary — see admin_reset_leave_balances below, which still does need the +1).

create or replace function public.run_annual_leave_rollover(p_new_fy integer default null)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_new_fy int := coalesce(p_new_fy, current_fy());
  v_closing_fy int := v_new_fy - 1;
  v_count int;
  v_payout_count int;
begin
  insert into leave_payouts (emp_id, leave_type, financial_year, days_paid, days_lapsed)
  select emp_id, leave_type, v_closing_fy, least(balance, 3), greatest(balance - 3, 0)
  from leave_balances
  where financial_year = v_closing_fy and leave_type = 'Earned Leave' and balance > 0
  on conflict (emp_id, leave_type, financial_year) do nothing;
  get diagnostics v_payout_count = row_count;

  insert into leave_balances(emp_id, leave_type, accrued, consumed, balance, quota, unit, financial_year)
  select emp_id, leave_type, quota, 0, quota, quota, unit, v_new_fy
  from leave_balances
  where financial_year = v_closing_fy
  on conflict (emp_id, leave_type, financial_year) do nothing;
  get diagnostics v_count = row_count;

  perform log_audit('LEAVE_ANNUAL_ROLLOVER',
    'FY ' || v_closing_fy || ' -> ' || v_new_fy || ': ' || v_count || ' balance rows created, ' || v_payout_count || ' EL payout rows recorded',
    'system');
  return v_count;
end;
$function$;

-- Postgres grants EXECUTE to PUBLIC by default on every new function — 0002 already
-- revoked this for log_audit for exactly this reason. But `revoke ... from public`
-- alone turns out not to be enough on Supabase: every new project bootstraps with
-- `alter default privileges in schema public grant execute on functions to anon,
-- authenticated, service_role`, which hands `anon` its own DIRECT grant, entirely
-- separate from PUBLIC. Revoking from PUBLIC never touches that — confirmed live
-- (log_audit's own ACL still listed anon explicitly despite the 0002 revoke, and a
-- live anon RPC call to it succeeded). Fixed properly here for both the new function
-- and, as a drive-by correction, the pre-existing log_audit gap the 0002 comment
-- believed was already closed: without this, any anon session could call
-- run_annual_leave_rollover directly over RPC and regenerate every employee's leave
-- balances company-wide with no admin check at all, or call log_audit to forge audit
-- entries. Both are only ever meant to run from inside another SECURITY DEFINER
-- function (which still works — the definer's own privileges cover the internal call,
-- same as every other un-granted helper in this codebase) or, for the rollover, the
-- cron job, which runs as the database owner and was never subject to these grants.
revoke execute on function public.run_annual_leave_rollover(integer) from public, anon, authenticated;
revoke execute on function public.months_remaining_in_fy(date) from public, anon, authenticated;
revoke execute on function public.log_audit(text, text, text) from anon, authenticated;

-- admin_reset_leave_balances keeps its exact original timing assumption (clicked
-- manually before the boundary, hence current_fy() + 1) — it now delegates to the
-- shared rollover function so the EL-payout recording (P4B-8) happens on the manual
-- path too, not just the automatic one.
create or replace function public.admin_reset_leave_balances(p_token uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_count int;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  v_count := run_annual_leave_rollover(current_fy() + 1);
  return v_count;
end;
$function$;

-- The automatic path (P4B-6). 01:00 UTC on 1 April = ~06:30 IST, safely into 1 April IST
-- (IST is ahead of UTC, so the IST calendar date has already turned before this fires).
select cron.schedule(
  'annual-leave-rollover',
  '0 1 1 4 *',
  $$ select run_annual_leave_rollover(); $$
);

-- ============ admin_get_leave_payouts — HR visibility into what's owed (P4B-8) ============

create or replace function public.admin_get_leave_payouts(p_token uuid, p_financial_year integer default null)
 returns table(
   id uuid, emp_id uuid, emp_name text, emp_num text, leave_type text,
   financial_year integer, days_paid numeric, days_lapsed numeric, created_at timestamp with time zone
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select lp.id, lp.emp_id, e.name, e.emp_num, lp.leave_type, lp.financial_year, lp.days_paid, lp.days_lapsed, lp.created_at
    from leave_payouts lp
    join employees e on e.id = lp.emp_id
    where p_financial_year is null or lp.financial_year = p_financial_year
    order by lp.created_at desc;
end;
$function$;

-- Only the real RPC entry point is exposed to anon. months_remaining_in_fy and
-- run_annual_leave_rollover are internal helpers, only ever called from inside other
-- SECURITY DEFINER functions (admin_create_employee, admin_reset_leave_balances, the
-- cron job) — same pattern as is_valid_admin_token/log_audit/current_fy, none of which
-- carry an anon grant either. Granting either one directly would let any anon session
-- trigger a company-wide leave-balance reset with no admin check at all.
-- leave_payouts likewise gets no direct table grant — same as every other table in this
-- schema (leave_balances, attendance, audit_logs...), access is only through the
-- SECURITY DEFINER functions above, never a direct `.from('leave_payouts')` call.
grant execute on function public.admin_get_leave_payouts(uuid, integer) to anon;
