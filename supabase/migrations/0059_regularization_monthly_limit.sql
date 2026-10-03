-- plan.md §39 — HR: each employee may file at most 5 attendance-correction (regularization)
-- requests per calendar month. Until now there was no limit at all. Decided with the user:
--   * 5 per calendar month, resetting on the 1st (IST)
--   * every request counts the moment it is filed, whatever HR later decides (rejected
--     ones included) — so the limit can't be dodged by getting requests rejected, and the
--     rule is easy to explain to staff
--
-- Enforced HERE, in the database, as a hard block (same stance as the device/PIN rules): the
-- screen also shows the count, but the screen is only a courtesy — a stale or tampered
-- client can't get past this. Counted by the month the request was FILED (created_at, IST),
-- not the date being corrected, so correcting a day from last month still uses this month's
-- allowance. Requests are never deleted (no soft-delete on this table), so the count can't
-- be gamed. An advisory lock per employee serialises submissions so two taps at once can't
-- both squeeze under the limit.
--
-- Same signature as before (create or replace) — a phone running the old app keeps working
-- and simply gets the same clear error message.
--
-- The number 5 is also in src/lib/constants.js (REGULARIZATION_MONTHLY_LIMIT) for the
-- on-screen counter; the database is the authority — change both together.

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

  perform pg_advisory_xact_lock(hashtext('regularization_quota:' || p_emp_id::text));

  select count(*) into v_used
    from regularization_requests
    where emp_id = p_emp_id
      and (created_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata');

  if v_used >= c_monthly_limit then
    raise exception 'You have already used all % attendance correction requests for this month. The limit resets on the 1st. Please contact HR if you need more.', c_monthly_limit;
  end if;

  insert into regularization_requests(emp_id, date, requested_in, requested_out, reason)
  values(p_emp_id, p_date, p_in, p_out, p_reason) returning * into v_row;
  return v_row;
end;$function$;
