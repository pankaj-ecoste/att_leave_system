-- HR requests (2026-08-17), plan.md §12 V3 decisions 4 and 5.
--
-- 5: staff sometimes hit Punch In then Punch Out back-to-back by mistake. Hard-block a
-- punch-out submitted less than 5 minutes after that day's recorded punch-in — the real
-- guardrail lives here (server-side), the client-side check in
-- useEmployeeAttendance.js is only there to skip an unnecessary GPS fetch and give
-- instant feedback, same "don't just hide the button" posture as every other rule in
-- this app. Overnight shifts are unaffected: a wrapped (next-day) out-time always
-- computes as a large positive gap, never a small one, so it's never mistaken for a
-- same-moment double-tap.
--
-- 4: admin_decide_leave used to block until the employee's manager had approved first,
-- so a busy/unresponsive manager stalled the whole request. Manager and admin now have
-- fully equal, independent authority — whichever decides first (Approve or Reject)
-- immediately finalizes the leave application (balance deduction + attendance write),
-- and the other is locked out afterward. The balance/attendance side effects, previously
-- duplicated nowhere but only present in admin_decide_leave, move into one shared
-- function so both decision paths can't drift apart.

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
  v_out_time time;
  v_gap_min numeric;
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

  if v_punch_type = 'out' and v_existing.in_time is not null then
    v_out_time := nullif(p_data->>'out_time', '')::time;
    if v_out_time is not null then
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
    app_in_time=excluded.app_in_time, app_out_time=excluded.app_out_time, official_source='app',
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;

-- ============ Shared approval side-effects, called by both decision paths ============

create or replace function public.apply_leave_approval_effects(p_row leave_applications)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_deduct numeric;
  v_status text;
begin
  if p_row.leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave', 'Compensatory Leave') then
    v_deduct := case when p_row.day_part = 'full' then 1 else 0.5 end;
    update leave_balances set consumed = consumed + v_deduct, balance = balance - v_deduct, updated_at = now()
      where emp_id = p_row.emp_id and leave_type = p_row.leave_type and financial_year = current_fy();
  end if;

  v_status := case
    when p_row.day_part != 'full' then 'Half Day Leave'
    when p_row.leave_type = 'Work From Home' then 'WFH'
    when p_row.leave_type = 'On Duty' then 'On Duty'
    else 'Leave'
  end;

  -- Only the leave-related columns are written — an existing punch or biometric import
  -- row for the same date survives untouched, same as before.
  insert into attendance (emp_id, date, leave_type, leave_reason, day_part, status, wfh, on_duty)
  values (p_row.emp_id, p_row.date, p_row.leave_type, p_row.reason, p_row.day_part, v_status,
    p_row.leave_type = 'Work From Home', p_row.leave_type = 'On Duty')
  on conflict (emp_id, date) do update set
    leave_type = excluded.leave_type, leave_reason = excluded.leave_reason,
    day_part = excluded.day_part, status = excluded.status,
    wfh = excluded.wfh, on_duty = excluded.on_duty, updated_at = now();
end;
$function$;

revoke execute on function public.apply_leave_approval_effects(leave_applications) from public, anon, authenticated;

-- ============ manager_decide_leave — now a fully final decision, not an interim stage ============

create or replace function public.manager_decide_leave(p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row leave_applications;
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  if p_status not in ('Approved', 'Rejected') then raise exception 'Invalid decision'; end if;

  select la.* into v_row from leave_applications la
    join employees e on e.id = la.emp_id
    where la.id = p_leave_id and e.manager_emp_id = p_manager_id;
  if not found then raise exception 'Not authorized to action this request'; end if;
  if v_row.status in ('Approved', 'Rejected') then raise exception 'Already decided'; end if;

  update leave_applications set
    manager_decision = p_status,
    manager_decided_by = p_manager_id,
    manager_decided_at = now(),
    status = p_status,
    updated_at = now()
  where id = p_leave_id
  returning * into v_row;

  if p_status = 'Approved' then
    perform apply_leave_approval_effects(v_row);
  end if;

  perform log_audit('LEAVE_DECISION', 'Leave ' || p_leave_id || ' -> manager ' || p_status, 'manager:' || p_manager_id);
  return v_row;
end;
$function$;

-- ============ admin_decide_leave — no longer waits on the manager ============

create or replace function public.admin_decide_leave(p_token uuid, p_leave_id uuid, p_decision text)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_row leave_applications;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_decision not in ('Approved', 'Rejected') then raise exception 'Invalid decision'; end if;

  select * into v_row from leave_applications where id = p_leave_id;
  if not found then raise exception 'Leave application not found'; end if;
  if v_row.status in ('Approved', 'Rejected') then raise exception 'Already decided'; end if;

  update leave_applications set
    admin_decision = p_decision,
    admin_decided_at = now(),
    status = p_decision,
    updated_at = now()
  where id = p_leave_id
  returning * into v_row;

  if p_decision = 'Approved' then
    perform apply_leave_approval_effects(v_row);
  end if;

  perform log_audit('LEAVE_DECISION', 'Leave ' || p_leave_id || ' -> admin ' || p_decision, 'admin');
  return v_row;
end;
$function$;
