-- Day 3 morning — half-day leave (plan.md Day 3, PROGRESS.md P4B-1..P4B-5).
--
-- Policy doc (ATPL|HR|22|1002 §Casual Leave/Earned Leave): "CL/EL can be availed for a
-- full day or a half day." Sick Leave is included too per the existing plan.md decision
-- (half-day picker for Casual/Sick/Earned) — the three quota-tracked types, half a unit
-- deducted instead of a whole one.
--
-- Also closes a real gap found while building this: admin_decide_leave (0012) only ever
-- wrote to leave_applications and leave_balances. Approving a leave never touched that
-- day's attendance row, so the attendance grid kept showing the day as unpunched/Absent
-- even after a leave was fully approved. Fixed below as part of the same function, since
-- a half-day leave needs a status ('Half Day Leave') that didn't exist before this either.

alter table leave_applications add column if not exists day_part text not null default 'full'
  check (day_part in ('full', 'first_half', 'second_half'));

alter table attendance add column if not exists day_part text not null default 'full'
  check (day_part in ('full', 'first_half', 'second_half'));

-- ============ employee_apply_leave — half-day + one-application-per-date guard (P4B-2, P4B-5) ============
-- P4B-5 ("one half-day per date, no clash with full-day leave") is enforced as a single
-- blanket rule: at most one non-Rejected leave application per employee per date,
-- whatever the leave type or day part. Simpler than modelling which combinations of two
-- half-days would be legal, and matches the policy's plain intent (you take a day off,
-- once).

create or replace function public.employee_apply_leave(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row leave_applications;
  v_leave_type text := p_data->>'leave_type';
  v_day_part text := coalesce(nullif(p_data->>'day_part', ''), 'full');
  v_date date := (p_data->>'date')::date;
  v_balance numeric;
  v_needed numeric;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;

  if v_day_part not in ('full', 'first_half', 'second_half') then
    raise exception 'Invalid day part';
  end if;
  if v_day_part != 'full' and v_leave_type not in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    raise exception 'Half-day is only available for Sick, Casual and Earned Leave';
  end if;

  if exists (
    select 1 from leave_applications
    where emp_id = p_emp_id and date = v_date and status != 'Rejected'
  ) then
    raise exception 'A leave application already exists for %', v_date;
  end if;

  if v_leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    v_needed := case when v_day_part = 'full' then 1 else 0.5 end;
    select balance into v_balance from leave_balances
      where emp_id = p_emp_id and leave_type = v_leave_type and financial_year = current_fy();
    if v_balance is not null and v_balance < v_needed then
      raise exception 'Insufficient % balance — % remaining this year', v_leave_type, v_balance;
    end if;
  end if;

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, v_date, v_day_part, p_data->>'reason', p_data->>'location', 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$;

-- ============ admin_decide_leave — half-day deduction + mirror onto attendance (P4B-2, P4B-3) ============

create or replace function public.admin_decide_leave(p_token uuid, p_leave_id uuid, p_decision text)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row leave_applications;
  v_manager_emp_id uuid;
  v_deduct numeric;
  v_status text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_decision not in ('Approved', 'Rejected') then raise exception 'Invalid decision'; end if;

  select * into v_row from leave_applications where id = p_leave_id;
  if not found then raise exception 'Leave application not found'; end if;
  if v_row.admin_decision is not null then raise exception 'Already decided'; end if;

  select manager_emp_id into v_manager_emp_id from employees where id = v_row.emp_id;

  if v_manager_emp_id is not null and v_row.manager_decision is distinct from 'Approved' then
    raise exception 'Waiting on manager approval first';
  end if;

  update leave_applications set
    admin_decision = p_decision,
    admin_decided_at = now(),
    status = p_decision,
    updated_at = now()
  where id = p_leave_id
  returning * into v_row;

  if p_decision = 'Approved' then
    if v_row.leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
      v_deduct := case when v_row.day_part = 'full' then 1 else 0.5 end;
      update leave_balances set consumed = consumed + v_deduct, balance = balance - v_deduct, updated_at = now()
        where emp_id = v_row.emp_id and leave_type = v_row.leave_type and financial_year = current_fy();
    end if;

    v_status := case
      when v_row.day_part != 'full' then 'Half Day Leave'
      when v_row.leave_type = 'Work From Home' then 'WFH'
      when v_row.leave_type = 'On Duty' then 'On Duty'
      else 'Leave'
    end;

    -- Only the leave-related columns are written — an existing punch or biometric
    -- import row for the same date (e.g. someone who worked the other half of a
    -- half-day) survives untouched.
    insert into attendance (emp_id, date, leave_type, leave_reason, day_part, status, wfh, on_duty)
    values (v_row.emp_id, v_row.date, v_row.leave_type, v_row.reason, v_row.day_part, v_status,
      v_row.leave_type = 'Work From Home', v_row.leave_type = 'On Duty')
    on conflict (emp_id, date) do update set
      leave_type = excluded.leave_type, leave_reason = excluded.leave_reason,
      day_part = excluded.day_part, status = excluded.status,
      wfh = excluded.wfh, on_duty = excluded.on_duty, updated_at = now();
  end if;

  perform log_audit('LEAVE_DECISION', 'Leave ' || p_leave_id || ' -> admin ' || p_decision, 'admin');
  return v_row;
end;
$function$;

-- ============ admin_get_leaves — carry day_part (drop-first: column-list change) ============

drop function if exists public.admin_get_leaves(uuid, text, date, date, integer, integer);

create or replace function public.admin_get_leaves(
  p_token uuid, p_status text default null, p_from date default null, p_to date default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns table(
   id uuid, emp_id uuid, emp_name text, company text, leave_type text, date date, day_part text, reason text, location text,
   status text, applied_at timestamp with time zone, updated_at timestamp with time zone,
   manager_decision text, manager_decided_by uuid, manager_decided_at timestamp with time zone,
   admin_decision text, admin_decided_at timestamp with time zone,
   has_manager boolean, manager_name text
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select la.id, la.emp_id, la.emp_name, la.company, la.leave_type, la.date, la.day_part, la.reason, la.location,
      la.status, la.applied_at, la.updated_at,
      la.manager_decision, la.manager_decided_by, la.manager_decided_at,
      la.admin_decision, la.admin_decided_at,
      (e.manager_emp_id is not null) as has_manager, m.name as manager_name
    from leave_applications la
    join employees e on e.id = la.emp_id
    left join employees m on m.id = e.manager_emp_id
    where (p_status is null or la.status = p_status)
      and (p_from is null or la.date >= p_from)
      and (p_to is null or la.date <= p_to)
    order by la.date desc
    limit p_limit offset p_offset;
end;
$function$;

grant execute on function public.admin_get_leaves(uuid, text, date, date, integer, integer) to anon;
