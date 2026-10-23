-- Both employee_get_travel_claims and admin_get_travel_claims only ever returned
-- claims with status = 'Submitted' (0062). Once a claim is marked Paid, migration 0065
-- already deletes its detailed visit/expense rows and photos — but the claim list
-- itself also dropped the claim from both screens entirely the moment it was paid,
-- with no trace left anywhere in the UI (confirmed live, 2026-10-23: 0 paid claims
-- exist yet, so this has never actually been seen happening).
--
-- Requested: once paid, don't show the full detail (period + km + expenses breakdown
-- + a now-meaningless "Mark as Paid" button) — but don't make it vanish without a
-- trace either. Keep one simple confirmation line. Capped at the 5 most recent paid
-- claims (per employee) so this list doesn't just grow forever — the permanent record
-- for anyone who needs the full history either way for real users is travel_settlements,
-- untouched by this.
--
-- Same signature, same return shape (setof travel_claims) as 0062 — a pure body change,
-- no drop needed, no change to how the client calls either function.

create or replace function public.employee_get_travel_claims(p_token uuid, p_emp_id uuid)
 returns setof travel_claims
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query
    select tc.* from travel_claims tc
    where tc.emp_id = p_emp_id
      and (tc.status = 'Submitted' or tc.id in (
        select id from travel_claims where emp_id = p_emp_id and status = 'Paid' order by paid_at desc limit 5
      ))
    order by (tc.status = 'Submitted') desc,
             case when tc.status = 'Submitted' then tc.submitted_at end asc,
             case when tc.status = 'Paid' then tc.paid_at end desc;
end;
$function$;

create or replace function public.admin_get_travel_claims(p_token uuid)
 returns setof travel_claims
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select tc.* from travel_claims tc
    where tc.status = 'Submitted' or tc.id in (
      -- most recent 5 PER EMPLOYEE, not 5 total across the whole company
      select id from (
        select id, row_number() over (partition by emp_id order by paid_at desc) as rn
        from travel_claims where status = 'Paid'
      ) ranked where rn <= 5
    )
    order by (tc.status = 'Submitted') desc,
             case when tc.status = 'Submitted' then tc.submitted_at end asc,
             case when tc.status = 'Paid' then tc.paid_at end desc;
end;
$function$;
