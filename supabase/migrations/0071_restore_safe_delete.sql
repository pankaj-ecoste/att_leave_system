-- plan.md §57 — make the app's Delete button SAFE again (re-applies migration 0017's design).
--
-- Found 2026-10-27: the LIVE admin_delete_employee was a hard `delete from employees` (cascading through attendance,
-- leave, balances, travel ...) and admin_get_employees did not hide removed staff — a later migration (0023) had
-- overwritten 0017's soft-delete versions. So "Delete" erased a leaver's whole history, and anyone soft-removed
-- by other means still showed in the admin list.
--
-- Now: Delete only marks the employee (deleted_at = now(), active = false) and writes the audit entry — history is
-- kept. The admin Employees list hides marked employees. Login, the directory and team lists already check `active`,
-- so a deleted person cannot sign in and does not appear there. Someone brought back by a developer only needs
-- deleted_at cleared and active set to true. Numbered after 0023 on purpose so a replay cannot overwrite it again.

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
