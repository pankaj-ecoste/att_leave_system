-- 0075 (plan.md §61): HR can give one employee a fresh monthly allowance of correction requests WITHOUT deleting
-- anything. A request whose limit_excused_at is set no longer counts toward the 5-per-month limit (§39).
-- Requests are still never deleted (that is what stops the limit being dodged); the mark records WHEN HR excused it.
--
-- employee_submit_regularization = the LIVE body (0074) with one extra condition in the count. Same signature.
-- Staff cannot set this column: nothing in the app writes it; HR/dev sets it by script (and an audit row is written).

alter table public.regularization_requests
  add column if not exists limit_excused_at timestamptz;

create or replace function public.employee_submit_regularization(p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone, p_out time without time zone, p_reason text)
 returns regularization_requests
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  c_monthly_limit constant int := 5;
  v_row regularization_requests;
  v_used int;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  -- plan.md §60 — a correction must say BOTH times (checked before it can use up one of the 5 monthly requests).
  if p_in is null or p_out is null then
    raise exception 'Please enter both your in-time and your out-time';
  end if;

  perform pg_advisory_xact_lock(hashtext('regularization_quota:' || p_emp_id::text));

  select count(*) into v_used
    from regularization_requests
    where emp_id = p_emp_id
      and limit_excused_at is null
      and (created_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata');

  if v_used >= c_monthly_limit then
    raise exception 'You have already used all % attendance correction requests for this month. The limit resets on the 1st. Please contact HR if you need more.', c_monthly_limit;
  end if;

  insert into regularization_requests(emp_id, date, requested_in, requested_out, reason)
  values(p_emp_id, p_date, p_in, p_out, p_reason) returning * into v_row;
  return v_row;
end;$function$;
