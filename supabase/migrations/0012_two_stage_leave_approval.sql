-- Day 2 evening — real two-stage leave approval (plan.md Phase 4, Decision 9,
-- PROGRESS.md P4-1, P4-2, P4-8, P4-9).
--
-- What was actually happening before this: manager_decide_leave and admin_decide_leave
-- were two independent, unlinked functions writing straight to the same
-- leave_applications.status column. Either one could finalize any request the other
-- hadn't touched — there was no real second stage, no record of who decided what, and
-- no balance deduction anywhere. leave_applications is empty in this fresh HRMS build
-- (deliberately not migrated — plan.md, PROGRESS.md Q-10), so it's safe to add a CHECK
-- constraint on `status` now without any legacy value ever violating it.

alter table leave_applications add column if not exists manager_decision text check (manager_decision in ('Approved', 'Rejected'));
alter table leave_applications add column if not exists manager_decided_by uuid references employees(id) on delete set null;
alter table leave_applications add column if not exists manager_decided_at timestamp with time zone;
alter table leave_applications add column if not exists admin_decision text check (admin_decision in ('Approved', 'Rejected'));
alter table leave_applications add column if not exists admin_decided_at timestamp with time zone;

alter table leave_applications drop constraint if exists leave_applications_status_check;
alter table leave_applications add constraint leave_applications_status_check
  check (status in ('Pending', 'Manager Approved', 'Approved', 'Rejected'));

-- leave_balances never had an updated_at column — every other write path replaced the
-- whole row anyway (admin_upsert_leave_balance etc), so nothing needed it before now.
-- The balance deduction in admin_decide_leave below is the first partial update.
alter table leave_balances add column if not exists updated_at timestamp with time zone default now() not null;

-- ============ employee_apply_leave — block insufficient balance (P4-9) ============
-- Only the three quota-tracked types (plan.md §6A / lib/constants.js LEAVE_POLICY —
-- kept in sync by hand, same reasoning as the geofence haversine formula elsewhere)
-- have a real balance to run out of; the rest (Unpaid, Bereavement, Marriage,
-- Maternity, Paternity, WFH, On Duty, the two hourly Partial types) either aren't
-- capped yet (Q-5/Q-6/Q-7 still open) or aren't balance-tracked at all.

create or replace function public.employee_apply_leave(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row leave_applications;
  v_leave_type text := p_data->>'leave_type';
  v_balance numeric;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;

  if v_leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    select balance into v_balance from leave_balances
      where emp_id = p_emp_id and leave_type = v_leave_type and financial_year = current_fy();
    if v_balance is not null and v_balance < 1 then
      raise exception 'Insufficient % balance — 0 days remaining this year', v_leave_type;
    end if;
  end if;

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, reason, location, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, (p_data->>'date')::date, p_data->>'reason', p_data->>'location', 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$;

-- ============ manager_decide_leave — stage 1 only (P4-1) ============
-- Approving here does NOT finalize the request — it moves to 'Manager Approved' and
-- waits for admin (P4-4). Rejecting here IS final; there's no reason to make admin
-- re-review a rejection the manager already made.

create or replace function public.manager_decide_leave(p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row leave_applications;
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  if p_status not in ('Approved', 'Rejected') then raise exception 'Invalid decision'; end if;

  select la.* into v_row from leave_applications la
    join employees e on e.id = la.emp_id
    where la.id = p_leave_id and e.manager_emp_id = p_manager_id;
  if not found then raise exception 'Not authorized to action this request'; end if;
  if v_row.manager_decision is not null then raise exception 'Already decided'; end if;

  update leave_applications set
    manager_decision = p_status,
    manager_decided_by = p_manager_id,
    manager_decided_at = now(),
    status = case when p_status = 'Rejected' then 'Rejected' else 'Manager Approved' end,
    updated_at = now()
  where id = p_leave_id
  returning * into v_row;
  perform log_audit('LEAVE_DECISION', 'Leave ' || p_leave_id || ' -> manager ' || p_status, 'manager:' || p_manager_id);
  return v_row;
end;
$function$;

-- ============ admin_decide_leave — stage 2, or direct for no-manager staff (P4-2, P4-8) ============
-- Requires manager_decision = 'Approved' first, UNLESS the employee has no manager at
-- all (plan.md P4-2 — "route straight to admin"), in which case admin acts as both
-- stages. Deducts 1 unit from leave_balances on final Approved — the balance side of
-- P4-8, which never happened anywhere in the old flow.

create or replace function public.admin_decide_leave(p_token uuid, p_leave_id uuid, p_decision text)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row leave_applications;
  v_manager_emp_id uuid;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_decision not in ('Approved', 'Rejected') then raise exception 'Invalid decision'; end if;

  -- A row-typed target (v_row leave_applications) can't share an INTO list with
  -- another target (Postgres: "record variable cannot be part of multiple-item INTO
  -- list") — two queries instead of one join.
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

  if p_decision = 'Approved' and v_row.leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    update leave_balances set consumed = consumed + 1, balance = balance - 1, updated_at = now()
      where emp_id = v_row.emp_id and leave_type = v_row.leave_type and financial_year = current_fy();
  end if;

  perform log_audit('LEAVE_DECISION', 'Leave ' || p_leave_id || ' -> admin ' || p_decision, 'admin');
  return v_row;
end;
$function$;

-- ============ admin_get_leaves — carry manager info so admin sees who already decided (P4-4) ============
-- Column-list change on a RETURNS TABLE function needs the drop-first guard (same
-- reason as fetch_directory in 0005, admin_get_all_location_logs in 0003/0008).

drop function if exists public.admin_get_leaves(uuid, text, date, date, integer, integer);

create or replace function public.admin_get_leaves(
  p_token uuid, p_status text default null, p_from date default null, p_to date default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns table(
   id uuid, emp_id uuid, emp_name text, company text, leave_type text, date date, reason text, location text,
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
    select la.id, la.emp_id, la.emp_name, la.company, la.leave_type, la.date, la.reason, la.location,
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
