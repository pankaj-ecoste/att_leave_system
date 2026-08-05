-- Day 2 morning — sites, geofence & WFH tag (plan.md Phase 3 / §6B, PROGRESS.md
-- P3-1..P3-4). Was blocked on Q-1 (office coordinates); the user is filling `sites`
-- rows directly via the dashboard, so this migration builds the admin screen + geofence
-- logic to work off however many active rows exist at any time (0, 1, or 3) rather than
-- assuming a fixed count.

-- ============ WORK MODE — add 'wfh' (§6B: OS / FS / WFH tag) ============
-- 'office'/'field'/'both' already existed (0005). 'wfh' is new — a *permanent* remote
-- tag, distinct from the existing "Work From Home" leave type (which is an occasional,
-- approved-in-advance day for an OS/FS employee — untouched, no change here).

alter table employees drop constraint if exists employees_work_mode_check;
alter table employees add constraint employees_work_mode_check
  check (work_mode in ('office', 'field', 'both', 'wfh'));

-- ============ ATTENDANCE — real coordinate storage per punch (P3-2) ============
-- "Server decides, not the phone": the phone reports lat/lon/accuracy and, for an
-- office tile, which site it claims to be at; employee_punch below is the only place
-- that decides distance/inside and can reject. matched_site_id + distance_m are always
-- server-computed, never taken from the client, even for the field/WFH auto-detect
-- label case.

alter table attendance add column if not exists in_lat numeric(9,6);
alter table attendance add column if not exists in_lon numeric(9,6);
alter table attendance add column if not exists in_accuracy_m numeric;
alter table attendance add column if not exists in_site_id uuid references public.sites(id) on delete set null;
alter table attendance add column if not exists in_matched_site_id uuid references public.sites(id) on delete set null;
alter table attendance add column if not exists in_distance_m numeric;
alter table attendance add column if not exists in_inside_geofence boolean;

alter table attendance add column if not exists out_lat numeric(9,6);
alter table attendance add column if not exists out_lon numeric(9,6);
alter table attendance add column if not exists out_accuracy_m numeric;
alter table attendance add column if not exists out_site_id uuid references public.sites(id) on delete set null;
alter table attendance add column if not exists out_matched_site_id uuid references public.sites(id) on delete set null;
alter table attendance add column if not exists out_distance_m numeric;
alter table attendance add column if not exists out_inside_geofence boolean;

-- ============ Distance helpers ============
-- Same haversine formula as lib/geo.js's haversineMeters — kept in sync by hand since
-- one runs in Postgres and the other in the browser; both are pure math with no
-- dependency on anything else, low risk of drifting apart.

create or replace function public.haversine_m(lat1 numeric, lon1 numeric, lat2 numeric, lon2 numeric)
 returns numeric
 language sql
 immutable
as $function$
  select 6371000 * 2 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ));
$function$;

-- Nearest *active* site to a point, regardless of its radius — the caller decides
-- whether the distance returned counts as "inside" by comparing it to radius_m itself.
create or replace function public.nearest_active_site(p_lat numeric, p_lon numeric)
 returns table(site_id uuid, site_name text, distance_m numeric, radius_m integer)
 language sql
 stable
as $function$
  select s.id, s.name, haversine_m(p_lat, p_lon, s.latitude, s.longitude), s.radius_m
  from sites s
  where s.active
  order by haversine_m(p_lat, p_lon, s.latitude, s.longitude) asc
  limit 1;
$function$;

grant execute on function public.haversine_m(numeric, numeric, numeric, numeric) to anon;
grant execute on function public.nearest_active_site(numeric, numeric) to anon;

-- ============ employee_punch — server-side geofence decision (P3-2, P3-3, P3-4) ============
-- Tapping one of the office tiles sends `{in|out}_site_id` — a hard geofence check,
-- reject outside radius, no override (Decision 3, unchanged). Tapping Field or WFH
-- sends no site id — never rejected, but auto-detected against the nearest active site
-- anyway and labelled if it happens to match, purely for admin's reporting (§6B
-- "Handling a Field employee who's actually at the office that day").

create or replace function public.employee_punch(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row attendance;
  v_existing attendance;
  v_punch_type text := p_data->>'punch_type';
  v_site sites;
  v_nearest record;
  v_lat numeric;
  v_lon numeric;
  v_site_id uuid;
  v_distance numeric;
  v_matched_site uuid;
  v_inside boolean;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;

  select * into v_existing from attendance where emp_id = p_emp_id and date = (p_data->>'date')::date;

  -- Duplicate-tap guard (P3-8), unchanged from 0005.
  if v_existing.id is not null and v_punch_type is not null
     and v_existing.updated_at > now() - interval '30 seconds' then
    if v_punch_type = 'in' and v_existing.in_time is not distinct from nullif(p_data->>'in_time', '')::time then
      raise exception 'Duplicate punch ignored — please wait a few seconds and try again';
    end if;
    if v_punch_type = 'out' and v_existing.out_time is not distinct from nullif(p_data->>'out_time', '')::time then
      raise exception 'Duplicate punch ignored — please wait a few seconds and try again';
    end if;
  end if;

  if v_punch_type = 'in' then
    v_lat := nullif(p_data->>'in_lat', '')::numeric;
    v_lon := nullif(p_data->>'in_lon', '')::numeric;
    v_site_id := nullif(p_data->>'in_site_id', '')::uuid;
  elsif v_punch_type = 'out' then
    v_lat := nullif(p_data->>'out_lat', '')::numeric;
    v_lon := nullif(p_data->>'out_lon', '')::numeric;
    v_site_id := nullif(p_data->>'out_site_id', '')::uuid;
  end if;

  v_distance := null; v_matched_site := null; v_inside := null;

  if v_lat is not null and v_lon is not null then
    if v_site_id is not null then
      select * into v_site from sites where id = v_site_id and active = true;
      if v_site.id is null then
        raise exception 'Selected office not found or no longer active';
      end if;
      v_distance := haversine_m(v_lat, v_lon, v_site.latitude, v_site.longitude);
      v_matched_site := v_site.id;
      v_inside := v_distance <= v_site.radius_m;
      if not v_inside then
        raise exception 'Outside % radius — %m away, must be within %m. Punch not recorded.',
          v_site.name, round(v_distance), v_site.radius_m;
      end if;
    else
      select * into v_nearest from nearest_active_site(v_lat, v_lon);
      if v_nearest.site_id is not null and v_nearest.distance_m <= v_nearest.radius_m then
        v_matched_site := v_nearest.site_id;
        v_distance := v_nearest.distance_m;
        v_inside := true;
      end if;
    end if;
  end if;

  if v_punch_type = 'in' then
    p_data := p_data || jsonb_build_object(
      'in_distance_m', v_distance, 'in_matched_site_id', v_matched_site, 'in_inside_geofence', v_inside
    );
  elsif v_punch_type = 'out' then
    p_data := p_data || jsonb_build_object(
      'out_distance_m', v_distance, 'out_matched_site_id', v_matched_site, 'out_inside_geofence', v_inside
    );
  end if;

  insert into attendance (
    emp_id, date, day_type, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source, source,
    field_note,
    in_lat, in_lon, in_accuracy_m, in_site_id, in_distance_m, in_matched_site_id, in_inside_geofence,
    out_lat, out_lon, out_accuracy_m, out_site_id, out_distance_m, out_matched_site_id, out_inside_geofence
  )
  values (
    p_emp_id, (p_data->>'date')::date, coalesce(nullif(p_data->>'day_type', ''), 'working'),
    nullif(p_data->>'in_time', '')::time, nullif(p_data->>'out_time', '')::time,
    p_data->>'in_location', p_data->>'out_location', p_data->>'leave_type', p_data->>'leave_reason',
    coalesce((p_data->>'wfh')::boolean, false), coalesce((p_data->>'on_duty')::boolean, false), p_data->>'status',
    p_data->>'late_hrs', p_data->>'early_hrs', p_data->>'bio_wrk_hrs', p_data->>'bio_ot',
    p_data->>'shift', p_data->>'shift_start', p_data->>'in_temp', p_data->>'out_temp',
    p_data->>'remark', p_data->>'card_no', p_data->>'designation', p_data->>'bio_status_raw',
    p_data->>'bio_source', p_data->>'monthly_source', p_data->>'source',
    p_data->>'field_note',
    nullif(p_data->>'in_lat', '')::numeric, nullif(p_data->>'in_lon', '')::numeric, nullif(p_data->>'in_accuracy_m', '')::numeric,
    nullif(p_data->>'in_site_id', '')::uuid, nullif(p_data->>'in_distance_m', '')::numeric,
    nullif(p_data->>'in_matched_site_id', '')::uuid, nullif(p_data->>'in_inside_geofence', '')::boolean,
    nullif(p_data->>'out_lat', '')::numeric, nullif(p_data->>'out_lon', '')::numeric, nullif(p_data->>'out_accuracy_m', '')::numeric,
    nullif(p_data->>'out_site_id', '')::uuid, nullif(p_data->>'out_distance_m', '')::numeric,
    nullif(p_data->>'out_matched_site_id', '')::uuid, nullif(p_data->>'out_inside_geofence', '')::boolean
  )
  on conflict (emp_id, date) do update set
    day_type=excluded.day_type, in_time=excluded.in_time, out_time=excluded.out_time,
    in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, source=excluded.source,
    field_note=excluded.field_note,
    in_lat=excluded.in_lat, in_lon=excluded.in_lon, in_accuracy_m=excluded.in_accuracy_m, in_site_id=excluded.in_site_id,
    in_distance_m=excluded.in_distance_m, in_matched_site_id=excluded.in_matched_site_id, in_inside_geofence=excluded.in_inside_geofence,
    out_lat=excluded.out_lat, out_lon=excluded.out_lon, out_accuracy_m=excluded.out_accuracy_m, out_site_id=excluded.out_site_id,
    out_distance_m=excluded.out_distance_m, out_matched_site_id=excluded.out_matched_site_id, out_inside_geofence=excluded.out_inside_geofence,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;

-- ============ Admin — sites CRUD (P3-1) ============
-- Reads stay anon-direct (`grant select on sites to anon`, 0006) like holidays; writes
-- go through admin-token-checked functions like every other admin mutation.

create or replace function public.admin_create_site(p_token uuid, p_data jsonb)
 returns sites
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row sites;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into sites (name, latitude, longitude, radius_m, active)
  values (
    p_data->>'name',
    (p_data->>'latitude')::numeric,
    (p_data->>'longitude')::numeric,
    coalesce(nullif(p_data->>'radiusM', '')::integer, 100),
    coalesce((p_data->>'active')::boolean, true)
  ) returning * into v_row;
  perform log_audit('SITE_CREATE', v_row.name, 'admin');
  return v_row;
end;
$function$;

create or replace function public.admin_update_site(p_token uuid, p_site_id uuid, p_data jsonb)
 returns sites
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row sites;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update sites set
    name=coalesce(p_data->>'name', name),
    latitude=coalesce(nullif(p_data->>'latitude', '')::numeric, latitude),
    longitude=coalesce(nullif(p_data->>'longitude', '')::numeric, longitude),
    radius_m=coalesce(nullif(p_data->>'radiusM', '')::integer, radius_m),
    active=coalesce((p_data->>'active')::boolean, active),
    updated_at=now()
  where id=p_site_id returning * into v_row;
  perform log_audit('SITE_UPDATE', v_row.name, 'admin');
  return v_row;
end;
$function$;

create or replace function public.admin_delete_site(p_token uuid, p_site_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_name text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select name into v_name from sites where id = p_site_id;
  delete from sites where id = p_site_id;
  perform log_audit('SITE_DELETE', coalesce(v_name, p_site_id::text), 'admin');
end;
$function$;

grant execute on function public.admin_create_site(uuid, jsonb) to anon;
grant execute on function public.admin_update_site(uuid, uuid, jsonb) to anon;
grant execute on function public.admin_delete_site(uuid, uuid) to anon;
