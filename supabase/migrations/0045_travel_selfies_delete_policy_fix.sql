-- Security fix, same session as 0044_travel_allowance.sql (plan.md §28) — not a
-- pre-existing production function, this is correcting my own new code before calling
-- the feature done, per the "do not alter any running function" instruction meaning
-- pre-existing functions, not a licence to ship a hole in brand-new ones.
--
-- Finding: 0044 added `create policy "anon can delete travel selfies" on
-- storage.objects for delete to anon using (bucket_id = 'travel-selfies')` with zero
-- per-object scoping. This app has no real Supabase Auth — the anon key is public,
-- shipped in the client bundle — so that policy was the ENTIRE access check: anyone
-- holding the public key could call `supabase.storage.from('travel-selfies').remove([...])`
-- directly and delete any employee's site-visit selfie evidence, completely bypassing
-- admin_settle_travel_period's is_valid_admin_token check. The precedent bucket
-- (leave-documents, 0019) never had a delete policy at all — this was a genuinely new,
-- unscoped capability, not a repeat of an already-accepted pattern.
--
-- Fix: drop the anon delete policy entirely (the app never needs the CLIENT to delete
-- storage objects with just the anon key), and move the actual deletion inside
-- admin_settle_travel_period itself — it already runs SECURITY DEFINER as the table/
-- function owner, which bypasses storage.objects' RLS the same way it already bypasses
-- travel_visits'/travel_settlements' RLS, so no anon storage policy is needed for this
-- at all. Deleting the storage.objects row makes the file unreachable through every
-- Supabase API (list/get/signed-url all resolve against that row) even though the raw
-- bytes become an orphan in the backing store — functionally equivalent to deleted from
-- the app's point of view, same "harmless orphan, not a correctness issue" reasoning
-- already used for a best-effort cleanup step, just now done reliably server-side
-- instead of depending on a second client-side call with a wide-open policy.

drop policy if exists "anon can delete travel selfies" on storage.objects;

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

  v_amount := round(v_summary.total_km * v_rate, 2);

  select array_agg(v.photo_path) into v_paths from travel_visits v where v.emp_id = p_emp_id;

  insert into travel_settlements (emp_id, period_start, period_end, total_km, rate_tier, rate_per_km, amount, approved_by_admin, paid_at)
    values (p_emp_id, v_summary.first_date, v_summary.last_date, v_summary.total_km, v_tier, v_rate, v_amount, 'admin', now())
    returning * into v_settlement;

  -- Deletes the storage.objects rows directly, as this function's own definer
  -- privilege (bypasses storage RLS the same way it bypasses travel_visits' RLS) —
  -- no anon storage policy needed. See migration header for why this replaced a
  -- client-side anon delete call.
  delete from storage.objects where bucket_id = 'travel-selfies' and name = any(v_paths);

  delete from travel_visits where emp_id = p_emp_id;

  perform log_audit('TRAVEL_SETTLED', (select name from employees where id = p_emp_id) || ' — ' || v_summary.total_km || 'km, ₹' || v_amount, 'admin');

  return query select v_settlement, v_paths;
end;
$function$;
