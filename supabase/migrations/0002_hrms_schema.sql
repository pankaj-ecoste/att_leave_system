-- HRMS — schema for the paid Supabase project (Mumbai / ap-south-1)
-- Fresh build, not a migration of the old project. Written correctly from the start:
-- see plan.md §4.1 for the 5 broken functions this replaces, and §8B for the scale
-- decisions (day_type, attendance_monthly_summary, indexes) baked in here rather than
-- bolted on after go-live.
--
-- Column-name fix: the OLD project's `employees` table already used the correct names
-- (business_unit / department / sub_department) — only its *functions* referenced the
-- stale `bu` / `dept` / `sub_dept`. Those functions live in 0003_hrms_functions.sql.

-- ============ EXTENSIONS ============
create extension if not exists "pgcrypto" with schema "extensions";
create extension if not exists "pg_cron";
create extension if not exists "uuid-ossp" with schema "extensions";

-- ============ UTILITY FUNCTIONS ============
-- current_fy() is used as a column default below, so it must exist before the tables
-- that reference it. The 59 business-logic functions live in 0003_hrms_functions.sql.

create or replace function public.current_fy()
 returns integer
 language sql
 stable
as $function$
  select date_part('year', case when date_part('month', now()) >= 4 then now() else now() - interval '1 year' end)::int;
$function$;

-- bio_wrk_hrs / bio_ot arrive as free-text from biometric exports and sometimes hold
-- placeholders like "-" rather than a number. A bare ::numeric cast on a bad value
-- would abort the whole insert (and, via the trigger below, every attendance write) —
-- exactly the kind of landmine this schema is meant to avoid. This returns null instead.
create or replace function public.safe_numeric(p_text text)
 returns numeric
 language plpgsql
 immutable
as $function$
begin
  if p_text is null or trim(p_text) = '' then return null; end if;
  return trim(p_text)::numeric;
exception when others then
  return null;
end;
$function$;

-- ============ TABLES ============

create table if not exists "public"."admin_sessions" (
  "token" uuid default gen_random_uuid() not null primary key,
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '12:00:00'::interval) not null
);

create table if not exists "public"."app_settings" (
  "id" smallint not null primary key check (id = 1),
  "admin_pin_hash" text not null,
  "std_hours" numeric not null default 9,
  "admin_failed_attempts" integer not null default 0,
  "admin_locked_until" timestamp with time zone
);

create table if not exists "public"."employees" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_num" text,
  "name" text not null,
  "pin" text not null, -- bcrypt hash via pgcrypto, never plaintext (fixes plan.md §4.3 #1)
  "company" text not null,
  "job_title" text,
  "business_unit" text,
  "department" text,
  "sub_department" text,
  "location_info" text,
  "cost_center" text,
  "manager" text,
  "manager_emp_id" uuid references employees(id) on delete set null,
  "email" text,
  "phone" text,
  "joining_date" date,
  "active" boolean not null default true,
  "shift_type" text not null default 'none',
  "employment_status" text not null default 'Probation'
    check (employment_status in ('Probation', 'Confirmed', 'Notice Period', 'Exited')),
  "probation_end_date" date,
  "confirmed_on" date,
  "failed_pin_attempts" integer not null default 0,
  "locked_until" timestamp with time zone,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."attendance" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "date" date not null,
  "day_type" text not null default 'working' check (day_type in ('working', 'week_off', 'holiday')),
  "in_time" time without time zone,
  "out_time" time without time zone,
  "in_location" text,
  "out_location" text,
  "leave_type" text,
  "leave_reason" text,
  "wfh" boolean not null default false,
  "on_duty" boolean not null default false,
  "status" text,
  "late_hrs" text,
  "early_hrs" text,
  "bio_wrk_hrs" text,
  "bio_ot" text,
  "shift" text,
  "shift_start" text,
  "in_temp" text,
  "out_temp" text,
  "remark" text,
  "card_no" text,
  "designation" text,
  "bio_status_raw" text,
  "bio_source" text,
  "monthly_source" text,
  "source" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  unique (emp_id, date)
);

-- No FK on emp_id: this is a derived cache, kept current by the trigger below. A real
-- FK here would deadlock against it — deleting an employee cascade-deletes their
-- attendance rows first, whose AFTER DELETE trigger would then try to re-insert a
-- summary row referencing an employee id that, by that point, no longer exists.
create table if not exists "public"."attendance_monthly_summary" (
  "emp_id" uuid not null,
  "year" integer not null,
  "month" integer not null,
  "present" integer not null default 0,
  "absent" integer not null default 0,
  "half_day" integer not null default 0,
  "leave" integer not null default 0,
  "wfh" integer not null default 0,
  "on_duty" integer not null default 0,
  "total_hours" numeric not null default 0,
  "overtime_hours" numeric not null default 0,
  "updated_at" timestamp with time zone default now() not null,
  primary key (emp_id, year, month)
);

create table if not exists "public"."audit_logs" (
  "id" uuid default gen_random_uuid() not null primary key,
  "ts" timestamp with time zone default now() not null,
  "action" text not null,
  "detail" text,
  "by_name" text
);

create table if not exists "public"."bio_sheet_cache" (
  "id" smallint not null primary key check (id = 1),
  "filename" text,
  "cols" jsonb not null default '[]'::jsonb,
  "rows" jsonb not null default '[]'::jsonb,
  "report_date" date,
  "synced" integer,
  "skipped" integer,
  "imported_at" timestamp with time zone
);

create table if not exists "public"."employee_sessions" (
  "token" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '18:00:00'::interval) not null
);

create table if not exists "public"."holidays" (
  "id" uuid default gen_random_uuid() not null primary key,
  "date" date not null,
  "name" text not null,
  "type" text not null default 'Public',
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."imported_sheet_cache" (
  "id" smallint not null primary key check (id = 1),
  "filename" text,
  "cols" jsonb not null default '[]'::jsonb,
  "rows" jsonb not null default '[]'::jsonb,
  "imported_at" timestamp with time zone
);

create table if not exists "public"."leave_applications" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "emp_name" text,
  "company" text,
  "leave_type" text not null,
  "date" date not null,
  "reason" text,
  "location" text,
  "status" text not null default 'Pending',
  "applied_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

create table if not exists "public"."leave_balances" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "leave_type" text not null,
  "accrued" numeric not null default 0,
  "consumed" numeric not null default 0,
  "balance" numeric not null default 0,
  "quota" numeric not null default 0,
  "unit" text not null default 'Days',
  "financial_year" integer not null default current_fy(),
  unique (emp_id, leave_type, financial_year)
);

create table if not exists "public"."location_logs" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "date" date not null,
  "lat_lon" text not null,
  "captured_at" timestamp with time zone default now() not null,
  "type" text not null default 'auto'
);

create table if not exists "public"."monthly_sheet_cache" (
  "id" smallint not null primary key check (id = 1),
  "filename" text,
  "report_month" integer,
  "report_year" integer,
  "synced" integer,
  "skipped" integer,
  "imported_at" timestamp with time zone
);

create table if not exists "public"."od_tracking_logs" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "date" date not null,
  "lat_lon" text not null,
  "ts" timestamp with time zone default now() not null
);

create table if not exists "public"."regularization_requests" (
  "id" uuid default gen_random_uuid() not null primary key,
  "emp_id" uuid not null references employees(id) on delete cascade,
  "date" date not null,
  "requested_in" time without time zone,
  "requested_out" time without time zone,
  "reason" text not null,
  "status" text not null default 'Pending',
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ============ INDEXES (plan.md §8B) ============

create index if not exists idx_attendance_emp_id on attendance (emp_id);
create index if not exists idx_attendance_date on attendance (date);
create index if not exists idx_attendance_date_emp_id on attendance (date, emp_id);

create index if not exists idx_employees_active on employees (active);
create index if not exists idx_employees_emp_num on employees (emp_num);
create index if not exists idx_employees_company on employees (company);
create index if not exists idx_employees_manager_emp_id on employees (manager_emp_id);

create index if not exists idx_leave_applications_emp_id on leave_applications (emp_id);
create index if not exists idx_leave_applications_status on leave_applications (status);
create index if not exists idx_leave_applications_emp_id_date on leave_applications (emp_id, date);
create index if not exists idx_leave_applications_date on leave_applications (date);

create index if not exists idx_regularization_requests_emp_id on regularization_requests (emp_id);
create index if not exists idx_regularization_requests_status on regularization_requests (status);
create index if not exists idx_regularization_requests_date on regularization_requests (date);

create index if not exists idx_location_logs_emp_id_date on location_logs (emp_id, date);
create index if not exists idx_location_logs_date on location_logs (date);
create index if not exists idx_location_logs_captured_at on location_logs (captured_at);

create index if not exists idx_od_tracking_logs_emp_id_date on od_tracking_logs (emp_id, date);
create index if not exists idx_od_tracking_logs_date on od_tracking_logs (date);
create index if not exists idx_od_tracking_logs_ts on od_tracking_logs (ts);

create index if not exists idx_employee_sessions_expires_at on employee_sessions (expires_at);
create index if not exists idx_admin_sessions_expires_at on admin_sessions (expires_at);

create index if not exists idx_holidays_date on holidays (date);
create index if not exists idx_audit_logs_ts on audit_logs (ts);

-- ============ VIEWS ============
-- Owned by the migration role (Supabase's postgres superuser), so these bypass the
-- underlying tables' RLS by design — the same pattern the old app already relied on.
-- Field set matches the old fetch_directory()/employees_directory exactly, for parity
-- with the frontend; not touched in this pass (see 0002 migration notes / PROGRESS.md).

create or replace view public.employees_directory as
  select id, name, company, emp_num, job_title, business_unit, department, sub_department,
    location_info, cost_center, manager, manager_emp_id, email, phone, joining_date,
    active, shift_type
  from employees
  where active = true
  order by name;

-- Later migrations (0020, 0023) widen this view with more columns (admin_email,
-- birthday_message). CREATE OR REPLACE VIEW can only append columns, never drop them —
-- so replaying this file's original narrow definition against an already-widened live
-- view fails with "cannot drop columns from view". Same re-run-safety class of fix
-- already applied to fetch_directory (0005) and 0003 itself (0008) for the same reason —
-- drop first so this file stays safe to replay at any point in the migration history,
-- not just on a brand-new database.
drop view if exists public.app_settings_public;
create or replace view public.app_settings_public as
  select std_hours from app_settings where id = 1;

grant select on public.employees_directory to anon;
grant select on public.app_settings_public to anon;
grant select on public.holidays to anon;

-- ============ ROW LEVEL SECURITY ============
-- Every table is locked down: no direct anon access except the two policies below.
-- All reads/writes go through SECURITY DEFINER functions (0003_hrms_functions.sql),
-- each of which re-checks the caller's token itself. This part was already correct in
-- the old app and stays that way.

alter table admin_sessions enable row level security;
alter table app_settings enable row level security;
alter table employees enable row level security;
alter table attendance enable row level security;
alter table attendance_monthly_summary enable row level security;
alter table audit_logs enable row level security;
alter table bio_sheet_cache enable row level security;
alter table employee_sessions enable row level security;
alter table holidays enable row level security;
alter table imported_sheet_cache enable row level security;
alter table leave_applications enable row level security;
alter table leave_balances enable row level security;
alter table location_logs enable row level security;
alter table monthly_sheet_cache enable row level security;
alter table od_tracking_logs enable row level security;
alter table regularization_requests enable row level security;

-- Public, read-only, no PIN/session required — powers the login screen only.
-- CREATE POLICY has no IF NOT EXISTS in Postgres, so drop-then-create for idempotency
-- (this file is documented as safe to re-run — that has to actually be true).
drop policy if exists "anon can read holidays" on holidays;
create policy "anon can read holidays" on holidays for select to anon using (true);

-- audit_logs deliberately has NO anon insert policy (fixes plan.md §4.3 #3 — "anyone
-- can forge audit log entries"). Writes happen only from inside SECURITY DEFINER
-- functions via the log_audit() helper below, which runs as the function owner.

create or replace function public.log_audit(p_action text, p_detail text, p_by_name text)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  insert into audit_logs (action, detail, by_name) values (p_action, p_detail, p_by_name);
$function$;

-- Postgres grants EXECUTE to PUBLIC by default on new functions — revoke it here, or
-- anon could call log_audit() directly over RPC and forge entries anyway, defeating
-- the point of dropping the anon insert policy above. Called only from inside other
-- SECURITY DEFINER functions, which run with the definer's privileges regardless.
revoke execute on function public.log_audit(text, text, text) from public;

-- ============ ATTENDANCE MONTHLY SUMMARY (§8B S-3) ============
-- Dashboards and reports read this instead of scanning raw attendance rows — a
-- twelve-month comparison costs 12 rows per person, not 365. Kept current by trigger;
-- status counts come from the already-computed `status` text column on attendance, so
-- this doesn't duplicate the day-status calculation, just aggregates it.

create or replace function public.refresh_attendance_monthly_summary()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_emp_id uuid := coalesce(new.emp_id, old.emp_id);
  v_year int := extract(year from coalesce(new.date, old.date))::int;
  v_month int := extract(month from coalesce(new.date, old.date))::int;
begin
  insert into attendance_monthly_summary (
    emp_id, year, month, present, absent, half_day, leave, wfh, on_duty,
    total_hours, overtime_hours, updated_at
  )
  select
    v_emp_id, v_year, v_month,
    count(*) filter (where status = 'Present'),
    count(*) filter (where status = 'Absent'),
    count(*) filter (where status = 'Half Day'),
    count(*) filter (where status = 'Leave' or status = 'Half Day Leave'),
    count(*) filter (where wfh),
    count(*) filter (where on_duty),
    coalesce(sum(safe_numeric(bio_wrk_hrs)), 0),
    coalesce(sum(safe_numeric(bio_ot)), 0),
    now()
  from attendance
  where emp_id = v_emp_id
    and extract(year from date) = v_year
    and extract(month from date) = v_month
  on conflict (emp_id, year, month) do update set
    present = excluded.present, absent = excluded.absent, half_day = excluded.half_day,
    leave = excluded.leave, wfh = excluded.wfh, on_duty = excluded.on_duty,
    total_hours = excluded.total_hours, overtime_hours = excluded.overtime_hours,
    updated_at = excluded.updated_at;
  return coalesce(new, old);
end;
$function$;

create or replace trigger trg_attendance_monthly_summary
  after insert or update or delete on attendance
  for each row execute function refresh_attendance_monthly_summary();

-- ============ RETENTION (§8B) — pg_cron cleanup ============
-- Expired-session cleanup can run from day one; location/OD 90-day retention is added
-- once those tables carry real traffic (Day 2/3), so it isn't dropping test data now.

select cron.schedule(
  'cleanup-expired-sessions',
  '0 3 * * *', -- 03:00 IST daily (server runs UTC; adjust if this drifts from intent)
  $$
    delete from employee_sessions where expires_at < now();
    delete from admin_sessions where expires_at < now();
  $$
);
