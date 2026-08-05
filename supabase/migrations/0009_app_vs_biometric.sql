-- Day 2 afternoon — separate app and biometric punches (plan.md Phase 3, P3-10..P3-13).
-- The real bug this fixes: `attendance.in_time`/`out_time` were shared between the app
-- punch and the daily/monthly biometric imports. Both `useDailyBioImport.js` and
-- `useMonthlyBioImport.js` unconditionally do `if (arrTime) existing.inTime = arrTime`
-- — so importing yesterday's biometric export after an employee had already punched via
-- the app silently overwrote their real, GPS-verified punch with the device's reading,
-- with no record anything had changed. 0005/0007's own comments flagged this as a known
-- follow-up ("today one row per day means the Excel import overwrites app punches").
--
-- Fix: three sets of in/out columns instead of one.
--   app_in_time / app_out_time   — written only by employee_punch (the app itself)
--   bio_in_time / bio_out_time   — written only by the daily/monthly bio imports
--   in_time / out_time           — unchanged name, but now means "whichever is
--                                   currently OFFICIAL" — every existing consumer
--                                   (dashboards, reports, exports, status calc) keeps
--                                   reading this column and needs no changes.
--   official_source              — which of the three ('app' | 'biometric' | 'manual')
--                                   in_time/out_time currently reflects.
--
-- Precedence, enforced in the client hooks that write these (not here — see
-- useDailyBioImport.js / useMonthlyBioImport.js / useAdminAttendance.js): an app punch
-- or an admin's manual edit always becomes official immediately; a bio import only
-- promotes itself to official when nothing already claimed 'app' or 'manual' for that
-- day — it still always records bio_in_time/bio_out_time either way, so the comparison
-- view (P3-11) has both readings regardless of which one counts.

alter table attendance add column if not exists app_in_time time without time zone;
alter table attendance add column if not exists app_out_time time without time zone;
alter table attendance add column if not exists bio_in_time time without time zone;
alter table attendance add column if not exists bio_out_time time without time zone;
alter table attendance add column if not exists official_source text check (official_source in ('app', 'biometric', 'manual'));

-- ============ employee_punch — also write app_in_time/app_out_time, always claim 'app' ============

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
    out_lat, out_lon, out_accuracy_m, out_site_id, out_distance_m, out_matched_site_id, out_inside_geofence,
    app_in_time, app_out_time, official_source
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
    nullif(p_data->>'out_matched_site_id', '')::uuid, nullif(p_data->>'out_inside_geofence', '')::boolean,
    nullif(p_data->>'in_time', '')::time, nullif(p_data->>'out_time', '')::time, 'app'
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
    -- An app punch always becomes official immediately, even if a prior bio import or
    -- admin edit had claimed the day (plan.md — a live, GPS-verified punch outranks a
    -- batch device export or an earlier manual correction).
    app_in_time=excluded.app_in_time, app_out_time=excluded.app_out_time, official_source='app',
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;

-- ============ admin_upsert_attendance / admin_bulk_upsert_attendance — carry the new columns ============
-- Used by: admin's manual inline edit (sets official_source='manual' client-side,
-- useAdminAttendance.js's editCell) and both bio import hooks (set bio_in_time/
-- bio_out_time always; only touch in_time/out_time/official_source when nothing already
-- claimed 'app'/'manual' — enforced client-side in useDailyBioImport.js /
-- useMonthlyBioImport.js, not here, since these two RPCs are the same generic upsert
-- admin already uses for direct corrections and must stay generic).

create or replace function public.admin_upsert_attendance(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns attendance
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row attendance;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into attendance (
    emp_id, date, day_type, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source, source,
    bio_in_time, bio_out_time, official_source
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
    nullif(p_data->>'bio_in_time', '')::time, nullif(p_data->>'bio_out_time', '')::time, nullif(p_data->>'official_source', '')
  )
  on conflict (emp_id, date) do update set
    day_type=excluded.day_type, in_time=excluded.in_time, out_time=excluded.out_time,
    in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, source=excluded.source,
    bio_in_time=excluded.bio_in_time, bio_out_time=excluded.bio_out_time, official_source=excluded.official_source,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;$function$;

create or replace function public.admin_bulk_upsert_attendance(p_token uuid, p_records jsonb)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_count int;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into attendance (
    emp_id, date, day_type, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source, source,
    bio_in_time, bio_out_time, official_source
  )
  select
    (r->>'emp_id')::uuid, (r->>'date')::date, coalesce(nullif(r->>'day_type', ''), 'working'),
    nullif(r->>'in_time', '')::time, nullif(r->>'out_time', '')::time,
    r->>'in_location', r->>'out_location', r->>'leave_type', r->>'leave_reason',
    coalesce((r->>'wfh')::boolean, false), coalesce((r->>'on_duty')::boolean, false), r->>'status',
    r->>'late_hrs', r->>'early_hrs', r->>'bio_wrk_hrs', r->>'bio_ot',
    r->>'shift', r->>'shift_start', r->>'in_temp', r->>'out_temp',
    r->>'remark', r->>'card_no', r->>'designation', r->>'bio_status_raw',
    r->>'bio_source', r->>'monthly_source', r->>'source',
    nullif(r->>'bio_in_time', '')::time, nullif(r->>'bio_out_time', '')::time, nullif(r->>'official_source', '')
  from jsonb_array_elements(p_records) as r
  on conflict (emp_id, date) do update set
    day_type=excluded.day_type, in_time=excluded.in_time, out_time=excluded.out_time,
    in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, source=excluded.source,
    bio_in_time=excluded.bio_in_time, bio_out_time=excluded.bio_out_time, official_source=excluded.official_source,
    updated_at=now();
  get diagnostics v_count = row_count;
  return v_count;
end;$function$;
