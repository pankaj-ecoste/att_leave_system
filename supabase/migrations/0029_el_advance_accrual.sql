-- HR request received 2026-08-11: Earned Leave should be credited in ADVANCE — on the
-- 1st, for the month that's starting — not in arrears (waiting for a month to finish
-- before crediting it), which is what 0025/0026 deliberately switched to just one day
-- earlier. This reverses that decision, but ONLY for Earned Leave — Casual Leave stays
-- on the arrears model (months_elapsed_in_fy, unchanged) since HR's request named EL
-- specifically. The two leave types now genuinely run on different accrual timing.
--
-- Confirmed with the user before writing this (again touches real balances for 131+
-- people): (1) EL-only, not CL. (2) A one-time retroactive top-up for every current
-- employee's EL balance, not just future months/new hires — checked first that no EL
-- row is currently negative (133 active rows, min balance >= 0), so this is a pure
-- increase, nobody's balance changes direction.
--
-- run_monthly_leave_accrual() (0024) itself is untouched — it already fires once a
-- month, on the 1st, adding a flat +0.5 EL to everyone below quota. That mechanism was
-- never the arrears/advance switch; the switch lives entirely in (a) what a new hire's
-- EL starts at, and (b) the one-time alignment pass used to correct existing balances.

-- ============ months_elapsed_in_fy_advance — same effective-start logic as
-- months_elapsed_in_fy, but the current, still-in-progress month DOES count (the "+1"
-- 0026 deliberately removed). Kept as a separate function, not a replacement, since
-- Casual Leave still needs the arrears version. ============

create or replace function public.months_elapsed_in_fy_advance(p_joining_date date)
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
  v_elapsed := (extract(year from date_trunc('month', current_date)) - extract(year from v_effective_start))::int * 12
    + (extract(month from date_trunc('month', current_date)) - extract(month from v_effective_start))::int + 1;
  return greatest(0, least(12, v_elapsed));
end;
$function$;
revoke execute on function public.months_elapsed_in_fy_advance(date) from public, anon, authenticated;

-- ============ admin_create_employee — Earned Leave credited in advance at hire again
-- (same ≤15th-of-month cutoff as before), Casual Leave stays arrears (accrued=0) ============

create or replace function public.admin_create_employee(p_token uuid, p_data jsonb)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_row employees; v_joining_date date; v_months numeric;
  v_cl_quota numeric; v_el_quota numeric; v_el_advance numeric;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  v_joining_date := nullif(p_data->>'joiningDate', '')::date;
  insert into employees(name, pin, company, emp_num, job_title, business_unit, department, sub_department,
    location_info, cost_center, manager, email, phone, joining_date, shift_type, manager_emp_id,
    probation_end_date, work_mode, date_of_birth)
  values(
    p_data->>'name', crypt(coalesce(nullif(p_data->>'pin', ''), substr(md5(random()::text), 1, 4)), gen_salt('bf')),
    p_data->>'company',
    p_data->>'empNum', p_data->>'jobTitle', p_data->>'bu', p_data->>'dept',
    p_data->>'subDept', p_data->>'locationInfo', p_data->>'costCenter',
    p_data->>'manager', p_data->>'email', p_data->>'phone', v_joining_date,
    coalesce(nullif(p_data->>'shiftType', ''), 'none'),
    nullif(p_data->>'managerEmpId', '')::uuid,
    case when v_joining_date is not null then (v_joining_date + interval '3 months')::date else null end,
    coalesce(nullif(p_data->>'workMode', ''), 'office'),
    nullif(p_data->>'dateOfBirth', '')::date
  )
  returning * into v_row;

  v_months := months_remaining_in_fy(v_joining_date);
  v_cl_quota := least(12, v_months);
  v_el_quota := least(6, v_months * 0.5);
  -- Advance model, EL only: same immediate credit-at-hire the pre-0026 version had.
  v_el_advance := least(v_el_quota, months_elapsed_in_fy_advance(v_joining_date) * 0.5);

  insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
  values
    (v_row.id, 'Casual Leave', 0, 0, 0, v_cl_quota, 'Days'),
    (v_row.id, 'Earned Leave', v_el_advance, 0, v_el_advance, v_el_quota, 'Days'),
    (v_row.id, 'Sick Leave', 4, 0, 4, 4, 'Days')
  on conflict (emp_id, leave_type, financial_year) do nothing;

  perform log_audit('EMPLOYEE_CREATE', v_row.name || ' (' || coalesce(v_row.emp_num, v_row.id::text) || ')', 'admin');
  return v_row;
end;
$function$;

-- ============ One-time retroactive top-up — every current employee's EL balance moves
-- to what the advance model says they should already have. Additive only (months_elapsed
-- _in_fy_advance is always >= months_elapsed_in_fy), verified via a dry run before this
-- was written: 133 active EL rows, none negative going in, so no row can newly go
-- negative here. ============

do $$
declare
  v_period date := date_trunc('month', current_date)::date;
  v_rec record;
  v_new_accrued numeric;
  v_new_balance numeric;
  v_delta numeric;
begin
  for v_rec in
    select lb.id, lb.emp_id, lb.accrued, lb.consumed, lb.quota, e.joining_date
    from leave_balances lb
    join employees e on e.id = lb.emp_id
    where lb.financial_year = current_fy() and lb.leave_type = 'Earned Leave'
      and e.deleted_at is null and e.active
  loop
    v_new_accrued := least(v_rec.quota, months_elapsed_in_fy_advance(v_rec.joining_date) * 0.5);
    v_delta := v_new_accrued - v_rec.accrued;
    continue when v_delta <= 0;
    v_new_balance := v_new_accrued - v_rec.consumed;

    update leave_balances set accrued = v_new_accrued, balance = v_new_balance where id = v_rec.id;

    insert into leave_accruals (emp_id, leave_type, period, credited, running_balance, note)
    values (v_rec.emp_id, 'Earned Leave', v_period, v_delta, v_new_balance, 'v2_el_advance_accrual_correction')
    on conflict (emp_id, leave_type, period) do update set
      credited = leave_accruals.credited + excluded.credited,
      running_balance = excluded.running_balance,
      note = excluded.note;
  end loop;
end $$;
