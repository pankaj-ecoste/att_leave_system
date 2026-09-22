-- plan.md §28 follow-up (2026-09-22, real-world accuracy complaint) — Puneet Sharma's
-- punch-in -> Supernova leg showed 10.7km in the app vs ~15km on Google Maps. This is
-- exactly the known limitation flagged at plan.md §28's original discussion
-- (straight-line/haversine always understates real road distance) — now confirmed with
-- real evidence, so it's worth fixing at the source rather than relying on admin's
-- per-visit manual override every time.
--
-- Design: the EMPLOYEE'S save flow keeps working exactly as before — haversine at
-- insert time, instant, no external dependency, never blocks or slows down a field
-- save on a weak connection. A road-distance REFINEMENT runs separately, server-side,
-- only when admin reviews a journey (before settling) — same "a convenience, never the
-- reason something fails" posture reverse_geocode already uses (0005), same http
-- extension, same try/catch-and-return-null-on-any-failure pattern.
--
-- Uses OpenRouteService (openrouteservice.org) — free tier (2,000 req/day, no billing
-- info needed), plenty for ~20 field staff. The API key is never exposed to the
-- browser: stored in its own table with no anon grants at all, read only from inside
-- the SECURITY DEFINER function that calls the routing API, and the one admin-facing
-- "read" function returns only whether a key is set, never the key itself — same
-- "don't expose it even to the legitimate operator's own network tab" caution used
-- nowhere else in this app yet, worth starting here since this is the first real
-- external API key this app has needed to store at all.

create extension if not exists "http" with schema "extensions";

-- ============ 1. travel_routing_settings — the ORS key, admin-writable, never admin-readable ============

create table if not exists public.travel_routing_settings (
  "id" smallint not null primary key check (id = 1),
  "ors_api_key" text,
  "updated_at" timestamp with time zone default now() not null
);

insert into public.travel_routing_settings (id) values (1) on conflict (id) do nothing;

alter table travel_routing_settings enable row level security;
-- No anon grants at all — not even a "read status" policy. The only way in is the two
-- functions below, both of which check is_valid_admin_token first.

-- ============ 2. Refined-distance columns ============
-- Nullable: null means "not refined yet, still showing the instant haversine estimate"
-- — never a reason anything is blocked or looks broken while unrefined.

alter table travel_visits add column if not exists road_leg_km numeric;

-- Day-scoped, not visit-scoped: the last-visit -> punch-out leg was never its own row
-- (computed fresh in travel_summary_for_employee), so its refined value lives on that
-- day's attendance row instead — same reasoning as in_lat/out_lat already living there.
alter table attendance add column if not exists travel_return_road_km numeric;

-- ============ 3. road_distance_km — the actual ORS call ============
-- Internal only (no anon grant) — called from admin_refine_travel_distances below,
-- which already did its own token check; this never needs one of its own, same
-- posture as travel_summary_for_employee.

create or replace function public.road_distance_km(p_lat1 numeric, p_lon1 numeric, p_lat2 numeric, p_lon2 numeric)
 returns numeric
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare
  v_key text;
  v_resp extensions.http_response;
  v_url text;
  v_meters numeric;
begin
  select ors_api_key into v_key from travel_routing_settings where id = 1;
  if v_key is null or btrim(v_key) = '' then
    return null; -- no key configured yet — caller keeps showing the haversine estimate
  end if;

  v_url := format(
    'https://api.openrouteservice.org/v2/directions/driving-car?api_key=%s&start=%s,%s&end=%s,%s',
    v_key, p_lon1, p_lat1, p_lon2, p_lat2
  );

  begin
    select * into v_resp from extensions.http((
      'GET', v_url,
      array[extensions.http_header('Accept', 'application/json')],
      null, null
    )::extensions.http_request);
  exception when others then
    return null; -- road distance is a refinement, never the reason anything fails
  end;

  if v_resp.status is distinct from 200 then
    return null;
  end if;

  v_meters := (v_resp.content::jsonb -> 'features' -> 0 -> 'properties' -> 'summary' ->> 'distance')::numeric;
  if v_meters is null then
    return null;
  end if;

  return round(v_meters / 1000.0, 3);
end;
$function$;

-- ============ 4. admin_refine_travel_distances — batch-refine one employee's open legs ============
-- Skips anything admin has already manually adjusted (distance_overridden) — a human
-- correction always wins over a routing guess. Only fills in what's still null, so
-- re-running costs nothing extra for legs already refined.

create or replace function public.admin_refine_travel_distances(p_token uuid, p_emp_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_count int := 0;
  v_rec record;
  v_day record;
  v_prev_lat numeric; v_prev_lon numeric;
  v_km numeric;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;

  for v_rec in
    select v.id, v.date, v.lat, v.lon, v.captured_at
    from travel_visits v
    where v.emp_id = p_emp_id and v.road_leg_km is null and not v.distance_overridden
    order by v.date, v.captured_at
  loop
    select vv.lat, vv.lon into v_prev_lat, v_prev_lon
      from travel_visits vv
      where vv.emp_id = p_emp_id and vv.date = v_rec.date and vv.captured_at < v_rec.captured_at
      order by vv.captured_at desc limit 1;
    if v_prev_lat is null then
      select in_lat, in_lon into v_prev_lat, v_prev_lon from attendance where emp_id = p_emp_id and date = v_rec.date;
    end if;
    if v_prev_lat is not null then
      v_km := road_distance_km(v_prev_lat, v_prev_lon, v_rec.lat, v_rec.lon);
      if v_km is not null then
        update travel_visits set road_leg_km = v_km where id = v_rec.id;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  for v_day in
    select a.date, a.out_lat, a.out_lon
    from attendance a
    where a.emp_id = p_emp_id and a.out_lat is not null and a.travel_return_road_km is null
      and exists (select 1 from travel_visits v where v.emp_id = p_emp_id and v.date = a.date)
  loop
    select v.lat, v.lon into v_prev_lat, v_prev_lon
      from travel_visits v where v.emp_id = p_emp_id and v.date = v_day.date
      order by v.captured_at desc limit 1;
    if v_prev_lat is not null then
      v_km := road_distance_km(v_prev_lat, v_prev_lon, v_day.out_lat, v_day.out_lon);
      if v_km is not null then
        update attendance set travel_return_road_km = v_km where emp_id = p_emp_id and date = v_day.date;
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  return v_count;
end;
$function$;

grant execute on function public.admin_refine_travel_distances(uuid, uuid) to anon;

-- ============ 5. Admin can set the key, but never read it back ============

create or replace function public.admin_set_ors_api_key(p_token uuid, p_key text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update travel_routing_settings set ors_api_key = nullif(btrim(p_key), ''), updated_at = now() where id = 1;
  perform log_audit('ORS_API_KEY_UPDATED', case when nullif(btrim(p_key), '') is null then 'cleared' else 'set' end, 'admin');
end;
$function$;

grant execute on function public.admin_set_ors_api_key(uuid, text) to anon;

create or replace function public.admin_get_ors_api_key_status(p_token uuid)
 returns table(is_set boolean, updated_at timestamp with time zone)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select (ors_api_key is not null and btrim(ors_api_key) <> ''), travel_routing_settings.updated_at
    from travel_routing_settings where id = 1;
end;
$function$;

grant execute on function public.admin_get_ors_api_key_status(uuid) to anon;

-- ============ 6. travel_summary_for_employee — use the refined distance once available ============
-- Same output columns as before (no drop+recreate needed) — only the body changes: a
-- human override always wins, then the routed distance if refined, then the original
-- haversine estimate as the fallback that was always there.

create or replace function public.travel_summary_for_employee(p_emp_id uuid)
 returns table(total_km numeric, total_expense numeric, visit_count integer, first_date date, last_date date)
 language sql
 security definer
 set search_path to 'public'
as $function$
  with last_visit_per_day as (
    select distinct on (v.date) v.date, v.lat, v.lon
    from travel_visits v where v.emp_id = p_emp_id
    order by v.date, v.captured_at desc
  ), return_legs as (
    select coalesce(a.travel_return_road_km, haversine_m(lv.lat, lv.lon, a.out_lat, a.out_lon) / 1000.0, 0) as km
    from last_visit_per_day lv
    join attendance a on a.emp_id = p_emp_id and a.date = lv.date
    where a.out_lat is not null and a.out_lon is not null
  )
  select
    coalesce((
      select sum(case when v.distance_overridden then v.leg_distance_km else coalesce(v.road_leg_km, v.leg_distance_km) end)
      from travel_visits v where v.emp_id = p_emp_id
    ), 0) + coalesce((select sum(km) from return_legs), 0) as total_km,
    coalesce((select sum(v.expense_amount) from travel_visits v where v.emp_id = p_emp_id), 0) as total_expense,
    (select count(*)::int from travel_visits v where v.emp_id = p_emp_id) as visit_count,
    (select min(v.date) from travel_visits v where v.emp_id = p_emp_id) as first_date,
    (select max(v.date) from travel_visits v where v.emp_id = p_emp_id) as last_date;
$function$;
