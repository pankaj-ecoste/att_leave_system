-- Backend-engineer convenience surface (2026-08-10, user request): a single, directly
-- editable row per employee — name, email, Casual/Earned/Sick/Compensatory Leave
-- balance — for quick lookups and corrections straight from the Supabase table editor,
-- instead of hunting through `leave_balances`'s one-row-per-leave-type shape.
--
-- Deliberately a VIEW with an INSTEAD OF trigger, not a second table: `leave_balances`
-- stays the only real source of truth the app itself ever reads or writes. A genuine
-- duplicate table would let someone "fix" a number here that the app never sees —
-- exactly the kind of bug this project's own guardrail discipline exists to prevent.
-- Editing a cell in this view routes straight through to the real `leave_balances` row
-- via the trigger below, using the same "accrued minus what you typed = consumed" math
-- the arrears-model correction (0025/0026) and the balance-sheet import script both use
-- — so an edit made here is exactly as valid as one made through the app's own admin
-- editor, not a parallel, inconsistent path.
--
-- No grant to anon/authenticated on purpose — this is reachable only via a direct
-- Postgres connection (the session-pooler connection string, or the Supabase dashboard's
-- own table editor), never through the app's public API surface.

create or replace view public.leave_balance_editor as
select
  e.id as emp_id,
  e.name as emp_name,
  e.email,
  e.emp_num,
  e.company,
  max(lb.balance) filter (where lb.leave_type = 'Casual Leave') as casual_leave,
  max(lb.balance) filter (where lb.leave_type = 'Earned Leave') as earned_leave,
  max(lb.balance) filter (where lb.leave_type = 'Sick Leave') as sick_leave,
  max(lb.balance) filter (where lb.leave_type = 'Compensatory Leave') as compensatory_leave
from employees e
left join leave_balances lb on lb.emp_id = e.id and lb.financial_year = current_fy()
where e.deleted_at is null
group by e.id, e.name, e.email, e.emp_num, e.company
order by e.name;

create or replace function public.leave_balance_editor_update()
 returns trigger
 language plpgsql
as $function$
declare
  v_types text[] := array['Casual Leave', 'Earned Leave', 'Sick Leave', 'Compensatory Leave'];
  v_default_quota numeric;
  v_type text;
  v_old_val numeric;
  v_new_val numeric;
  v_accrued numeric;
begin
  foreach v_type in array v_types loop
    v_old_val := case v_type
      when 'Casual Leave' then old.casual_leave
      when 'Earned Leave' then old.earned_leave
      when 'Sick Leave' then old.sick_leave
      when 'Compensatory Leave' then old.compensatory_leave
    end;
    v_new_val := case v_type
      when 'Casual Leave' then new.casual_leave
      when 'Earned Leave' then new.earned_leave
      when 'Sick Leave' then new.sick_leave
      when 'Compensatory Leave' then new.compensatory_leave
    end;
    continue when v_new_val is null or v_new_val is not distinct from v_old_val;

    -- A leave_balances row might not exist yet (e.g. Compensatory Leave before the
    -- employee has ever earned any) — create it with quota 0 (Comp-off has no fixed
    -- annual quota) or 4 (Sick Leave's flat policy amount) so the edit still lands
    -- somewhere real rather than silently failing.
    v_default_quota := case v_type when 'Sick Leave' then 4 else 0 end;
    insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
    values (new.emp_id, v_type, 0, 0, 0, v_default_quota, 'Days')
    on conflict (emp_id, leave_type, financial_year) do nothing;

    select accrued into v_accrued from leave_balances
      where emp_id = new.emp_id and leave_type = v_type and financial_year = current_fy();

    update leave_balances
      set balance = v_new_val, consumed = v_accrued - v_new_val, updated_at = now()
      where emp_id = new.emp_id and leave_type = v_type and financial_year = current_fy();

    perform log_audit('LEAVE_BAL_UPDATE',
      new.emp_name || ' — ' || v_type || ' balance ' || coalesce(v_old_val::text, 'none') || ' -> ' || v_new_val || ' (via leave_balance_editor)',
      'admin');
  end loop;
  return new;
end;
$function$;

drop trigger if exists leave_balance_editor_instead_of_update on public.leave_balance_editor;
create trigger leave_balance_editor_instead_of_update
  instead of update on public.leave_balance_editor
  for each row execute function public.leave_balance_editor_update();
