-- plan.md §31 follow-up (2026-09-22) — real root cause of "Settle & Pay isn't working":
-- confirmed via a dry-run (BEGIN; call the function; ROLLBACK — nothing real touched)
-- that admin_settle_travel_period has been failing on EVERY call, in every environment,
-- since 0045 first shipped it. Supabase does not allow a plain SQL `DELETE FROM
-- storage.objects` at all — it errors with "Direct deletion from storage tables is not
-- allowed. Use the Storage API instead." This was never caught before because 0045's
-- own verification only checked that the FUNCTION BODY matched expectations and that
-- unrelated functions were untouched — it never actually called the function itself.
-- Zero settlements have ever succeeded in production as a result (confirmed:
-- `select count(*) from travel_settlements` = 0).
--
-- Fix: admin_settle_travel_period goes back to NOT touching storage.objects directly —
-- it still deletes the travel_visits rows and writes the settlement (that part always
-- worked, it's plain table SQL) and returns the photo paths, same as before 0045. The
-- actual file deletion goes back to the client calling the real Storage API
-- (supabase.storage....remove()), which is the only thing that can legally delete a
-- storage object at all.
--
-- That reopens the exact question 0045 was fixing: a blanket anon DELETE policy would
-- let anyone with the public key delete an ACTIVE claim's evidence before it's ever
-- settled. This version closes that properly instead of not closing it at all: the
-- delete policy only succeeds for a path that no travel_visits row currently
-- references. Since admin_settle_travel_period already deletes those rows FIRST
-- (inside its own admin-token-gated transaction), a photo only becomes deletable via
-- this policy the moment it's already orphaned by a real settlement — an unsettled
-- visit's photo can never be removed this way, no matter who holds the anon key.
--
-- The check itself runs inside a SECURITY DEFINER function (travel_photo_is_orphaned)
-- rather than referencing travel_visits directly from the policy, since RLS policies
-- still need the calling role's own privileges to read a table they reference — and
-- anon deliberately has none on travel_visits, only on this one narrow yes/no check.

create or replace function public.travel_photo_is_orphaned(p_path text)
 returns boolean
 language sql
 security definer
 set search_path to 'public'
as $function$
  select not exists (
    select 1 from travel_visits v where v.photo_path = p_path or v.expense_photo_path = p_path
  );
$function$;

grant execute on function public.travel_photo_is_orphaned(text) to anon;

drop policy if exists "anon can delete travel selfies" on storage.objects;
drop policy if exists "anon can delete orphaned travel selfies" on storage.objects;
create policy "anon can delete orphaned travel selfies" on storage.objects for delete to anon
  using (bucket_id = 'travel-selfies' and travel_photo_is_orphaned(name));

create or replace function public.admin_settle_travel_period(p_token uuid, p_emp_id uuid)
 returns table(settlement travel_settlements, photo_paths text[])
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_summary record;
  v_tier text;
  v_rate numeric;
  v_amount numeric;
  v_settlement travel_settlements;
  v_paths text[];
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;

  select * into v_summary from travel_summary_for_employee(p_emp_id);
  if v_summary.visit_count is null or v_summary.visit_count = 0 then
    raise exception 'Nothing to settle for this employee';
  end if;

  select e.ta_rate_tier into v_tier from employees e where e.id = p_emp_id;
  if v_tier is null then
    raise exception 'Set this employee''s TA rate tier (Manager/Executive) before settling';
  end if;

  select case when v_tier = 'manager' then manager_rate_per_km else executive_rate_per_km end
    into v_rate from ta_settings where id = 1;

  v_amount := round(v_summary.total_km * v_rate, 2) + coalesce(v_summary.total_expense, 0);

  select coalesce(array_agg(v.photo_path), '{}'::text[])
      || coalesce(array_agg(v.expense_photo_path) filter (where v.expense_photo_path is not null), '{}'::text[])
    into v_paths from travel_visits v where v.emp_id = p_emp_id;

  insert into travel_settlements (emp_id, period_start, period_end, total_km, rate_tier, rate_per_km, amount, expense_amount, approved_by_admin, paid_at)
    values (p_emp_id, v_summary.first_date, v_summary.last_date, v_summary.total_km, v_tier, v_rate, v_amount, coalesce(v_summary.total_expense, 0), 'admin', now())
    returning * into v_settlement;

  -- travel_visits rows deleted here, BEFORE returning the paths — this is what makes
  -- them eligible for the client's follow-up storage delete under the policy above.
  delete from travel_visits where emp_id = p_emp_id;

  perform log_audit('TRAVEL_SETTLED', (select name from employees where id = p_emp_id) || ' — ' || v_summary.total_km || 'km + ₹' || coalesce(v_summary.total_expense, 0) || ' expenses = ₹' || v_amount, 'admin');

  return query select v_settlement, v_paths;
end;
$function$;
