-- plan.md §45 — facts the admin Analytics tab needs that the app could not read before.
--
-- 1. travel_daily_archive + a delete trigger. Settling an employee's travel DELETES all of their
--    travel_visits rows (plan.md §28 decision 8 — photos/points are removed once paid), so
--    "visits per month / visits in a day / km per month" would silently shrink or vanish the moment
--    a period is paid. The trigger copies a per-day summary (visits, km) of every deleted batch into
--    this small table first. It is a STATEMENT-level trigger so it sees the whole deleted batch at
--    once and can add each day's return leg (last visit -> punch-out) exactly like
--    travel_summary_for_employee does. It watches the table, not the settle function, so none of the
--    money-handling settle functions are touched. No foreign key on purpose: deleting an employee
--    cascades into travel_visits, and an FK here would then make that delete fail.
--    Not recoverable for periods already settled before this migration (their rows are gone).
--    Edge case accepted: if visits are added again on a day that was already archived, that day's
--    return leg can be counted once in the archive and once live.
--
-- 2. admin_get_travel_analytics(p_from, p_to): per employee, visits, km and the busiest single day
--    in the range, from live visits plus the archive.
-- 3. admin_get_device_reset_counts(p_from, p_to): how many times HR reset each person's device
--    (from the audit log), in the range and in total.
-- Both return jsonb (a plain array) and are admin-token checked, like every other admin function.

create table if not exists public.travel_daily_archive (
  emp_id uuid not null,
  date   date not null,
  visits int  not null,
  km     numeric not null,
  primary key (emp_id, date)
);
alter table public.travel_daily_archive enable row level security;
revoke all on table public.travel_daily_archive from anon, authenticated;

create or replace function public.archive_deleted_travel_visits()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  insert into travel_daily_archive (emp_id, date, visits, km)
  select o.emp_id, o.date, count(*)::int,
         sum(o.leg_distance_km) + coalesce(max(ret.km), 0)
  from old_rows o
  left join lateral (
    select haversine_m(lv.lat, lv.lon, a.out_lat, a.out_lon) / 1000.0 as km
    from (select x.lat, x.lon from old_rows x where x.emp_id = o.emp_id and x.date = o.date order by x.captured_at desc limit 1) lv
    join attendance a on a.emp_id = o.emp_id and a.date = o.date
    where a.out_lat is not null and a.out_lon is not null
  ) ret on true
  group by o.emp_id, o.date
  on conflict (emp_id, date) do update
    set visits = travel_daily_archive.visits + excluded.visits,
        km = travel_daily_archive.km + excluded.km;
  return null;
end;
$function$;

drop trigger if exists trg_archive_deleted_travel_visits on public.travel_visits;
create trigger trg_archive_deleted_travel_visits
  after delete on public.travel_visits
  referencing old table as old_rows
  for each statement
  execute function public.archive_deleted_travel_visits();

create or replace function public.admin_get_travel_analytics(p_token uuid, p_from date, p_to date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return coalesce((
    with live as (
      select v.emp_id, v.date, count(*)::int as visits, sum(v.leg_distance_km) as leg_km
      from travel_visits v
      where v.date between p_from and p_to
      group by v.emp_id, v.date
    ), last_visit as (
      select distinct on (v.emp_id, v.date) v.emp_id, v.date, v.lat, v.lon
      from travel_visits v
      where v.date between p_from and p_to
      order by v.emp_id, v.date, v.captured_at desc
    ), live_days as (
      select l.emp_id, l.date, l.visits,
             l.leg_km + coalesce(haversine_m(lv.lat, lv.lon, a.out_lat, a.out_lon) / 1000.0, 0) as km
      from live l
      join last_visit lv on lv.emp_id = l.emp_id and lv.date = l.date
      left join attendance a on a.emp_id = l.emp_id and a.date = l.date
                             and a.out_lat is not null and a.out_lon is not null
    ), all_days as (
      select emp_id, date, visits, km from live_days
      union all
      select ar.emp_id, ar.date, ar.visits, ar.km from travel_daily_archive ar
      where ar.date between p_from and p_to
    ), merged as (
      select emp_id, date, sum(visits)::int as visits, sum(km) as km
      from all_days group by emp_id, date
    ), best as (
      select distinct on (emp_id) emp_id, visits as best_visits, date as best_date
      from merged order by emp_id, visits desc, date
    ), totals as (
      select emp_id, sum(visits)::int as visits, sum(km) as km from merged group by emp_id
    )
    select jsonb_agg(jsonb_build_object(
             'empId', e.id, 'name', e.name, 'company', e.company,
             'visits', t.visits, 'km', round(t.km, 2),
             'bestDayVisits', b.best_visits, 'bestDayDate', b.best_date) order by e.name)
    from totals t
    join best b on b.emp_id = t.emp_id
    join employees e on e.id = t.emp_id and e.deleted_at is null
  ), '[]'::jsonb);
end;
$function$;

create or replace function public.admin_get_device_reset_counts(p_token uuid, p_from date, p_to date)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('name', x.name, 'inRange', x.in_range, 'total', x.total) order by x.name)
    from (
      select trim(split_part(a.detail, ' — ', 1)) as name,
             (count(*) filter (where (a.ts at time zone 'Asia/Kolkata')::date between p_from and p_to))::int as in_range,
             count(*)::int as total
      from audit_logs a
      where a.action = 'PUNCH_DEVICE_RESET'
      group by trim(split_part(a.detail, ' — ', 1))
    ) x
  ), '[]'::jsonb);
end;
$function$;

grant execute on function public.admin_get_travel_analytics(uuid, date, date) to anon;
grant execute on function public.admin_get_device_reset_counts(uuid, date, date) to anon;
