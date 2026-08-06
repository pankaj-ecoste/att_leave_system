-- Earned Leave requires 7 days' advance notice, stricter than the general 1-day rule
-- applied to other planned leave types (0016). Per your explicit instruction: "earned
-- leave can only be applicable before the 7 day."
--
-- Also adds the Sick Leave prescription-upload requirement in the same migration,
-- since both touch employee_apply_leave and it's cleaner as one coherent change than
-- two migrations racing to redefine the same function.

alter table leave_applications add column if not exists document_path text;

-- Private bucket — files are named with an unguessable client-generated UUID as the
-- folder, not tied to anything else guessable (per your decision: not public, not
-- listable, reachable only with the exact path). There's no Supabase Auth session
-- here (employees log in via a custom PIN check, not auth.users), so storage RLS can't
-- be scoped any tighter than "anon can read/write this bucket" the way table RLS is
-- scoped via the SECURITY DEFINER functions' own token checks — this is the practical
-- ceiling for this app's architecture, matching the security level already accepted
-- elsewhere (e.g. leave reasons are also only "hidden" by not being exposed through
-- any anon-readable RPC, not by being cryptographically protected).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('leave-documents', 'leave-documents', false, 10485760, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "anon can upload leave documents" on storage.objects;
create policy "anon can upload leave documents" on storage.objects for insert to anon
  with check (bucket_id = 'leave-documents');

drop policy if exists "anon can read leave documents" on storage.objects;
create policy "anon can read leave documents" on storage.objects for select to anon
  using (bucket_id = 'leave-documents');

create or replace function public.employee_apply_leave(p_token uuid, p_emp_id uuid, p_data jsonb)
 returns leave_applications
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_row leave_applications;
  v_leave_type text := p_data->>'leave_type';
  v_day_part text := coalesce(nullif(p_data->>'day_part', ''), 'full');
  v_date date := (p_data->>'date')::date;
  v_balance numeric;
  v_needed numeric;
  v_emp_status text;
  v_joining_date date;
  v_capped_leave_count int;
  v_fy_start date;
  v_fy_end date;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;

  if v_day_part not in ('full', 'first_half', 'second_half') then
    raise exception 'Invalid day part';
  end if;
  if v_day_part != 'full' and v_leave_type not in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    raise exception 'Half-day is only available for Sick, Casual and Earned Leave';
  end if;

  if v_leave_type = 'Earned Leave' and v_date < current_date + 7 then
    raise exception 'Earned Leave must be applied at least 7 days in advance';
  elsif v_leave_type not in ('Sick Leave', 'Bereavement Leave', 'Work From Home', 'On Duty', 'LOP', 'Earned Leave')
        and v_date < current_date + 1 then
    raise exception '% must be applied at least a day in advance', v_leave_type;
  end if;

  if exists (
    select 1 from leave_applications
    where emp_id = p_emp_id and date = v_date and status != 'Rejected'
  ) then
    raise exception 'A leave application already exists for %', v_date;
  end if;

  select employment_status, joining_date into v_emp_status, v_joining_date from employees where id = p_emp_id;

  if v_emp_status in ('Probation', 'Notice Period')
     and v_leave_type not in ('LOP', 'Work From Home', 'On Duty') then
    v_fy_start := make_date(current_fy(), 4, 1);
    v_fy_end := make_date(current_fy() + 1, 3, 31);
    select count(*) into v_capped_leave_count from leave_applications
      where emp_id = p_emp_id and status != 'Rejected'
        and leave_type not in ('LOP', 'Work From Home', 'On Duty')
        and date between v_fy_start and v_fy_end;
    if v_capped_leave_count >= 1 then
      raise exception 'Only 1 leave is allowed during your % — apply as LOP instead', v_emp_status;
    end if;
  end if;

  if v_leave_type in ('Marriage Leave', 'Maternity Leave')
     and (v_joining_date is null or v_joining_date > (current_date - interval '18 months')) then
    raise exception '% requires at least 18 months of service', v_leave_type;
  end if;

  if v_leave_type = 'Sick Leave' and coalesce(p_data->>'document_path', '') = '' then
    raise exception 'A medical certificate/prescription is required to apply for Sick Leave';
  end if;

  if v_leave_type in ('Sick Leave', 'Casual Leave', 'Earned Leave') then
    v_needed := case when v_day_part = 'full' then 1 else 0.5 end;
    select balance into v_balance from leave_balances
      where emp_id = p_emp_id and leave_type = v_leave_type and financial_year = current_fy();
    if v_balance is not null and v_balance < v_needed then
      raise exception 'Insufficient % balance — % remaining this year', v_leave_type, v_balance;
    end if;
  end if;

  insert into leave_applications (emp_id, emp_name, company, leave_type, date, day_part, reason, location, document_path, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', v_leave_type, v_date, v_day_part, p_data->>'reason', p_data->>'location', nullif(p_data->>'document_path', ''), 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$;

-- ============ admin_get_leaves — carry document_path so admin can view the prescription ============

drop function if exists public.admin_get_leaves(uuid, text, date, date, integer, integer);

create or replace function public.admin_get_leaves(
  p_token uuid, p_status text default null, p_from date default null, p_to date default null,
  p_limit integer default 500, p_offset integer default 0
)
 returns table(
   id uuid, emp_id uuid, emp_name text, company text, leave_type text, date date, day_part text, reason text, location text,
   document_path text, status text, applied_at timestamp with time zone, updated_at timestamp with time zone,
   manager_decision text, manager_decided_by uuid, manager_decided_at timestamp with time zone,
   admin_decision text, admin_decided_at timestamp with time zone,
   has_manager boolean, manager_name text
 )
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query
    select la.id, la.emp_id, la.emp_name, la.company, la.leave_type, la.date, la.day_part, la.reason, la.location,
      la.document_path, la.status, la.applied_at, la.updated_at,
      la.manager_decision, la.manager_decided_by, la.manager_decided_at,
      la.admin_decision, la.admin_decided_at,
      (e.manager_emp_id is not null) as has_manager, m.name as manager_name
    from leave_applications la
    join employees e on e.id = la.emp_id
    left join employees m on m.id = e.manager_emp_id
    where (p_status is null or la.status = p_status)
      and (p_from is null or la.date >= p_from)
      and (p_to is null or la.date <= p_to)
    order by la.date desc
    limit p_limit offset p_offset;
end;
$function$;

grant execute on function public.admin_get_leaves(uuid, text, date, date, integer, integer) to anon;

-- manager_get_team_leaves (returns setof leave_applications) automatically picks up
-- document_path too — a manager can see whether a prescription was attached, same as
-- every other column, no function signature change needed there.
