-- plan.md §33.3 (system health audit, 2026-09-22) — §29 already fixed the worst 3
-- instances of Supabase's silent ~1000-row response cap (admin_get_attendance,
-- admin_get_leaves, admin_get_leave_balances) via fetchAllPages + a stable sort. This
-- migration closes the remaining 4 call sites that had the same unprotected shape:
-- three had no p_limit/p_offset at all (admin_get_all_location_logs,
-- admin_get_comp_off_payouts, admin_get_regularizations — genuinely unbounded single
-- requests), and admin_get_leave_accruals already had p_limit/p_offset but its ORDER BY
-- was not unique, which would have let batched pagination silently duplicate or skip a
-- row the moment two rows tied on the sort key (exactly the risk §29's own migration
-- 0047 was careful about).
--
-- Each function here gains a real, unique tiebreaker (its own id) as the final ORDER BY
-- column — required for fetchAllPages' LIMIT/OFFSET batching to be safe, same reasoning
-- as 0047_stable_sort_for_paged_admin_reads.sql.
--
-- Three of these four are gaining new parameters (p_limit/p_offset), which changes
-- their signature — `create or replace function` does NOT replace a function with a
-- different parameter list, it would silently leave the old, unpaginated version
-- callable side-by-side (the exact admin_update_settings bug from Day 3). Each of the
-- three has an explicit `drop function if exists` first. admin_get_leave_accruals
-- already has p_limit/p_offset, so only its ORDER BY changes — plain
-- `create or replace` is correct there, no signature change.

-- ============ 1. admin_get_all_location_logs — genuinely unbounded before this ============
-- ~300 staff x 2-hourly auto-tracking (~5 pings/person on a work day) plus punch and
-- On-Duty 5-min pings — a single busy day could already exceed the ~1000-row cap for
-- this "all locations, one date" admin view.
drop function if exists public.admin_get_all_location_logs(uuid, date);

create or replace function public.admin_get_all_location_logs(p_token uuid, p_date date, p_limit integer default 1000, p_offset integer default 0)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, date date, lat_lon text, type text, captured_at timestamp with time zone, lat numeric, lon numeric, accuracy_m numeric, site_name text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select l.id, l.emp_id, e.name, e.emp_num, l.date, l.lat_lon, l.type, l.captured_at, l.lat, l.lon, l.accuracy_m,
      case when l.lat is not null and l.lon is not null then
        (select ns.site_name from nearest_active_site(l.lat, l.lon) ns where ns.distance_m <= ns.radius_m limit 1)
      end as site_name
    from location_logs l join employees e on e.id = l.emp_id
    where l.date = p_date
    order by l.captured_at desc, l.id
    limit p_limit offset p_offset;
end;
$function$;

grant execute on function public.admin_get_all_location_logs(uuid, date, integer, integer) to anon;

-- ============ 2. admin_get_comp_off_payouts — genuinely unbounded before this ============
drop function if exists public.admin_get_comp_off_payouts(uuid, date);

create or replace function public.admin_get_comp_off_payouts(p_token uuid, p_period date default null, p_limit integer default 1000, p_offset integer default 0)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, period date, days_lapsed numeric, created_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select cop.id, cop.emp_id, e.name, e.emp_num, cop.period, cop.days_lapsed, cop.created_at
    from comp_off_payouts cop
    join employees e on e.id = cop.emp_id
    where p_period is null or cop.period = p_period
    order by cop.period desc, cop.id
    limit p_limit offset p_offset;
end;
$function$;

grant execute on function public.admin_get_comp_off_payouts(uuid, date, integer, integer) to anon;

-- ============ 3. admin_get_regularizations — genuinely unbounded before this ============
drop function if exists public.admin_get_regularizations(uuid);

create or replace function public.admin_get_regularizations(p_token uuid, p_limit integer default 1000, p_offset integer default 0)
 returns table(id uuid, emp_id uuid, emp_name text, emp_num text, date date, requested_in time without time zone, requested_out time without time zone, reason text, status text, created_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select r.id, r.emp_id, e.name, e.emp_num, r.date, r.requested_in, r.requested_out, r.reason, r.status, r.created_at
    from regularization_requests r join employees e on e.id = r.emp_id
    order by r.created_at desc, r.id
    limit p_limit offset p_offset;
end;
$function$;

grant execute on function public.admin_get_regularizations(uuid, integer, integer) to anon;

-- ============ 4. admin_get_leave_accruals — already paginated, sort was not unique ============
-- Same signature as before (uuid, uuid, text, integer, integer) — no drop needed, this
-- is a plain body change.
create or replace function public.admin_get_leave_accruals(
  p_token uuid, p_emp_id uuid default null, p_leave_type text default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns table(
   id uuid, emp_id uuid, emp_name text, emp_num text, leave_type text, period date,
   credited numeric, used numeric, running_balance numeric, note text, created_at timestamp with time zone
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select la.id, la.emp_id, e.name, e.emp_num, la.leave_type, la.period, la.credited, la.used, la.running_balance, la.note, la.created_at
    from leave_accruals la
    join employees e on e.id = la.emp_id
    where (p_emp_id is null or la.emp_id = p_emp_id)
      and (p_leave_type is null or la.leave_type = p_leave_type)
    order by la.period desc, la.created_at desc, la.id
    limit p_limit offset p_offset;
end;
$function$;
