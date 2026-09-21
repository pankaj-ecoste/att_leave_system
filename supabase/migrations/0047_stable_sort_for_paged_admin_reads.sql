-- 0047 — plan.md §29. The admin attendance/leave reads are now fetched in batches by the
-- client (src/lib/paging.js) because Supabase caps one API response at ~1000 rows. Batches
-- are cut with LIMIT/OFFSET, which is only safe if the sort order is TOTAL — if two rows
-- tie on every sort column, Postgres may order them differently between the batch-1 and
-- batch-2 queries, so a row can be served twice or skipped entirely.
--
--   admin_get_attendance: was  order by a.date desc, e.name          (two staff with the
--                              same name on the same day tie)
--                         now  order by a.date desc, e.name, a.emp_id  (emp_id+date is unique)
--   admin_get_leaves:     was  order by date desc                     (any two leaves on the
--                              same day tie — the common case)
--                         now  order by date desc, id                 (id is the primary key)
--
-- admin_get_leave_balances already sorts by (emp_id, leave_type) filtered to one financial
-- year, which is unique (UNIQUE emp_id, leave_type, financial_year) — no change needed.
--
-- Bodies below are the LIVE production definitions (read with pg_get_functiondef on
-- 2026-09-21) plus the one extra sort column. Same signatures, so existing grants stay.

create or replace function public.admin_get_attendance(
  p_token uuid, p_from date default null, p_to date default null,
  p_company text default null, p_emp_id uuid default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns setof attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select a.* from attendance a
    join employees e on e.id = a.emp_id
    where (p_from is null or a.date >= p_from)
      and (p_to is null or a.date <= p_to)
      and (p_company is null or e.company = p_company)
      and (p_emp_id is null or a.emp_id = p_emp_id)
    order by a.date desc, e.name, a.emp_id
    limit p_limit offset p_offset;
end;
$function$;

create or replace function public.admin_get_leaves(
  p_token uuid, p_status text default null, p_from date default null, p_to date default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns setof leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select * from leave_applications
    where (p_status is null or status = p_status)
      and (p_from is null or date >= p_from)
      and (p_to is null or date <= p_to)
    order by date desc, id
    limit p_limit offset p_offset;
end;
$function$;
