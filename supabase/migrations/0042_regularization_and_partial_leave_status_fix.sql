-- Root-cause fix, plan.md §24 (HR-reported 2026-09-11 — repeated wrong Half Day/Absent
-- badges). The display-side fix (every screen now recomputes the status badge live from
-- calcStatus, never trusting the stored attendance.status column) already stopped these
-- bugs from reaching anything a user sees. This migration fixes the two places that were
-- still writing wrong values into that column in the first place, found while verifying
-- the one-off backfill script's diff:
--
-- 1. manager_decide_regularization / admin_decide_regularization — approving a
--    correction request:
--      a) hardcoded status to 'Present' whenever an in-time was entered, never checking
--         whether the corrected hours actually meet stdHours (a regularization for, say,
--         09:00-11:00 was still marked "Present").
--      b) on ON CONFLICT (an attendance row already existed for that date — e.g. an app
--         punch-in with no out-time yet) the UPDATE clause never touched `status` at
--         all, so it stayed frozen at whatever it was before (observed live: several
--         rows stuck at "Punched In" long after an out-time was added via
--         regularization — this is exactly the frozen-status bug plan.md §15.2/§24
--         describes, just from a second write path).
--      c) ALSO overwrote in_time/out_time with the requested value even when only one
--         side needed correcting (the regularization form allows submitting just one of
--         the two — AttendanceHistory.jsx's "At least one time is required"), which
--         could silently wipe an already-correct punch time to null. Fixed by merging
--         with whatever's already on the row rather than blindly overwriting both.
--    New behavior: pulls the employee's effective stdHours (std_hours_override or the
--    org default), merges the requested time(s) with whatever's already stored for that
--    date, and computes status with the same grace-period + half-day-threshold rule
--    calcStatus uses (src/lib/datetime.js) — no leave-type/deduct credit involved here,
--    since a regularization never carries a leave_type.
--
-- 2. apply_leave_approval_effects — approving a leave application always set
--    status = 'Leave' for anything that wasn't WFH/On Duty/half-day, INCLUDING Partial
--    Leave - 1 Hour/2 Hours. But Partial Leave employees still work the rest of the
--    day (LEAVE_TYPES has `present: true` for these two in constants.js) — they should
--    show Present/Half Day based on actual hours worked (credited by the 1-2 excused
--    hours), never a full "Leave" day. This is what produced the 38 mis-stored rows the
--    backfill script found (2026-09-11). Fixed to merge with the day's existing punch
--    (if any) and compute status the same way, crediting the leave's deduct hours
--    against the shortfall — mirrors calcStatus's own `deduct` handling exactly.

create or replace function public.manager_decide_regularization(p_token uuid, p_manager_id uuid, p_reg_id uuid, p_status text)
 returns regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row regularization_requests;
  v_existing attendance;
  v_final_in time;
  v_final_out time;
  v_std_hours numeric;
  v_raw_hours numeric;
  v_status text;
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  select r.* into v_row from regularization_requests r
    join employees e on e.id = r.emp_id
    where r.id = p_reg_id and e.manager_emp_id = p_manager_id;
  if not found then raise exception 'Not authorized to action this request'; end if;
  update regularization_requests set status = p_status, updated_at = now() where id = p_reg_id returning * into v_row;
  if p_status = 'Approved' then
    select * into v_existing from attendance where emp_id = v_row.emp_id and date = v_row.date;
    v_final_in := coalesce(v_row.requested_in, v_existing.in_time);
    v_final_out := coalesce(v_row.requested_out, v_existing.out_time);

    select coalesce(e.std_hours_override, s.std_hours) into v_std_hours
      from employees e cross join app_settings s where e.id = v_row.emp_id;

    if v_final_in is not null and v_final_out is not null then
      v_raw_hours := extract(epoch from (
        case when v_final_out < v_final_in then v_final_out + interval '24 hours' - v_final_in
             else v_final_out - v_final_in end
      )) / 3600.0;
      -- 0.25h = GRACE_PERIOD_MIN (15 min, src/lib/constants.js) — kept in sync by hand,
      -- same as the pre-existing stdHours/2 half-day threshold this mirrors.
      v_status := case
        when greatest(0, v_std_hours - v_raw_hours) <= 0.25 then 'Present'
        when v_raw_hours < v_std_hours / 2 then 'Absent'
        else 'Half Day'
      end;
    elsif v_final_in is not null then
      v_status := 'Punched In';
    else
      v_status := 'Absent';
    end if;

    insert into attendance(emp_id, date, in_time, out_time, status, source)
    values(v_row.emp_id, v_row.date, v_final_in, v_final_out, v_status, 'regularization')
    on conflict(emp_id, date) do update set
      in_time = excluded.in_time, out_time = excluded.out_time, status = excluded.status,
      source = 'regularization', updated_at = now();
  end if;
  return v_row;
end;$function$;

create or replace function public.admin_decide_regularization(p_token uuid, p_id uuid, p_status text)
 returns regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row regularization_requests;
  v_existing attendance;
  v_final_in time;
  v_final_out time;
  v_std_hours numeric;
  v_raw_hours numeric;
  v_status text;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update regularization_requests set status=p_status, updated_at=now() where id=p_id returning * into v_row;
  if p_status='Approved' then
    select * into v_existing from attendance where emp_id = v_row.emp_id and date = v_row.date;
    v_final_in := coalesce(v_row.requested_in, v_existing.in_time);
    v_final_out := coalesce(v_row.requested_out, v_existing.out_time);

    select coalesce(e.std_hours_override, s.std_hours) into v_std_hours
      from employees e cross join app_settings s where e.id = v_row.emp_id;

    if v_final_in is not null and v_final_out is not null then
      v_raw_hours := extract(epoch from (
        case when v_final_out < v_final_in then v_final_out + interval '24 hours' - v_final_in
             else v_final_out - v_final_in end
      )) / 3600.0;
      v_status := case
        when greatest(0, v_std_hours - v_raw_hours) <= 0.25 then 'Present'
        when v_raw_hours < v_std_hours / 2 then 'Absent'
        else 'Half Day'
      end;
    elsif v_final_in is not null then
      v_status := 'Punched In';
    else
      v_status := 'Absent';
    end if;

    insert into attendance(emp_id, date, in_time, out_time, status, source)
    values(v_row.emp_id, v_row.date, v_final_in, v_final_out, v_status, 'regularization')
    on conflict(emp_id, date) do update set
      in_time=excluded.in_time, out_time=excluded.out_time, status=excluded.status,
      source='regularization', updated_at=now();
  end if;
  return v_row;
end;$function$;

create or replace function public.apply_leave_approval_effects(p_row leave_applications)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_deduct numeric;
  v_status text;
  v_existing attendance;
  v_std_hours numeric;
  v_raw_hours numeric;
  v_partial_credit numeric;
begin
  if p_row.leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave', 'Compensatory Leave') then
    v_deduct := case when p_row.day_part = 'full' then 1 else 0.5 end;
    update leave_balances set consumed = consumed + v_deduct, balance = balance - v_deduct, updated_at = now()
      where emp_id = p_row.emp_id and leave_type = p_row.leave_type and financial_year = current_fy();
  end if;

  if p_row.day_part != 'full' then
    v_status := 'Half Day Leave';
  elsif p_row.leave_type = 'Work From Home' then
    v_status := 'WFH';
  elsif p_row.leave_type = 'On Duty' then
    v_status := 'On Duty';
  elsif p_row.leave_type in ('Partial Leave - 1 Hour', 'Partial Leave - 2 Hours') then
    -- Partial Leave still requires punching in/out that day (LEAVE_TYPES has
    -- present: true for these — src/lib/constants.js) — status depends on hours
    -- actually worked, credited by the leave's excused hours, same grace-period +
    -- half-day-threshold rule calcStatus uses. If the day hasn't been punched yet
    -- (leave approved in advance), leave status alone — employee_punch computes and
    -- stores the correct value itself once they actually punch.
    select * into v_existing from attendance where emp_id = p_row.emp_id and date = p_row.date;
    if v_existing.in_time is not null and v_existing.out_time is not null then
      select coalesce(e.std_hours_override, s.std_hours) into v_std_hours
        from employees e cross join app_settings s where e.id = p_row.emp_id;
      v_raw_hours := extract(epoch from (
        case when v_existing.out_time < v_existing.in_time
          then v_existing.out_time + interval '24 hours' - v_existing.in_time
          else v_existing.out_time - v_existing.in_time
        end
      )) / 3600.0;
      v_partial_credit := case when p_row.leave_type = 'Partial Leave - 1 Hour' then 1 else 2 end;
      v_status := case
        when greatest(0, v_std_hours - v_raw_hours - v_partial_credit) <= 0.25 then 'Present'
        when (v_raw_hours + v_partial_credit) < v_std_hours / 2 then 'Absent'
        else 'Half Day'
      end;
    else
      v_status := v_existing.status; -- not punched yet — nothing to recompute, leave as-is (likely null)
    end if;
  else
    v_status := 'Leave';
  end if;

  -- Only the leave-related columns are written — an existing punch or biometric import
  -- row for the same date survives untouched, same as before.
  insert into attendance (emp_id, date, leave_type, leave_reason, day_part, status, wfh, on_duty)
  values (p_row.emp_id, p_row.date, p_row.leave_type, p_row.reason, p_row.day_part, v_status,
    p_row.leave_type = 'Work From Home', p_row.leave_type = 'On Duty')
  on conflict (emp_id, date) do update set
    leave_type = excluded.leave_type, leave_reason = excluded.leave_reason,
    day_part = excluded.day_part, status = coalesce(excluded.status, attendance.status),
    wfh = excluded.wfh, on_duty = excluded.on_duty, updated_at = now();
end;
$function$;
