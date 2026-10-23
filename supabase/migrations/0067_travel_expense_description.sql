-- plan.md §49 — an "Other" travel expense must say what it was for.
--
-- Additive: one new nullable column; existing rows are untouched (description stays empty).
-- employee_add_travel_expense gains a trailing, defaulted p_description. A new parameter changes
-- the function's signature, so the old 8-argument version is dropped and recreated (as 0046 did) —
-- otherwise two versions would exist and a call without the new argument would be ambiguous.
-- An older app screen that does not send p_description keeps working for Toll and Lunch.

alter table public.travel_expenses add column if not exists description text;

drop function if exists public.employee_add_travel_expense(uuid, uuid, text, numeric, text, numeric, numeric, numeric);

create or replace function public.employee_add_travel_expense(
  p_token uuid, p_emp_id uuid, p_category text, p_amount numeric, p_photo_path text,
  p_lat numeric default null, p_lon numeric default null, p_accuracy_m numeric default null,
  p_description text default null
)
 returns travel_expenses
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_work text;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_in boolean; v_still_in boolean;
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_row travel_expenses;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;

  select work_mode into v_work from employees where id = p_emp_id;
  if v_work is null or v_work not in ('field', 'both') then
    raise exception 'Travel expenses are only available for Field / Office+Field staff';
  end if;
  if p_category is null or p_category not in ('Toll', 'Lunch', 'Other') then
    raise exception 'Choose an expense type: Toll, Lunch or Other';
  end if;
  if p_category = 'Other' and v_desc is null then
    raise exception 'Please write what this expense was for';
  end if;
  if v_desc is not null and char_length(v_desc) > 100 then
    raise exception 'The description is too long (100 characters at most)';
  end if;
  if p_category <> 'Other' then v_desc := null; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Enter a valid expense amount'; end if;
  if p_amount > 100000 then raise exception 'That amount looks too large — please check it'; end if;
  if p_photo_path is null or btrim(p_photo_path) = '' then raise exception 'A bill photo is required'; end if;

  select (in_time is not null), (out_time is null) into v_in, v_still_in
    from attendance where emp_id = p_emp_id and date = v_today;
  if not coalesce(v_in, false) then
    raise exception 'Punch in before adding an expense';
  end if;
  if not coalesce(v_still_in, false) then
    raise exception 'You have already punched out — expenses can only be added between punch in and punch out';
  end if;

  insert into travel_expenses (emp_id, date, category, description, amount, photo_path, lat, lon, accuracy_m)
    values (p_emp_id, v_today, p_category, v_desc, p_amount, p_photo_path, p_lat, p_lon, p_accuracy_m)
    returning * into v_row;

  return v_row;
end;
$function$;

grant execute on function public.employee_add_travel_expense(uuid, uuid, text, numeric, text, numeric, numeric, numeric, text) to anon;
