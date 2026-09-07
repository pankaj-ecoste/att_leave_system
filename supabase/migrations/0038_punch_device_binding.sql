-- HR-reported PIN sharing (2026-09-07), plan.md §18: staff give their PIN to a
-- colleague, who then punches attendance for them from the colleague's own phone.
-- IP/Wi-Fi locking doesn't work (shared/roaming IPs) and GPS geofencing (already built,
-- §5/§7) doesn't help since the colleague doing the punching is usually on-site too.
--
-- Fix: bind each employee's punch action (not login — viewing stays unrestricted) to
-- the first device it's used from. `employees.punch_device_id` is null until the first
-- punch after this ships, which auto-binds it — no separate registration step. A punch
-- from a different device is rejected outright and logged to audit_logs so HR can see
-- who's attempting it and how often. Admin can reset the binding for real phone
-- changes via the new admin_reset_punch_device().

alter table public.employees
  add column if not exists punch_device_id text,
  add column if not exists punch_device_bound_at timestamptz;

create or replace function public.employee_punch(p_token uuid, p_emp_id uuid, p_data jsonb, p_device_id text)
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
  v_out_time time;
  v_gap_min numeric;
  v_now_ist timestamp;
  v_date date;
  v_time time;
  v_bound_device_id text;
  v_emp_name text;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;

  select punch_device_id, name into v_bound_device_id, v_emp_name from employees where id = p_emp_id;

  if v_bound_device_id is null then
    if nullif(p_device_id, '') is not null then
      update employees set punch_device_id = p_device_id, punch_device_bound_at = now() where id = p_emp_id;
      perform log_audit('PUNCH_DEVICE_BOUND', v_emp_name || ' — punch device registered', 'system');
    end if;
  elsif v_bound_device_id <> coalesce(p_device_id, '') then
    perform log_audit('PUNCH_DEVICE_BLOCKED', v_emp_name || ' — punch blocked, different device than registered', 'system');
    raise exception 'This device is not registered for your attendance. If you got a new phone, ask HR to reset your registered device.';
  end if;

  -- Server clock only, converted to IST — never the device's date/time.
  v_now_ist := now() at time zone 'Asia/Kolkata';
  v_date := v_now_ist::date;
  v_time := v_now_ist::time;

  select * into v_existing from attendance where emp_id = p_emp_id and date = v_date;

  if v_existing.id is not null and v_punch_type is not null
     and v_existing.updated_at > now() - interval '30 seconds' then
    if v_punch_type = 'in' and v_existing.in_time is not distinct from v_time then
      raise exception 'Duplicate punch ignored — please wait a few seconds and try again';
    end if;
    if v_punch_type = 'out' and v_existing.out_time is not distinct from v_time then
      raise exception 'Duplicate punch ignored — please wait a few seconds and try again';
    end if;
  end if;

  if v_punch_type = 'out' and v_existing.in_time is not null then
    v_out_time := v_time;
    v_gap_min := extract(epoch from (
      case when v_out_time < v_existing.in_time
        then v_out_time + interval '24 hours' - v_existing.in_time
        else v_out_time - v_existing.in_time
      end
    )) / 60.0;
    if v_gap_min < 5 then
      raise exception 'Punch-out rejected — at least 5 minutes must pass after punch-in (only %s minute(s) so far). If this was a mistake, wait a few minutes and try again.', floor(v_gap_min)::int;
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
    p_emp_id, v_date, coalesce(nullif(p_data->>'day_type', ''), 'working'),
    case when v_punch_type = 'in' then v_time else null end,
    case when v_punch_type = 'out' then v_time else null end,
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
    case when v_punch_type = 'in' then v_time else null end,
    case when v_punch_type = 'out' then v_time else null end,
    'app'
  )
  on conflict (emp_id, date) do update set
    day_type=excluded.day_type,
    in_time = case when v_punch_type = 'in' then excluded.in_time else attendance.in_time end,
    out_time = case when v_punch_type = 'out' then excluded.out_time else attendance.out_time end,
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
    app_in_time = case when v_punch_type = 'in' then excluded.app_in_time else attendance.app_in_time end,
    app_out_time = case when v_punch_type = 'out' then excluded.app_out_time else attendance.app_out_time end,
    official_source='app',
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;

create or replace function public.admin_reset_punch_device(p_token uuid, p_emp_id uuid)
 returns employees
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update employees set punch_device_id = null, punch_device_bound_at = null, updated_at = now()
    where id = p_emp_id
    returning * into v_row;
  perform log_audit('PUNCH_DEVICE_RESET', v_row.name || ' — registered punch device reset', 'admin');
  return v_row;
end;
$function$;

grant execute on function public.employee_punch(uuid, uuid, jsonb, text) to anon;
grant execute on function public.admin_reset_punch_device(uuid, uuid) to anon;

-- Old 3-arg employee_punch is superseded — same reasoning as employee_login/admin_login
-- being replaced in place elsewhere in this project (§13), drop it so there's exactly
-- one signature and no risk of the app accidentally calling the unbound-check version.
drop function if exists public.employee_punch(uuid, uuid, jsonb);
