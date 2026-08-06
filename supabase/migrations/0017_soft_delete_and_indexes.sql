-- Day 3 evening — soft delete for employees + a reporting index (plan.md §8B S-4,
-- PROGRESS.md P6-3, P6-4).
--
-- admin_delete_employee was a hard `delete from employees` — cascading (on delete
-- cascade) through attendance, leave_applications, leave_balances, leave_payouts,
-- location_logs, od_tracking_logs and regularization_requests for that employee.
-- Deleting someone by mistake, or deleting a genuine leaver, permanently destroyed
-- their whole attendance/leave history — exactly the kind of one-way action plan.md
-- §8C's "bug-free and debuggable" priority argues against. `employees.active` already
-- exists but means something else (admin_toggle_employee_status flips it for a
-- deliberate deactivate/reactivate, distinct from a delete) — deleted_at is a second,
-- separate marker so the two concepts don't collide.

alter table employees add column if not exists deleted_at timestamp with time zone;

create or replace function public.admin_delete_employee(p_token uuid, p_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_name text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select name into v_name from employees where id = p_id;
  update employees set deleted_at = now(), active = false, updated_at = now() where id = p_id;
  perform log_audit('EMPLOYEE_DELETE', coalesce(v_name, p_id::text), 'admin');
  return true;
end;
$function$;

-- admin_get_employees (the admin panel's own employee list) drops soft-deleted rows —
-- matches what a hard delete used to look like from the UI's side. Their attendance,
-- leave and payout history stays intact and still joins fine everywhere else (reports,
-- audit logs, the annual rollover) since the employees row itself still exists.
create or replace function public.admin_get_employees(p_token uuid)
 returns setof employees
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from employees where deleted_at is null order by name;
end;
$function$;

-- P6-3 — leave_balances is filtered by financial_year in several hot paths
-- (run_annual_leave_rollover, admin_get_leave_balances, employee_get_leave_balances)
-- with no index backing that column alone (only the 3-column unique constraint, which
-- doesn't help a financial_year-only filter).
create index if not exists idx_leave_balances_financial_year on leave_balances (financial_year);
