-- Schema extracted from the live Supabase project
-- PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit
-- Generated 2026-08-04T06:35:56.369Z


-- ============ EXTENSIONS ============
create extension if not exists "pg_stat_statements" with schema "extensions";
create extension if not exists "pgcrypto" with schema "extensions";
create extension if not exists "plpgsql" with schema "pg_catalog";
create extension if not exists "supabase_vault" with schema "vault";
create extension if not exists "uuid-ossp" with schema "extensions";

-- ============ TABLES ============

create table if not exists "public"."admin_sessions" (
  "token" uuid default gen_random_uuid() not null,
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '12:00:00'::interval) not null
);

create table if not exists "public"."app_settings" (
  "id" smallint not null,
  "admin_pin_hash" text not null,
  "std_hours" numeric default 9 not null,
  "admin_failed_attempts" integer default 0 not null,
  "admin_locked_until" timestamp with time zone
);

create table if not exists "public"."attendance" (
  "id" uuid default gen_random_uuid() not null,
  "emp_id" uuid not null,
  "date" date not null,
  "in_time" time without time zone,
  "out_time" time without time zone,
  "in_location" text,
  "out_location" text,
  "leave_type" text,
  "leave_reason" text,
  "wfh" boolean default false not null,
  "on_duty" boolean default false not null,
  "status" text,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
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
  "week_off" boolean default false not null,
  "source" text
);

create table if not exists "public"."audit_logs" (
  "id" uuid default gen_random_uuid() not null,
  "ts" timestamp with time zone default now() not null,
  "action" text not null,
  "detail" text,
  "by_name" text
);

create table if not exists "public"."bio_sheet_cache" (
  "id" smallint not null,
  "filename" text,
  "cols" jsonb default '[]'::jsonb not null,
  "rows" jsonb default '[]'::jsonb not null,
  "report_date" date,
  "synced" integer,
  "skipped" integer,
  "imported_at" timestamp with time zone
);

create table if not exists "public"."employee_sessions" (
  "token" uuid default gen_random_uuid() not null,
  "emp_id" uuid not null,
  "created_at" timestamp with time zone default now() not null,
  "expires_at" timestamp with time zone default (now() + '18:00:00'::interval) not null
);

create table if not exists "public"."employees" (
  "id" uuid default gen_random_uuid() not null,
  "emp_num" text,
  "name" text not null,
  "pin" text not null,
  "company" text not null,
  "job_title" text,
  "business_unit" text,
  "department" text,
  "sub_department" text,
  "location_info" text,
  "cost_center" text,
  "manager" text,
  "email" text,
  "phone" text,
  "joining_date" date,
  "active" boolean default true not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null,
  "failed_pin_attempts" integer default 0 not null,
  "locked_until" timestamp with time zone,
  "manager_emp_id" uuid
);

create table if not exists "public"."holidays" (
  "id" uuid default gen_random_uuid() not null,
  "date" date not null,
  "name" text not null,
  "type" text default 'Public'::text not null,
  "created_at" timestamp with time zone default now() not null
);

create table if not exists "public"."imported_sheet_cache" (
  "id" smallint not null,
  "filename" text,
  "cols" jsonb default '[]'::jsonb not null,
  "rows" jsonb default '[]'::jsonb not null,
  "imported_at" timestamp with time zone
);

create table if not exists "public"."leave_applications" (
  "id" uuid default gen_random_uuid() not null,
  "emp_id" uuid not null,
  "emp_name" text,
  "company" text,
  "leave_type" text not null,
  "date" date not null,
  "reason" text,
  "location" text,
  "status" text default 'Pending'::text not null,
  "applied_at" timestamp with time zone default now() not null
);

create table if not exists "public"."leave_balances" (
  "id" uuid default gen_random_uuid() not null,
  "emp_id" uuid not null,
  "leave_type" text not null,
  "accrued" numeric default 0 not null,
  "consumed" numeric default 0 not null,
  "balance" numeric default 0 not null,
  "quota" numeric default 0 not null,
  "unit" text default 'Days'::text not null,
  "financial_year" integer default (date_part('year'::text,
CASE
    WHEN (date_part('month'::text, now()) >= (4)::double precision) THEN now()
    ELSE (now() - '1 year'::interval)
END))::integer not null
);

create table if not exists "public"."location_logs" (
  "id" uuid default gen_random_uuid() not null,
  "emp_id" uuid not null,
  "date" date not null,
  "lat_lon" text not null,
  "captured_at" timestamp with time zone default now() not null,
  "type" text default 'auto'::text not null
);

create table if not exists "public"."monthly_sheet_cache" (
  "id" smallint not null,
  "filename" text,
  "report_month" integer,
  "report_year" integer,
  "synced" integer,
  "skipped" integer,
  "imported_at" timestamp with time zone
);

create table if not exists "public"."od_tracking_logs" (
  "id" uuid default gen_random_uuid() not null,
  "emp_id" uuid not null,
  "date" date not null,
  "lat_lon" text not null,
  "ts" timestamp with time zone default now() not null
);

create table if not exists "public"."regularization_requests" (
  "id" uuid default gen_random_uuid() not null,
  "emp_id" uuid not null,
  "date" date not null,
  "requested_in" time without time zone,
  "requested_out" time without time zone,
  "reason" text not null,
  "status" text default 'Pending'::text not null,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- ============ CONSTRAINTS ============
alter table "public"."admin_sessions" add constraint "admin_sessions_pkey" PRIMARY KEY (token);
alter table "public"."app_settings" add constraint "app_settings_id_check" CHECK ((id = 1));
alter table "public"."app_settings" add constraint "app_settings_pkey" PRIMARY KEY (id);
alter table "public"."attendance" add constraint "attendance_pkey" PRIMARY KEY (id);
alter table "public"."attendance" add constraint "attendance_emp_id_date_key" UNIQUE (emp_id, date);
alter table "public"."audit_logs" add constraint "audit_logs_pkey" PRIMARY KEY (id);
alter table "public"."bio_sheet_cache" add constraint "bio_sheet_cache_id_check" CHECK ((id = 1));
alter table "public"."bio_sheet_cache" add constraint "bio_sheet_cache_pkey" PRIMARY KEY (id);
alter table "public"."employee_sessions" add constraint "employee_sessions_pkey" PRIMARY KEY (token);
alter table "public"."employees" add constraint "employees_pkey" PRIMARY KEY (id);
alter table "public"."holidays" add constraint "holidays_pkey" PRIMARY KEY (id);
alter table "public"."imported_sheet_cache" add constraint "imported_sheet_cache_id_check" CHECK ((id = 1));
alter table "public"."imported_sheet_cache" add constraint "imported_sheet_cache_pkey" PRIMARY KEY (id);
alter table "public"."leave_applications" add constraint "leave_applications_pkey" PRIMARY KEY (id);
alter table "public"."leave_balances" add constraint "leave_balances_pkey" PRIMARY KEY (id);
alter table "public"."leave_balances" add constraint "leave_balances_emp_id_leave_type_fy_key" UNIQUE (emp_id, leave_type, financial_year);
alter table "public"."location_logs" add constraint "location_logs_pkey" PRIMARY KEY (id);
alter table "public"."monthly_sheet_cache" add constraint "monthly_sheet_cache_id_check" CHECK ((id = 1));
alter table "public"."monthly_sheet_cache" add constraint "monthly_sheet_cache_pkey" PRIMARY KEY (id);
alter table "public"."od_tracking_logs" add constraint "od_tracking_logs_pkey" PRIMARY KEY (id);
alter table "public"."regularization_requests" add constraint "regularization_requests_pkey" PRIMARY KEY (id);
alter table "public"."attendance" add constraint "attendance_emp_id_fkey" FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table "public"."employee_sessions" add constraint "employee_sessions_emp_id_fkey" FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table "public"."employees" add constraint "employees_manager_emp_id_fkey" FOREIGN KEY (manager_emp_id) REFERENCES employees(id) ON DELETE SET NULL;
alter table "public"."leave_applications" add constraint "leave_applications_emp_id_fkey" FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table "public"."leave_balances" add constraint "leave_balances_emp_id_fkey" FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table "public"."location_logs" add constraint "location_logs_emp_id_fkey" FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table "public"."od_tracking_logs" add constraint "od_tracking_logs_emp_id_fkey" FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE;
alter table "public"."regularization_requests" add constraint "regularization_requests_emp_id_fkey" FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE;

-- ============ INDEXES ============
CREATE UNIQUE INDEX attendance_emp_id_date_key ON public.attendance USING btree (emp_id, date);
CREATE INDEX idx_attendance_date ON public.attendance USING btree (date);
CREATE INDEX idx_attendance_emp ON public.attendance USING btree (emp_id);
CREATE INDEX idx_audit_ts ON public.audit_logs USING btree (ts DESC);
CREATE INDEX idx_employee_sessions_emp ON public.employee_sessions USING btree (emp_id);
CREATE INDEX idx_employees_company ON public.employees USING btree (company);
CREATE INDEX idx_employees_manager ON public.employees USING btree (manager_emp_id);
CREATE INDEX idx_leaves_emp ON public.leave_applications USING btree (emp_id);
CREATE INDEX idx_leave_balances_fy ON public.leave_balances USING btree (emp_id, financial_year);
CREATE UNIQUE INDEX leave_balances_emp_id_leave_type_fy_key ON public.leave_balances USING btree (emp_id, leave_type, financial_year);
CREATE INDEX idx_location_logs_emp_date ON public.location_logs USING btree (emp_id, date);
CREATE INDEX idx_od_logs_emp_date ON public.od_tracking_logs USING btree (emp_id, date);

-- ============ VIEWS ============

create or replace view "public"."app_settings_public" as
 SELECT std_hours
   FROM app_settings
  WHERE id = 1;

create or replace view "public"."employees_directory" as
 SELECT id,
    name,
    company,
    job_title,
    department,
    sub_department,
    active
   FROM employees
  WHERE active = true;

-- ============ FUNCTIONS (59) ============

CREATE OR REPLACE FUNCTION public.admin_add_holiday(p_token uuid, p_date date, p_name text, p_type text)
 RETURNS holidays
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row holidays;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into holidays (date, name, type) values (p_date, p_name, p_type) returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_bulk_upsert_attendance(p_token uuid, p_records jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into attendance (
    emp_id, date, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source,
    week_off, source
  )
  select
    (r->>'emp_id')::uuid, (r->>'date')::date, nullif(r->>'in_time','')::time, nullif(r->>'out_time','')::time,
    r->>'in_location', r->>'out_location', r->>'leave_type', r->>'leave_reason',
    coalesce((r->>'wfh')::boolean,false), coalesce((r->>'on_duty')::boolean,false), r->>'status',
    r->>'late_hrs', r->>'early_hrs', r->>'bio_wrk_hrs', r->>'bio_ot',
    r->>'shift', r->>'shift_start', r->>'in_temp', r->>'out_temp',
    r->>'remark', r->>'card_no', r->>'designation', r->>'bio_status_raw',
    r->>'bio_source', r->>'monthly_source', coalesce((r->>'week_off')::boolean,false), r->>'source'
  from jsonb_array_elements(p_records) as r
  on conflict (emp_id, date) do update set
    in_time=excluded.in_time, out_time=excluded.out_time, in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, week_off=excluded.week_off, source=excluded.source,
    updated_at=now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_bulk_upsert_leave_balances(p_token uuid, p_records jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  insert into leave_balances(emp_id, leave_type, accrued, consumed, balance, quota, unit, financial_year)
  select
    (r->>'emp_id')::uuid,
    r->>'leave_type',
    coalesce(nullif(r->>'accrued','')::numeric, 0),
    coalesce(nullif(r->>'consumed','')::numeric, 0),
    coalesce(nullif(r->>'balance','')::numeric, 0),
    coalesce(nullif(r->>'quota','')::numeric, 0),
    coalesce(nullif(r->>'unit',''), 'Days'),
    current_fy()
  from jsonb_array_elements(p_records) as r
  on conflict (emp_id, leave_type, financial_year) do update set
    accrued=excluded.accrued, consumed=excluded.consumed,
    balance=excluded.balance, quota=excluded.quota, unit=excluded.unit;
  get diagnostics v_count = row_count;
  return v_count;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_clear_bio_sheet(p_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update bio_sheet_cache set filename=null, cols='[]'::jsonb, rows='[]'::jsonb, report_date=null, synced=null, skipped=null, imported_at=null where id = 1;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_clear_imported_sheet(p_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update imported_sheet_cache set filename = null, cols = '[]'::jsonb, rows = '[]'::jsonb, imported_at = null where id = 1;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_clear_monthly_sheet(p_token uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update monthly_sheet_cache set filename=null, report_month=null, report_year=null, synced=null, skipped=null, imported_at=null where id = 1;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_create_employee(p_token uuid, p_data jsonb)
 RETURNS employees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  insert into employees(name, pin, company, emp_num, job_title, bu, dept, sub_dept,
    location_info, cost_center, manager, email, phone, joining_date, shift_type, manager_emp_id)
  values(
    p_data->>'name', p_data->>'pin', p_data->>'company',
    p_data->>'empNum', p_data->>'jobTitle', p_data->>'bu', p_data->>'dept',
    p_data->>'subDept', p_data->>'locationInfo', p_data->>'costCenter',
    p_data->>'manager', p_data->>'email', p_data->>'phone',
    nullif(p_data->>'joiningDate','')::date,
    p_data->>'shiftType',
    nullif(p_data->>'managerEmpId','')::uuid
  ) returning * into v_row;
  return v_row;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_decide_leave(p_token uuid, p_leave_id uuid, p_decision text)
 RETURNS leave_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row leave_applications;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_decision not in ('Approved','Rejected') then raise exception 'Invalid decision'; end if;
  update leave_applications set status = p_decision where id = p_leave_id returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_decide_regularization(p_token uuid, p_id uuid, p_status text)
 RETURNS regularization_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row regularization_requests;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update regularization_requests set status=p_status, updated_at=now() where id=p_id returning * into v_row;
  if p_status='Approved' then
    insert into attendance(emp_id,date,in_time,out_time,status,source)
    values(v_row.emp_id, v_row.date, v_row.requested_in, v_row.requested_out,
           case when v_row.requested_in is not null then 'Present' else 'Absent' end, 'regularization')
    on conflict(emp_id,date) do update set
      in_time=excluded.in_time, out_time=excluded.out_time,
      source='regularization', updated_at=now();
  end if;
  return v_row;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_employee(p_token uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  delete from employees where id = p_id;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_delete_holiday(p_token uuid, p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  delete from holidays where id = p_id;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_fetch_all_leave_balances(p_token uuid)
 RETURNS SETOF leave_balances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select * from leave_balances where financial_year = current_fy() order by emp_id, leave_type;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_all_attendance(p_token uuid)
 RETURNS SETOF attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from attendance;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_all_leave_balances(p_token uuid)
 RETURNS SETOF leave_balances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from leave_balances;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_all_leaves(p_token uuid)
 RETURNS SETOF leave_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from leave_applications order by date desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_all_location_logs(p_token uuid, p_date date)
 RETURNS TABLE(id uuid, emp_id uuid, emp_name text, emp_num text, date date, lat_lon text, type text, captured_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select l.id, l.emp_id, e.name, e.emp_num, l.date, l.lat_lon, l.type, l.captured_at
    from location_logs l join employees e on e.id=l.emp_id
    where l.date=p_date order by l.captured_at desc;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_audit_logs(p_token uuid, p_limit integer DEFAULT 500)
 RETURNS SETOF audit_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from audit_logs order by ts desc limit p_limit;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_bio_sheet(p_token uuid)
 RETURNS bio_sheet_cache
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row bio_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select * into v_row from bio_sheet_cache where id = 1;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_employees(p_token uuid)
 RETURNS SETOF employees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from employees order by name;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_holidays(p_token uuid)
 RETURNS SETOF holidays
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from holidays order by date;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_imported_sheet(p_token uuid)
 RETURNS imported_sheet_cache
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row imported_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select * into v_row from imported_sheet_cache where id = 1;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_location_logs(p_token uuid, p_emp_id uuid, p_date date)
 RETURNS SETOF location_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query select * from location_logs where emp_id=p_emp_id and date=p_date order by captured_at;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_monthly_sheet(p_token uuid)
 RETURNS monthly_sheet_cache
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row monthly_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  select * into v_row from monthly_sheet_cache where id = 1;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_od_logs(p_token uuid, p_emp_id uuid, p_date date)
 RETURNS SETOF od_tracking_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  return query select * from od_tracking_logs where emp_id = p_emp_id and date = p_date order by ts;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_get_regularizations(p_token uuid)
 RETURNS TABLE(id uuid, emp_id uuid, emp_name text, emp_num text, date date, requested_in time without time zone, requested_out time without time zone, reason text, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  return query
    select r.id, r.emp_id, e.name, e.emp_num, r.date, r.requested_in, r.requested_out, r.reason, r.status, r.created_at
    from regularization_requests r join employees e on e.id=r.emp_id
    order by r.created_at desc;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_login(p_pin text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare v_hash text; v_locked_until timestamptz; v_token uuid;
begin
  select admin_pin_hash, admin_locked_until into v_hash, v_locked_until from app_settings where id = 1;
  if v_locked_until is not null and v_locked_until > now() then return null; end if;
  if v_hash is null or v_hash <> crypt(p_pin, v_hash) then
    update app_settings set
      admin_failed_attempts = admin_failed_attempts + 1,
      admin_locked_until = case when admin_failed_attempts + 1 >= 5 then now() + interval '15 minutes' else admin_locked_until end
      where id = 1;
    return null;
  end if;
  update app_settings set admin_failed_attempts = 0, admin_locked_until = null where id = 1;
  insert into admin_sessions (token, expires_at) values (gen_random_uuid(), now() + interval '12 hours') returning token into v_token;
  return v_token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_logout(p_token uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (delete from admin_sessions where token = p_token returning 1)
  select true;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_reset_leave_balances(p_token uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_count int; v_new_fy int;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  v_new_fy := current_fy() + 1;
  -- Create fresh zero-consumed records for new FY, copying quota from current year
  insert into leave_balances(emp_id, leave_type, accrued, consumed, balance, quota, unit, financial_year)
  select emp_id, leave_type, quota, 0, quota, quota, unit, v_new_fy
  from leave_balances
  where financial_year = current_fy()
  on conflict (emp_id, leave_type, financial_year) do nothing;
  get diagnostics v_count = row_count;
  insert into audit_logs(action, detail, performed_by)
  values('LEAVE_RESET', 'Financial year ' || v_new_fy || ' leave balances created', 'admin');
  return v_count;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_bio_sheet(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb, p_report_date date, p_synced integer, p_skipped integer)
 RETURNS bio_sheet_cache
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row bio_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update bio_sheet_cache set filename=p_filename, cols=p_cols, rows=p_rows, report_date=p_report_date, synced=p_synced, skipped=p_skipped, imported_at=now() where id = 1
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_imported_sheet(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb)
 RETURNS imported_sheet_cache
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row imported_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update imported_sheet_cache set filename = p_filename, cols = p_cols, rows = p_rows, imported_at = now() where id = 1
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_set_monthly_sheet(p_token uuid, p_filename text, p_report_month integer, p_report_year integer, p_synced integer, p_skipped integer)
 RETURNS monthly_sheet_cache
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row monthly_sheet_cache;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update monthly_sheet_cache set filename=p_filename, report_month=p_report_month, report_year=p_report_year, synced=p_synced, skipped=p_skipped, imported_at=now() where id = 1
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_toggle_employee_status(p_token uuid, p_id uuid)
 RETURNS employees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  update employees set active = not active, updated_at = now() where id = p_id returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_update_employee(p_token uuid, p_emp_id uuid, p_data jsonb)
 RETURNS employees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row employees;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid admin session'; end if;
  update employees set
    name=coalesce(p_data->>'name', name),
    pin=coalesce(p_data->>'pin', pin),
    company=coalesce(p_data->>'company', company),
    emp_num=coalesce(p_data->>'empNum', emp_num),
    job_title=coalesce(p_data->>'jobTitle', job_title),
    bu=coalesce(p_data->>'bu', bu),
    dept=coalesce(p_data->>'dept', dept),
    sub_dept=coalesce(p_data->>'subDept', sub_dept),
    location_info=coalesce(p_data->>'locationInfo', location_info),
    cost_center=coalesce(p_data->>'costCenter', cost_center),
    manager=coalesce(p_data->>'manager', manager),
    email=coalesce(p_data->>'email', email),
    phone=coalesce(p_data->>'phone', phone),
    joining_date=coalesce(nullif(p_data->>'joiningDate','')::date, joining_date),
    shift_type=coalesce(p_data->>'shiftType', shift_type),
    manager_emp_id=case 
      when p_data ? 'managerEmpId' then nullif(p_data->>'managerEmpId','')::uuid
      else manager_emp_id 
    end,
    updated_at=now()
  where id=p_emp_id returning * into v_row;
  return v_row;
end;$function$
;

CREATE OR REPLACE FUNCTION public.admin_update_settings(p_token uuid, p_std_hours numeric, p_new_admin_pin text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  if p_new_admin_pin is not null then
    update app_settings set std_hours = p_std_hours, admin_pin_hash = crypt(p_new_admin_pin, gen_salt('bf')) where id = 1;
  else
    update app_settings set std_hours = p_std_hours where id = 1;
  end if;
  return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_upsert_attendance(p_token uuid, p_emp_id uuid, p_data jsonb)
 RETURNS attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row attendance;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into attendance (
    emp_id, date, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source,
    week_off, source
  )
  values (
    p_emp_id, (p_data->>'date')::date, nullif(p_data->>'in_time','')::time, nullif(p_data->>'out_time','')::time,
    p_data->>'in_location', p_data->>'out_location', p_data->>'leave_type', p_data->>'leave_reason',
    coalesce((p_data->>'wfh')::boolean,false), coalesce((p_data->>'on_duty')::boolean,false), p_data->>'status',
    p_data->>'late_hrs', p_data->>'early_hrs', p_data->>'bio_wrk_hrs', p_data->>'bio_ot',
    p_data->>'shift', p_data->>'shift_start', p_data->>'in_temp', p_data->>'out_temp',
    p_data->>'remark', p_data->>'card_no', p_data->>'designation', p_data->>'bio_status_raw',
    p_data->>'bio_source', p_data->>'monthly_source', coalesce((p_data->>'week_off')::boolean,false),
    p_data->>'source'
  )
  on conflict (emp_id, date) do update set
    in_time=excluded.in_time, out_time=excluded.out_time, in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, week_off=excluded.week_off, source=excluded.source,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_upsert_leave_balance(p_token uuid, p_emp_id uuid, p_leave_type text, p_accrued numeric, p_consumed numeric, p_balance numeric, p_quota numeric, p_unit text)
 RETURNS leave_balances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row leave_balances;
begin
  if not is_valid_admin_token(p_token) then raise exception 'Invalid or expired admin session'; end if;
  insert into leave_balances (emp_id, leave_type, accrued, consumed, balance, quota, unit)
  values (p_emp_id, p_leave_type, p_accrued, p_consumed, p_balance, p_quota, p_unit)
  on conflict (emp_id, leave_type) do update set
    accrued = excluded.accrued, consumed = excluded.consumed, balance = excluded.balance,
    quota = excluded.quota, unit = excluded.unit
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.current_fy()
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select date_part('year', case when date_part('month', now()) >= 4 then now() else now() - interval '1 year' end)::int;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_apply_leave(p_token uuid, p_emp_id uuid, p_data jsonb)
 RETURNS leave_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row leave_applications;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  insert into leave_applications (emp_id, emp_name, company, leave_type, date, reason, location, status)
  values (p_emp_id, p_data->>'emp_name', p_data->>'company', p_data->>'leave_type', (p_data->>'date')::date, p_data->>'reason', p_data->>'location', 'Pending')
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_fetch_leave_balances(p_token uuid, p_emp_id uuid)
 RETURNS TABLE(emp_id uuid, leave_type text, accrued numeric, consumed numeric, balance numeric, quota numeric, unit text, financial_year integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query
    select lb.emp_id, lb.leave_type, lb.accrued, lb.consumed, lb.balance, lb.quota, lb.unit, lb.financial_year
    from leave_balances lb
    where lb.emp_id = p_emp_id and lb.financial_year = current_fy()
    order by lb.leave_type;
end;$function$
;

CREATE OR REPLACE FUNCTION public.employee_get_attendance(p_token uuid, p_emp_id uuid)
 RETURNS SETOF attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from attendance where emp_id = p_emp_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_get_leave_balances(p_token uuid, p_emp_id uuid)
 RETURNS SETOF leave_balances
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from leave_balances where emp_id = p_emp_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_get_leaves(p_token uuid, p_emp_id uuid)
 RETURNS SETOF leave_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from leave_applications where emp_id = p_emp_id order by date desc;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_get_my_team(p_token uuid, p_emp_id uuid)
 RETURNS SETOF employees
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from employees where manager_emp_id = p_emp_id and active = true order by name;
end;$function$
;

CREATE OR REPLACE FUNCTION public.employee_get_od_logs(p_token uuid, p_emp_id uuid, p_date date)
 RETURNS SETOF od_tracking_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  return query select * from od_tracking_logs where emp_id = p_emp_id and date = p_date order by ts;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_get_regularizations(p_token uuid, p_emp_id uuid)
 RETURNS SETOF regularization_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  return query select * from regularization_requests where emp_id=p_emp_id order by date desc;
end;$function$
;

CREATE OR REPLACE FUNCTION public.employee_log_location(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text DEFAULT 'auto'::text)
 RETURNS location_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row location_logs;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  insert into location_logs(emp_id, date, lat_lon, type) values(p_emp_id, p_date, p_lat_lon, p_type) returning * into v_row;
  return v_row;
end;$function$
;

CREATE OR REPLACE FUNCTION public.employee_log_od_location(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date)
 RETURNS od_tracking_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row od_tracking_logs;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  insert into od_tracking_logs (emp_id, date, lat_lon) values (p_emp_id, p_date, p_lat_lon) returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_login(p_employee_id uuid, p_pin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_pin text; v_active boolean; v_attempts int; v_locked_until timestamptz; v_token uuid;
begin
  select pin, active, failed_pin_attempts, locked_until
    into v_pin, v_active, v_attempts, v_locked_until
    from employees where id = p_employee_id;

  if v_pin is null or not v_active then
    return jsonb_build_object('token', null, 'error', 'not_found');
  end if;

  if v_locked_until is not null and v_locked_until > now() then
    return jsonb_build_object('token', null, 'error', 'locked', 'locked_until', v_locked_until);
  end if;

  if v_pin <> p_pin then
    update employees set
      failed_pin_attempts = failed_pin_attempts + 1,
      locked_until = case when failed_pin_attempts + 1 >= 5 then now() + interval '15 minutes' else locked_until end
      where id = p_employee_id;
    return jsonb_build_object('token', null, 'error', 'wrong_pin');
  end if;

  update employees set failed_pin_attempts = 0, locked_until = null where id = p_employee_id;
  insert into employee_sessions (emp_id) values (p_employee_id) returning token into v_token;
  return jsonb_build_object('token', v_token, 'error', null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_logout(p_token uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (delete from employee_sessions where token = p_token returning 1)
  select true;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_punch(p_token uuid, p_emp_id uuid, p_data jsonb)
 RETURNS attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row attendance;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid or expired session'; end if;
  insert into attendance (
    emp_id, date, in_time, out_time, in_location, out_location, leave_type, leave_reason,
    wfh, on_duty, status, late_hrs, early_hrs, bio_wrk_hrs, bio_ot, shift, shift_start,
    in_temp, out_temp, remark, card_no, designation, bio_status_raw, bio_source, monthly_source,
    week_off, source
  )
  values (
    p_emp_id, (p_data->>'date')::date, nullif(p_data->>'in_time','')::time, nullif(p_data->>'out_time','')::time,
    p_data->>'in_location', p_data->>'out_location', p_data->>'leave_type', p_data->>'leave_reason',
    coalesce((p_data->>'wfh')::boolean,false), coalesce((p_data->>'on_duty')::boolean,false), p_data->>'status',
    p_data->>'late_hrs', p_data->>'early_hrs', p_data->>'bio_wrk_hrs', p_data->>'bio_ot',
    p_data->>'shift', p_data->>'shift_start', p_data->>'in_temp', p_data->>'out_temp',
    p_data->>'remark', p_data->>'card_no', p_data->>'designation', p_data->>'bio_status_raw',
    p_data->>'bio_source', p_data->>'monthly_source', coalesce((p_data->>'week_off')::boolean,false),
    p_data->>'source'
  )
  on conflict (emp_id, date) do update set
    in_time=excluded.in_time, out_time=excluded.out_time, in_location=excluded.in_location, out_location=excluded.out_location,
    leave_type=excluded.leave_type, leave_reason=excluded.leave_reason, wfh=excluded.wfh, on_duty=excluded.on_duty, status=excluded.status,
    late_hrs=excluded.late_hrs, early_hrs=excluded.early_hrs, bio_wrk_hrs=excluded.bio_wrk_hrs, bio_ot=excluded.bio_ot,
    shift=excluded.shift, shift_start=excluded.shift_start, in_temp=excluded.in_temp, out_temp=excluded.out_temp,
    remark=excluded.remark, card_no=excluded.card_no, designation=excluded.designation, bio_status_raw=excluded.bio_status_raw,
    bio_source=excluded.bio_source, monthly_source=excluded.monthly_source, week_off=excluded.week_off, source=excluded.source,
    updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.employee_submit_regularization(p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone, p_out time without time zone, p_reason text)
 RETURNS regularization_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row regularization_requests;
begin
  if not is_valid_employee_token(p_token, p_emp_id) then raise exception 'Invalid session'; end if;
  insert into regularization_requests(emp_id,date,requested_in,requested_out,reason)
  values(p_emp_id,p_date,p_in,p_out,p_reason) returning * into v_row;
  return v_row;
end;$function$
;

CREATE OR REPLACE FUNCTION public.fetch_directory()
 RETURNS TABLE(id uuid, name text, company text, emp_num text, job_title text, bu text, dept text, sub_dept text, location_info text, cost_center text, manager text, email text, phone text, joining_date date, active boolean, shift_type text, manager_emp_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query select e.id, e.name, e.company, e.emp_num, e.job_title,
    e.bu, e.dept, e.sub_dept, e.location_info, e.cost_center,
    e.manager, e.email, e.phone, e.joining_date, e.active,
    e.shift_type, e.manager_emp_id
  from employees e where e.active=true order by e.name;
end;$function$
;

CREATE OR REPLACE FUNCTION public.is_valid_admin_token(p_token uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from admin_sessions
    where token = p_token and expires_at > now()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.is_valid_employee_token(p_token uuid, p_emp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from employee_sessions where token = p_token and emp_id = p_emp_id and expires_at > now());
$function$
;

CREATE OR REPLACE FUNCTION public.manager_decide_leave(p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text)
 RETURNS leave_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row leave_applications; v_emp employees;
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  -- Verify the leave belongs to a direct report
  select la.* into v_row from leave_applications la
    join employees e on e.id = la.emp_id
    where la.id = p_leave_id and e.manager_emp_id = p_manager_id;
  if not found then raise exception 'Not authorized to action this request'; end if;
  update leave_applications set status = p_status, updated_at = now() where id = p_leave_id returning * into v_row;
  return v_row;
end;$function$
;

CREATE OR REPLACE FUNCTION public.manager_decide_regularization(p_token uuid, p_manager_id uuid, p_reg_id uuid, p_status text)
 RETURNS regularization_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_row regularization_requests;
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  select r.* into v_row from regularization_requests r
    join employees e on e.id = r.emp_id
    where r.id = p_reg_id and e.manager_emp_id = p_manager_id;
  if not found then raise exception 'Not authorized to action this request'; end if;
  update regularization_requests set status = p_status, updated_at = now() where id = p_reg_id returning * into v_row;
  if p_status = 'Approved' then
    insert into attendance(emp_id, date, in_time, out_time, status, source)
    values(v_row.emp_id, v_row.date, v_row.requested_in, v_row.requested_out,
      case when v_row.requested_in is not null then 'Present' else 'Absent' end, 'regularization')
    on conflict(emp_id, date) do update set
      in_time = excluded.in_time, out_time = excluded.out_time,
      source = 'regularization', updated_at = now();
  end if;
  return v_row;
end;$function$
;

CREATE OR REPLACE FUNCTION public.manager_get_team_attendance(p_token uuid, p_manager_id uuid, p_month integer, p_year integer)
 RETURNS SETOF attendance
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select a.* from attendance a
    join employees e on e.id = a.emp_id
    where e.manager_emp_id = p_manager_id
    and extract(month from a.date) = p_month
    and extract(year from a.date) = p_year
    order by a.date, e.name;
end;$function$
;

CREATE OR REPLACE FUNCTION public.manager_get_team_leaves(p_token uuid, p_manager_id uuid)
 RETURNS SETOF leave_applications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select la.* from leave_applications la
    join employees e on e.id = la.emp_id
    where e.manager_emp_id = p_manager_id
    order by la.created_at desc;
end;$function$
;

CREATE OR REPLACE FUNCTION public.manager_get_team_regularizations(p_token uuid, p_manager_id uuid)
 RETURNS SETOF regularization_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not is_valid_employee_token(p_token, p_manager_id) then raise exception 'Invalid session'; end if;
  return query
    select r.* from regularization_requests r
    join employees e on e.id = r.emp_id
    where e.manager_emp_id = p_manager_id
    order by r.created_at desc;
end;$function$
;

-- ============ TRIGGERS ============

-- ============ ROW LEVEL SECURITY ============
alter table "public"."admin_sessions" enable row level security;
alter table "public"."app_settings" enable row level security;
alter table "public"."attendance" enable row level security;
alter table "public"."audit_logs" enable row level security;
alter table "public"."bio_sheet_cache" enable row level security;
alter table "public"."employee_sessions" enable row level security;
alter table "public"."employees" enable row level security;
alter table "public"."holidays" enable row level security;
alter table "public"."imported_sheet_cache" enable row level security;
alter table "public"."leave_applications" enable row level security;
alter table "public"."leave_balances" enable row level security;
alter table "public"."location_logs" enable row level security;
alter table "public"."monthly_sheet_cache" enable row level security;
alter table "public"."od_tracking_logs" enable row level security;
alter table "public"."regularization_requests" enable row level security;
create policy "anon can insert audit logs" on "public"."audit_logs" as PERMISSIVE for INSERT to anon with check (true);
create policy "anon can read holidays" on "public"."holidays" as PERMISSIVE for SELECT to anon using (true);

-- ============ GRANTS ============
-- Without these the app 404s on every RPC call.
grant INSERT on "public"."admin_sessions" to "anon";
grant TRIGGER on "public"."admin_sessions" to "anon";
grant REFERENCES on "public"."admin_sessions" to "anon";
grant TRUNCATE on "public"."admin_sessions" to "anon";
grant DELETE on "public"."admin_sessions" to "anon";
grant UPDATE on "public"."admin_sessions" to "anon";
grant SELECT on "public"."admin_sessions" to "anon";
grant SELECT on "public"."admin_sessions" to "authenticated";
grant UPDATE on "public"."admin_sessions" to "authenticated";
grant DELETE on "public"."admin_sessions" to "authenticated";
grant TRUNCATE on "public"."admin_sessions" to "authenticated";
grant TRIGGER on "public"."admin_sessions" to "authenticated";
grant REFERENCES on "public"."admin_sessions" to "authenticated";
grant INSERT on "public"."admin_sessions" to "authenticated";
grant INSERT on "public"."admin_sessions" to "service_role";
grant SELECT on "public"."admin_sessions" to "service_role";
grant UPDATE on "public"."admin_sessions" to "service_role";
grant DELETE on "public"."admin_sessions" to "service_role";
grant TRUNCATE on "public"."admin_sessions" to "service_role";
grant REFERENCES on "public"."admin_sessions" to "service_role";
grant TRIGGER on "public"."admin_sessions" to "service_role";
grant INSERT on "public"."app_settings" to "anon";
grant SELECT on "public"."app_settings" to "anon";
grant UPDATE on "public"."app_settings" to "anon";
grant DELETE on "public"."app_settings" to "anon";
grant TRUNCATE on "public"."app_settings" to "anon";
grant REFERENCES on "public"."app_settings" to "anon";
grant TRIGGER on "public"."app_settings" to "anon";
grant REFERENCES on "public"."app_settings" to "authenticated";
grant INSERT on "public"."app_settings" to "authenticated";
grant SELECT on "public"."app_settings" to "authenticated";
grant UPDATE on "public"."app_settings" to "authenticated";
grant DELETE on "public"."app_settings" to "authenticated";
grant TRUNCATE on "public"."app_settings" to "authenticated";
grant TRIGGER on "public"."app_settings" to "authenticated";
grant INSERT on "public"."app_settings" to "service_role";
grant SELECT on "public"."app_settings" to "service_role";
grant UPDATE on "public"."app_settings" to "service_role";
grant DELETE on "public"."app_settings" to "service_role";
grant TRUNCATE on "public"."app_settings" to "service_role";
grant REFERENCES on "public"."app_settings" to "service_role";
grant TRIGGER on "public"."app_settings" to "service_role";
grant INSERT on "public"."app_settings_public" to "anon";
grant SELECT on "public"."app_settings_public" to "anon";
grant UPDATE on "public"."app_settings_public" to "anon";
grant DELETE on "public"."app_settings_public" to "anon";
grant TRUNCATE on "public"."app_settings_public" to "anon";
grant REFERENCES on "public"."app_settings_public" to "anon";
grant TRIGGER on "public"."app_settings_public" to "anon";
grant TRIGGER on "public"."app_settings_public" to "authenticated";
grant INSERT on "public"."app_settings_public" to "authenticated";
grant SELECT on "public"."app_settings_public" to "authenticated";
grant UPDATE on "public"."app_settings_public" to "authenticated";
grant DELETE on "public"."app_settings_public" to "authenticated";
grant TRUNCATE on "public"."app_settings_public" to "authenticated";
grant REFERENCES on "public"."app_settings_public" to "authenticated";
grant SELECT on "public"."app_settings_public" to "service_role";
grant REFERENCES on "public"."app_settings_public" to "service_role";
grant TRUNCATE on "public"."app_settings_public" to "service_role";
grant DELETE on "public"."app_settings_public" to "service_role";
grant UPDATE on "public"."app_settings_public" to "service_role";
grant INSERT on "public"."app_settings_public" to "service_role";
grant TRIGGER on "public"."app_settings_public" to "service_role";
grant REFERENCES on "public"."attendance" to "anon";
grant TRUNCATE on "public"."attendance" to "anon";
grant DELETE on "public"."attendance" to "anon";
grant TRIGGER on "public"."attendance" to "anon";
grant TRUNCATE on "public"."attendance" to "authenticated";
grant TRIGGER on "public"."attendance" to "authenticated";
grant REFERENCES on "public"."attendance" to "authenticated";
grant DELETE on "public"."attendance" to "authenticated";
grant UPDATE on "public"."attendance" to "authenticated";
grant SELECT on "public"."attendance" to "authenticated";
grant INSERT on "public"."attendance" to "authenticated";
grant INSERT on "public"."attendance" to "service_role";
grant TRIGGER on "public"."attendance" to "service_role";
grant REFERENCES on "public"."attendance" to "service_role";
grant TRUNCATE on "public"."attendance" to "service_role";
grant DELETE on "public"."attendance" to "service_role";
grant UPDATE on "public"."attendance" to "service_role";
grant SELECT on "public"."attendance" to "service_role";
grant SELECT on "public"."audit_logs" to "anon";
grant TRIGGER on "public"."audit_logs" to "anon";
grant REFERENCES on "public"."audit_logs" to "anon";
grant TRUNCATE on "public"."audit_logs" to "anon";
grant DELETE on "public"."audit_logs" to "anon";
grant UPDATE on "public"."audit_logs" to "anon";
grant INSERT on "public"."audit_logs" to "anon";
grant INSERT on "public"."audit_logs" to "authenticated";
grant TRIGGER on "public"."audit_logs" to "authenticated";
grant REFERENCES on "public"."audit_logs" to "authenticated";
grant TRUNCATE on "public"."audit_logs" to "authenticated";
grant DELETE on "public"."audit_logs" to "authenticated";
grant UPDATE on "public"."audit_logs" to "authenticated";
grant SELECT on "public"."audit_logs" to "authenticated";
grant TRIGGER on "public"."audit_logs" to "service_role";
grant INSERT on "public"."audit_logs" to "service_role";
grant SELECT on "public"."audit_logs" to "service_role";
grant UPDATE on "public"."audit_logs" to "service_role";
grant DELETE on "public"."audit_logs" to "service_role";
grant TRUNCATE on "public"."audit_logs" to "service_role";
grant REFERENCES on "public"."audit_logs" to "service_role";
grant TRIGGER on "public"."bio_sheet_cache" to "anon";
grant REFERENCES on "public"."bio_sheet_cache" to "anon";
grant TRUNCATE on "public"."bio_sheet_cache" to "anon";
grant DELETE on "public"."bio_sheet_cache" to "anon";
grant UPDATE on "public"."bio_sheet_cache" to "anon";
grant SELECT on "public"."bio_sheet_cache" to "anon";
grant INSERT on "public"."bio_sheet_cache" to "anon";
grant UPDATE on "public"."bio_sheet_cache" to "authenticated";
grant INSERT on "public"."bio_sheet_cache" to "authenticated";
grant SELECT on "public"."bio_sheet_cache" to "authenticated";
grant DELETE on "public"."bio_sheet_cache" to "authenticated";
grant TRUNCATE on "public"."bio_sheet_cache" to "authenticated";
grant REFERENCES on "public"."bio_sheet_cache" to "authenticated";
grant TRIGGER on "public"."bio_sheet_cache" to "authenticated";
grant REFERENCES on "public"."bio_sheet_cache" to "service_role";
grant TRIGGER on "public"."bio_sheet_cache" to "service_role";
grant TRUNCATE on "public"."bio_sheet_cache" to "service_role";
grant DELETE on "public"."bio_sheet_cache" to "service_role";
grant UPDATE on "public"."bio_sheet_cache" to "service_role";
grant SELECT on "public"."bio_sheet_cache" to "service_role";
grant INSERT on "public"."bio_sheet_cache" to "service_role";
grant SELECT on "public"."employee_sessions" to "anon";
grant INSERT on "public"."employee_sessions" to "anon";
grant TRIGGER on "public"."employee_sessions" to "anon";
grant REFERENCES on "public"."employee_sessions" to "anon";
grant TRUNCATE on "public"."employee_sessions" to "anon";
grant DELETE on "public"."employee_sessions" to "anon";
grant UPDATE on "public"."employee_sessions" to "anon";
grant INSERT on "public"."employee_sessions" to "authenticated";
grant TRIGGER on "public"."employee_sessions" to "authenticated";
grant REFERENCES on "public"."employee_sessions" to "authenticated";
grant TRUNCATE on "public"."employee_sessions" to "authenticated";
grant DELETE on "public"."employee_sessions" to "authenticated";
grant UPDATE on "public"."employee_sessions" to "authenticated";
grant SELECT on "public"."employee_sessions" to "authenticated";
grant SELECT on "public"."employee_sessions" to "service_role";
grant INSERT on "public"."employee_sessions" to "service_role";
grant UPDATE on "public"."employee_sessions" to "service_role";
grant DELETE on "public"."employee_sessions" to "service_role";
grant TRUNCATE on "public"."employee_sessions" to "service_role";
grant REFERENCES on "public"."employee_sessions" to "service_role";
grant TRIGGER on "public"."employee_sessions" to "service_role";
grant INSERT on "public"."employees" to "anon";
grant SELECT on "public"."employees" to "anon";
grant UPDATE on "public"."employees" to "anon";
grant DELETE on "public"."employees" to "anon";
grant TRUNCATE on "public"."employees" to "anon";
grant REFERENCES on "public"."employees" to "anon";
grant TRIGGER on "public"."employees" to "anon";
grant INSERT on "public"."employees" to "authenticated";
grant SELECT on "public"."employees" to "authenticated";
grant UPDATE on "public"."employees" to "authenticated";
grant DELETE on "public"."employees" to "authenticated";
grant TRUNCATE on "public"."employees" to "authenticated";
grant REFERENCES on "public"."employees" to "authenticated";
grant TRIGGER on "public"."employees" to "authenticated";
grant DELETE on "public"."employees" to "service_role";
grant TRIGGER on "public"."employees" to "service_role";
grant REFERENCES on "public"."employees" to "service_role";
grant TRUNCATE on "public"."employees" to "service_role";
grant UPDATE on "public"."employees" to "service_role";
grant SELECT on "public"."employees" to "service_role";
grant INSERT on "public"."employees" to "service_role";
grant TRIGGER on "public"."employees_directory" to "anon";
grant REFERENCES on "public"."employees_directory" to "anon";
grant TRUNCATE on "public"."employees_directory" to "anon";
grant DELETE on "public"."employees_directory" to "anon";
grant UPDATE on "public"."employees_directory" to "anon";
grant SELECT on "public"."employees_directory" to "anon";
grant INSERT on "public"."employees_directory" to "anon";
grant INSERT on "public"."employees_directory" to "authenticated";
grant SELECT on "public"."employees_directory" to "authenticated";
grant UPDATE on "public"."employees_directory" to "authenticated";
grant DELETE on "public"."employees_directory" to "authenticated";
grant TRUNCATE on "public"."employees_directory" to "authenticated";
grant REFERENCES on "public"."employees_directory" to "authenticated";
grant TRIGGER on "public"."employees_directory" to "authenticated";
grant TRIGGER on "public"."employees_directory" to "service_role";
grant REFERENCES on "public"."employees_directory" to "service_role";
grant TRUNCATE on "public"."employees_directory" to "service_role";
grant DELETE on "public"."employees_directory" to "service_role";
grant UPDATE on "public"."employees_directory" to "service_role";
grant SELECT on "public"."employees_directory" to "service_role";
grant INSERT on "public"."employees_directory" to "service_role";
grant SELECT on "public"."holidays" to "anon";
grant INSERT on "public"."holidays" to "anon";
grant UPDATE on "public"."holidays" to "anon";
grant DELETE on "public"."holidays" to "anon";
grant TRUNCATE on "public"."holidays" to "anon";
grant REFERENCES on "public"."holidays" to "anon";
grant TRIGGER on "public"."holidays" to "anon";
grant SELECT on "public"."holidays" to "authenticated";
grant INSERT on "public"."holidays" to "authenticated";
grant UPDATE on "public"."holidays" to "authenticated";
grant DELETE on "public"."holidays" to "authenticated";
grant TRUNCATE on "public"."holidays" to "authenticated";
grant REFERENCES on "public"."holidays" to "authenticated";
grant TRIGGER on "public"."holidays" to "authenticated";
grant INSERT on "public"."holidays" to "service_role";
grant SELECT on "public"."holidays" to "service_role";
grant UPDATE on "public"."holidays" to "service_role";
grant DELETE on "public"."holidays" to "service_role";
grant TRUNCATE on "public"."holidays" to "service_role";
grant REFERENCES on "public"."holidays" to "service_role";
grant TRIGGER on "public"."holidays" to "service_role";
grant DELETE on "public"."imported_sheet_cache" to "anon";
grant SELECT on "public"."imported_sheet_cache" to "anon";
grant UPDATE on "public"."imported_sheet_cache" to "anon";
grant TRUNCATE on "public"."imported_sheet_cache" to "anon";
grant REFERENCES on "public"."imported_sheet_cache" to "anon";
grant TRIGGER on "public"."imported_sheet_cache" to "anon";
grant INSERT on "public"."imported_sheet_cache" to "anon";
grant INSERT on "public"."imported_sheet_cache" to "authenticated";
grant SELECT on "public"."imported_sheet_cache" to "authenticated";
grant UPDATE on "public"."imported_sheet_cache" to "authenticated";
grant TRIGGER on "public"."imported_sheet_cache" to "authenticated";
grant DELETE on "public"."imported_sheet_cache" to "authenticated";
grant REFERENCES on "public"."imported_sheet_cache" to "authenticated";
grant TRUNCATE on "public"."imported_sheet_cache" to "authenticated";
grant INSERT on "public"."imported_sheet_cache" to "service_role";
grant TRIGGER on "public"."imported_sheet_cache" to "service_role";
grant REFERENCES on "public"."imported_sheet_cache" to "service_role";
grant TRUNCATE on "public"."imported_sheet_cache" to "service_role";
grant DELETE on "public"."imported_sheet_cache" to "service_role";
grant UPDATE on "public"."imported_sheet_cache" to "service_role";
grant SELECT on "public"."imported_sheet_cache" to "service_role";
grant UPDATE on "public"."leave_applications" to "anon";
grant TRIGGER on "public"."leave_applications" to "anon";
grant REFERENCES on "public"."leave_applications" to "anon";
grant TRUNCATE on "public"."leave_applications" to "anon";
grant DELETE on "public"."leave_applications" to "anon";
grant TRIGGER on "public"."leave_applications" to "authenticated";
grant INSERT on "public"."leave_applications" to "authenticated";
grant SELECT on "public"."leave_applications" to "authenticated";
grant UPDATE on "public"."leave_applications" to "authenticated";
grant DELETE on "public"."leave_applications" to "authenticated";
grant TRUNCATE on "public"."leave_applications" to "authenticated";
grant REFERENCES on "public"."leave_applications" to "authenticated";
grant INSERT on "public"."leave_applications" to "service_role";
grant SELECT on "public"."leave_applications" to "service_role";
grant UPDATE on "public"."leave_applications" to "service_role";
grant TRIGGER on "public"."leave_applications" to "service_role";
grant DELETE on "public"."leave_applications" to "service_role";
grant TRUNCATE on "public"."leave_applications" to "service_role";
grant REFERENCES on "public"."leave_applications" to "service_role";
grant REFERENCES on "public"."leave_balances" to "anon";
grant TRIGGER on "public"."leave_balances" to "anon";
grant TRUNCATE on "public"."leave_balances" to "anon";
grant DELETE on "public"."leave_balances" to "anon";
grant UPDATE on "public"."leave_balances" to "anon";
grant INSERT on "public"."leave_balances" to "anon";
grant DELETE on "public"."leave_balances" to "authenticated";
grant UPDATE on "public"."leave_balances" to "authenticated";
grant SELECT on "public"."leave_balances" to "authenticated";
grant INSERT on "public"."leave_balances" to "authenticated";
grant TRIGGER on "public"."leave_balances" to "authenticated";
grant REFERENCES on "public"."leave_balances" to "authenticated";
grant TRUNCATE on "public"."leave_balances" to "authenticated";
grant SELECT on "public"."leave_balances" to "service_role";
grant REFERENCES on "public"."leave_balances" to "service_role";
grant TRUNCATE on "public"."leave_balances" to "service_role";
grant INSERT on "public"."leave_balances" to "service_role";
grant TRIGGER on "public"."leave_balances" to "service_role";
grant DELETE on "public"."leave_balances" to "service_role";
grant UPDATE on "public"."leave_balances" to "service_role";
grant DELETE on "public"."location_logs" to "anon";
grant REFERENCES on "public"."location_logs" to "anon";
grant TRIGGER on "public"."location_logs" to "anon";
grant INSERT on "public"."location_logs" to "anon";
grant SELECT on "public"."location_logs" to "anon";
grant UPDATE on "public"."location_logs" to "anon";
grant TRUNCATE on "public"."location_logs" to "anon";
grant DELETE on "public"."location_logs" to "authenticated";
grant REFERENCES on "public"."location_logs" to "authenticated";
grant TRIGGER on "public"."location_logs" to "authenticated";
grant INSERT on "public"."location_logs" to "authenticated";
grant SELECT on "public"."location_logs" to "authenticated";
grant UPDATE on "public"."location_logs" to "authenticated";
grant TRUNCATE on "public"."location_logs" to "authenticated";
grant INSERT on "public"."location_logs" to "service_role";
grant UPDATE on "public"."location_logs" to "service_role";
grant DELETE on "public"."location_logs" to "service_role";
grant TRIGGER on "public"."location_logs" to "service_role";
grant REFERENCES on "public"."location_logs" to "service_role";
grant TRUNCATE on "public"."location_logs" to "service_role";
grant SELECT on "public"."location_logs" to "service_role";
grant REFERENCES on "public"."monthly_sheet_cache" to "anon";
grant INSERT on "public"."monthly_sheet_cache" to "anon";
grant SELECT on "public"."monthly_sheet_cache" to "anon";
grant UPDATE on "public"."monthly_sheet_cache" to "anon";
grant DELETE on "public"."monthly_sheet_cache" to "anon";
grant TRUNCATE on "public"."monthly_sheet_cache" to "anon";
grant TRIGGER on "public"."monthly_sheet_cache" to "anon";
grant INSERT on "public"."monthly_sheet_cache" to "authenticated";
grant TRIGGER on "public"."monthly_sheet_cache" to "authenticated";
grant REFERENCES on "public"."monthly_sheet_cache" to "authenticated";
grant TRUNCATE on "public"."monthly_sheet_cache" to "authenticated";
grant DELETE on "public"."monthly_sheet_cache" to "authenticated";
grant UPDATE on "public"."monthly_sheet_cache" to "authenticated";
grant SELECT on "public"."monthly_sheet_cache" to "authenticated";
grant INSERT on "public"."monthly_sheet_cache" to "service_role";
grant SELECT on "public"."monthly_sheet_cache" to "service_role";
grant UPDATE on "public"."monthly_sheet_cache" to "service_role";
grant DELETE on "public"."monthly_sheet_cache" to "service_role";
grant TRUNCATE on "public"."monthly_sheet_cache" to "service_role";
grant REFERENCES on "public"."monthly_sheet_cache" to "service_role";
grant TRIGGER on "public"."monthly_sheet_cache" to "service_role";
grant REFERENCES on "public"."od_tracking_logs" to "anon";
grant INSERT on "public"."od_tracking_logs" to "anon";
grant SELECT on "public"."od_tracking_logs" to "anon";
grant UPDATE on "public"."od_tracking_logs" to "anon";
grant DELETE on "public"."od_tracking_logs" to "anon";
grant TRUNCATE on "public"."od_tracking_logs" to "anon";
grant TRIGGER on "public"."od_tracking_logs" to "anon";
grant TRIGGER on "public"."od_tracking_logs" to "authenticated";
grant REFERENCES on "public"."od_tracking_logs" to "authenticated";
grant TRUNCATE on "public"."od_tracking_logs" to "authenticated";
grant DELETE on "public"."od_tracking_logs" to "authenticated";
grant UPDATE on "public"."od_tracking_logs" to "authenticated";
grant SELECT on "public"."od_tracking_logs" to "authenticated";
grant INSERT on "public"."od_tracking_logs" to "authenticated";
grant TRIGGER on "public"."od_tracking_logs" to "service_role";
grant INSERT on "public"."od_tracking_logs" to "service_role";
grant SELECT on "public"."od_tracking_logs" to "service_role";
grant UPDATE on "public"."od_tracking_logs" to "service_role";
grant DELETE on "public"."od_tracking_logs" to "service_role";
grant TRUNCATE on "public"."od_tracking_logs" to "service_role";
grant REFERENCES on "public"."od_tracking_logs" to "service_role";
grant TRIGGER on "public"."regularization_requests" to "anon";
grant REFERENCES on "public"."regularization_requests" to "anon";
grant TRUNCATE on "public"."regularization_requests" to "anon";
grant DELETE on "public"."regularization_requests" to "anon";
grant UPDATE on "public"."regularization_requests" to "anon";
grant INSERT on "public"."regularization_requests" to "anon";
grant SELECT on "public"."regularization_requests" to "anon";
grant REFERENCES on "public"."regularization_requests" to "authenticated";
grant INSERT on "public"."regularization_requests" to "authenticated";
grant SELECT on "public"."regularization_requests" to "authenticated";
grant UPDATE on "public"."regularization_requests" to "authenticated";
grant DELETE on "public"."regularization_requests" to "authenticated";
grant TRUNCATE on "public"."regularization_requests" to "authenticated";
grant TRIGGER on "public"."regularization_requests" to "authenticated";
grant REFERENCES on "public"."regularization_requests" to "service_role";
grant INSERT on "public"."regularization_requests" to "service_role";
grant SELECT on "public"."regularization_requests" to "service_role";
grant UPDATE on "public"."regularization_requests" to "service_role";
grant DELETE on "public"."regularization_requests" to "service_role";
grant TRUNCATE on "public"."regularization_requests" to "service_role";
grant TRIGGER on "public"."regularization_requests" to "service_role";
grant EXECUTE on function "public"."admin_add_holiday"(p_token uuid, p_date date, p_name text, p_type text) to "anon";
grant EXECUTE on function "public"."admin_add_holiday"(p_token uuid, p_date date, p_name text, p_type text) to "authenticated";
grant EXECUTE on function "public"."admin_add_holiday"(p_token uuid, p_date date, p_name text, p_type text) to "service_role";
grant EXECUTE on function "public"."admin_bulk_upsert_attendance"(p_token uuid, p_records jsonb) to "anon";
grant EXECUTE on function "public"."admin_bulk_upsert_attendance"(p_token uuid, p_records jsonb) to "authenticated";
grant EXECUTE on function "public"."admin_bulk_upsert_attendance"(p_token uuid, p_records jsonb) to "service_role";
grant EXECUTE on function "public"."admin_bulk_upsert_leave_balances"(p_token uuid, p_records jsonb) to "anon";
grant EXECUTE on function "public"."admin_bulk_upsert_leave_balances"(p_token uuid, p_records jsonb) to "authenticated";
grant EXECUTE on function "public"."admin_bulk_upsert_leave_balances"(p_token uuid, p_records jsonb) to "service_role";
grant EXECUTE on function "public"."admin_clear_bio_sheet"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_clear_bio_sheet"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_clear_bio_sheet"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_clear_imported_sheet"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_clear_imported_sheet"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_clear_imported_sheet"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_clear_monthly_sheet"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_clear_monthly_sheet"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_clear_monthly_sheet"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_create_employee"(p_token uuid, p_data jsonb) to "anon";
grant EXECUTE on function "public"."admin_create_employee"(p_token uuid, p_data jsonb) to "authenticated";
grant EXECUTE on function "public"."admin_create_employee"(p_token uuid, p_data jsonb) to "service_role";
grant EXECUTE on function "public"."admin_decide_leave"(p_token uuid, p_leave_id uuid, p_decision text) to "anon";
grant EXECUTE on function "public"."admin_decide_leave"(p_token uuid, p_leave_id uuid, p_decision text) to "authenticated";
grant EXECUTE on function "public"."admin_decide_leave"(p_token uuid, p_leave_id uuid, p_decision text) to "service_role";
grant EXECUTE on function "public"."admin_decide_regularization"(p_token uuid, p_id uuid, p_status text) to "anon";
grant EXECUTE on function "public"."admin_decide_regularization"(p_token uuid, p_id uuid, p_status text) to "authenticated";
grant EXECUTE on function "public"."admin_decide_regularization"(p_token uuid, p_id uuid, p_status text) to "service_role";
grant EXECUTE on function "public"."admin_delete_employee"(p_token uuid, p_id uuid) to "anon";
grant EXECUTE on function "public"."admin_delete_employee"(p_token uuid, p_id uuid) to "authenticated";
grant EXECUTE on function "public"."admin_delete_employee"(p_token uuid, p_id uuid) to "service_role";
grant EXECUTE on function "public"."admin_delete_holiday"(p_token uuid, p_id uuid) to "anon";
grant EXECUTE on function "public"."admin_delete_holiday"(p_token uuid, p_id uuid) to "authenticated";
grant EXECUTE on function "public"."admin_delete_holiday"(p_token uuid, p_id uuid) to "service_role";
grant EXECUTE on function "public"."admin_fetch_all_leave_balances"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_fetch_all_leave_balances"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_fetch_all_leave_balances"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_all_attendance"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_all_attendance"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_all_attendance"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_all_leave_balances"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_all_leave_balances"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_all_leave_balances"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_all_leaves"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_all_leaves"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_all_leaves"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_all_location_logs"(p_token uuid, p_date date) to "anon";
grant EXECUTE on function "public"."admin_get_all_location_logs"(p_token uuid, p_date date) to "authenticated";
grant EXECUTE on function "public"."admin_get_all_location_logs"(p_token uuid, p_date date) to "service_role";
grant EXECUTE on function "public"."admin_get_audit_logs"(p_token uuid, p_limit integer) to "anon";
grant EXECUTE on function "public"."admin_get_audit_logs"(p_token uuid, p_limit integer) to "authenticated";
grant EXECUTE on function "public"."admin_get_audit_logs"(p_token uuid, p_limit integer) to "service_role";
grant EXECUTE on function "public"."admin_get_bio_sheet"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_bio_sheet"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_bio_sheet"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_employees"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_employees"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_employees"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_holidays"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_holidays"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_holidays"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_imported_sheet"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_imported_sheet"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_imported_sheet"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_location_logs"(p_token uuid, p_emp_id uuid, p_date date) to "anon";
grant EXECUTE on function "public"."admin_get_location_logs"(p_token uuid, p_emp_id uuid, p_date date) to "authenticated";
grant EXECUTE on function "public"."admin_get_location_logs"(p_token uuid, p_emp_id uuid, p_date date) to "service_role";
grant EXECUTE on function "public"."admin_get_monthly_sheet"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_monthly_sheet"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_monthly_sheet"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_get_od_logs"(p_token uuid, p_emp_id uuid, p_date date) to "anon";
grant EXECUTE on function "public"."admin_get_od_logs"(p_token uuid, p_emp_id uuid, p_date date) to "authenticated";
grant EXECUTE on function "public"."admin_get_od_logs"(p_token uuid, p_emp_id uuid, p_date date) to "service_role";
grant EXECUTE on function "public"."admin_get_regularizations"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_get_regularizations"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_get_regularizations"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_login"(p_pin text) to "anon";
grant EXECUTE on function "public"."admin_login"(p_pin text) to "authenticated";
grant EXECUTE on function "public"."admin_login"(p_pin text) to "service_role";
grant EXECUTE on function "public"."admin_logout"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_logout"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_logout"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_reset_leave_balances"(p_token uuid) to "anon";
grant EXECUTE on function "public"."admin_reset_leave_balances"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."admin_reset_leave_balances"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."admin_set_bio_sheet"(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb, p_report_date date, p_synced integer, p_skipped integer) to "anon";
grant EXECUTE on function "public"."admin_set_bio_sheet"(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb, p_report_date date, p_synced integer, p_skipped integer) to "authenticated";
grant EXECUTE on function "public"."admin_set_bio_sheet"(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb, p_report_date date, p_synced integer, p_skipped integer) to "service_role";
grant EXECUTE on function "public"."admin_set_imported_sheet"(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb) to "anon";
grant EXECUTE on function "public"."admin_set_imported_sheet"(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb) to "authenticated";
grant EXECUTE on function "public"."admin_set_imported_sheet"(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb) to "service_role";
grant EXECUTE on function "public"."admin_set_monthly_sheet"(p_token uuid, p_filename text, p_report_month integer, p_report_year integer, p_synced integer, p_skipped integer) to "anon";
grant EXECUTE on function "public"."admin_set_monthly_sheet"(p_token uuid, p_filename text, p_report_month integer, p_report_year integer, p_synced integer, p_skipped integer) to "authenticated";
grant EXECUTE on function "public"."admin_set_monthly_sheet"(p_token uuid, p_filename text, p_report_month integer, p_report_year integer, p_synced integer, p_skipped integer) to "service_role";
grant EXECUTE on function "public"."admin_toggle_employee_status"(p_token uuid, p_id uuid) to "anon";
grant EXECUTE on function "public"."admin_toggle_employee_status"(p_token uuid, p_id uuid) to "authenticated";
grant EXECUTE on function "public"."admin_toggle_employee_status"(p_token uuid, p_id uuid) to "service_role";
grant EXECUTE on function "public"."admin_update_employee"(p_token uuid, p_emp_id uuid, p_data jsonb) to "anon";
grant EXECUTE on function "public"."admin_update_employee"(p_token uuid, p_emp_id uuid, p_data jsonb) to "authenticated";
grant EXECUTE on function "public"."admin_update_employee"(p_token uuid, p_emp_id uuid, p_data jsonb) to "service_role";
grant EXECUTE on function "public"."admin_update_settings"(p_token uuid, p_std_hours numeric, p_new_admin_pin text) to "anon";
grant EXECUTE on function "public"."admin_update_settings"(p_token uuid, p_std_hours numeric, p_new_admin_pin text) to "authenticated";
grant EXECUTE on function "public"."admin_update_settings"(p_token uuid, p_std_hours numeric, p_new_admin_pin text) to "service_role";
grant EXECUTE on function "public"."admin_upsert_attendance"(p_token uuid, p_emp_id uuid, p_data jsonb) to "anon";
grant EXECUTE on function "public"."admin_upsert_attendance"(p_token uuid, p_emp_id uuid, p_data jsonb) to "authenticated";
grant EXECUTE on function "public"."admin_upsert_attendance"(p_token uuid, p_emp_id uuid, p_data jsonb) to "service_role";
grant EXECUTE on function "public"."admin_upsert_leave_balance"(p_token uuid, p_emp_id uuid, p_leave_type text, p_accrued numeric, p_consumed numeric, p_balance numeric, p_quota numeric, p_unit text) to "anon";
grant EXECUTE on function "public"."admin_upsert_leave_balance"(p_token uuid, p_emp_id uuid, p_leave_type text, p_accrued numeric, p_consumed numeric, p_balance numeric, p_quota numeric, p_unit text) to "authenticated";
grant EXECUTE on function "public"."admin_upsert_leave_balance"(p_token uuid, p_emp_id uuid, p_leave_type text, p_accrued numeric, p_consumed numeric, p_balance numeric, p_quota numeric, p_unit text) to "service_role";
grant EXECUTE on function "public"."current_fy"() to "anon";
grant EXECUTE on function "public"."current_fy"() to "authenticated";
grant EXECUTE on function "public"."current_fy"() to "service_role";
grant EXECUTE on function "public"."employee_apply_leave"(p_token uuid, p_emp_id uuid, p_data jsonb) to "anon";
grant EXECUTE on function "public"."employee_apply_leave"(p_token uuid, p_emp_id uuid, p_data jsonb) to "authenticated";
grant EXECUTE on function "public"."employee_apply_leave"(p_token uuid, p_emp_id uuid, p_data jsonb) to "service_role";
grant EXECUTE on function "public"."employee_fetch_leave_balances"(p_token uuid, p_emp_id uuid) to "anon";
grant EXECUTE on function "public"."employee_fetch_leave_balances"(p_token uuid, p_emp_id uuid) to "authenticated";
grant EXECUTE on function "public"."employee_fetch_leave_balances"(p_token uuid, p_emp_id uuid) to "service_role";
grant EXECUTE on function "public"."employee_get_attendance"(p_token uuid, p_emp_id uuid) to "anon";
grant EXECUTE on function "public"."employee_get_attendance"(p_token uuid, p_emp_id uuid) to "authenticated";
grant EXECUTE on function "public"."employee_get_attendance"(p_token uuid, p_emp_id uuid) to "service_role";
grant EXECUTE on function "public"."employee_get_leave_balances"(p_token uuid, p_emp_id uuid) to "anon";
grant EXECUTE on function "public"."employee_get_leave_balances"(p_token uuid, p_emp_id uuid) to "authenticated";
grant EXECUTE on function "public"."employee_get_leave_balances"(p_token uuid, p_emp_id uuid) to "service_role";
grant EXECUTE on function "public"."employee_get_leaves"(p_token uuid, p_emp_id uuid) to "anon";
grant EXECUTE on function "public"."employee_get_leaves"(p_token uuid, p_emp_id uuid) to "authenticated";
grant EXECUTE on function "public"."employee_get_leaves"(p_token uuid, p_emp_id uuid) to "service_role";
grant EXECUTE on function "public"."employee_get_my_team"(p_token uuid, p_emp_id uuid) to "anon";
grant EXECUTE on function "public"."employee_get_my_team"(p_token uuid, p_emp_id uuid) to "authenticated";
grant EXECUTE on function "public"."employee_get_my_team"(p_token uuid, p_emp_id uuid) to "service_role";
grant EXECUTE on function "public"."employee_get_od_logs"(p_token uuid, p_emp_id uuid, p_date date) to "anon";
grant EXECUTE on function "public"."employee_get_od_logs"(p_token uuid, p_emp_id uuid, p_date date) to "authenticated";
grant EXECUTE on function "public"."employee_get_od_logs"(p_token uuid, p_emp_id uuid, p_date date) to "service_role";
grant EXECUTE on function "public"."employee_get_regularizations"(p_token uuid, p_emp_id uuid) to "anon";
grant EXECUTE on function "public"."employee_get_regularizations"(p_token uuid, p_emp_id uuid) to "authenticated";
grant EXECUTE on function "public"."employee_get_regularizations"(p_token uuid, p_emp_id uuid) to "service_role";
grant EXECUTE on function "public"."employee_log_location"(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text) to "anon";
grant EXECUTE on function "public"."employee_log_location"(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text) to "authenticated";
grant EXECUTE on function "public"."employee_log_location"(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text) to "service_role";
grant EXECUTE on function "public"."employee_log_od_location"(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date) to "anon";
grant EXECUTE on function "public"."employee_log_od_location"(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date) to "authenticated";
grant EXECUTE on function "public"."employee_log_od_location"(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date) to "service_role";
grant EXECUTE on function "public"."employee_login"(p_employee_id uuid, p_pin text) to "anon";
grant EXECUTE on function "public"."employee_login"(p_employee_id uuid, p_pin text) to "authenticated";
grant EXECUTE on function "public"."employee_login"(p_employee_id uuid, p_pin text) to "service_role";
grant EXECUTE on function "public"."employee_logout"(p_token uuid) to "anon";
grant EXECUTE on function "public"."employee_logout"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."employee_logout"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."employee_punch"(p_token uuid, p_emp_id uuid, p_data jsonb) to "anon";
grant EXECUTE on function "public"."employee_punch"(p_token uuid, p_emp_id uuid, p_data jsonb) to "authenticated";
grant EXECUTE on function "public"."employee_punch"(p_token uuid, p_emp_id uuid, p_data jsonb) to "service_role";
grant EXECUTE on function "public"."employee_submit_regularization"(p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone, p_out time without time zone, p_reason text) to "anon";
grant EXECUTE on function "public"."employee_submit_regularization"(p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone, p_out time without time zone, p_reason text) to "authenticated";
grant EXECUTE on function "public"."employee_submit_regularization"(p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone, p_out time without time zone, p_reason text) to "service_role";
grant EXECUTE on function "public"."fetch_directory"() to "anon";
grant EXECUTE on function "public"."fetch_directory"() to "authenticated";
grant EXECUTE on function "public"."fetch_directory"() to "service_role";
grant EXECUTE on function "public"."is_valid_admin_token"(p_token uuid) to "anon";
grant EXECUTE on function "public"."is_valid_admin_token"(p_token uuid) to "authenticated";
grant EXECUTE on function "public"."is_valid_admin_token"(p_token uuid) to "service_role";
grant EXECUTE on function "public"."is_valid_employee_token"(p_token uuid, p_emp_id uuid) to "anon";
grant EXECUTE on function "public"."is_valid_employee_token"(p_token uuid, p_emp_id uuid) to "authenticated";
grant EXECUTE on function "public"."is_valid_employee_token"(p_token uuid, p_emp_id uuid) to "service_role";
grant EXECUTE on function "public"."manager_decide_leave"(p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text) to "anon";
grant EXECUTE on function "public"."manager_decide_leave"(p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text) to "authenticated";
grant EXECUTE on function "public"."manager_decide_leave"(p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text) to "service_role";
grant EXECUTE on function "public"."manager_decide_regularization"(p_token uuid, p_manager_id uuid, p_reg_id uuid, p_status text) to "anon";
grant EXECUTE on function "public"."manager_decide_regularization"(p_token uuid, p_manager_id uuid, p_reg_id uuid, p_status text) to "authenticated";
grant EXECUTE on function "public"."manager_decide_regularization"(p_token uuid, p_manager_id uuid, p_reg_id uuid, p_status text) to "service_role";
grant EXECUTE on function "public"."manager_get_team_attendance"(p_token uuid, p_manager_id uuid, p_month integer, p_year integer) to "anon";
grant EXECUTE on function "public"."manager_get_team_attendance"(p_token uuid, p_manager_id uuid, p_month integer, p_year integer) to "authenticated";
grant EXECUTE on function "public"."manager_get_team_attendance"(p_token uuid, p_manager_id uuid, p_month integer, p_year integer) to "service_role";
grant EXECUTE on function "public"."manager_get_team_leaves"(p_token uuid, p_manager_id uuid) to "anon";
grant EXECUTE on function "public"."manager_get_team_leaves"(p_token uuid, p_manager_id uuid) to "authenticated";
grant EXECUTE on function "public"."manager_get_team_leaves"(p_token uuid, p_manager_id uuid) to "service_role";
grant EXECUTE on function "public"."manager_get_team_regularizations"(p_token uuid, p_manager_id uuid) to "anon";
grant EXECUTE on function "public"."manager_get_team_regularizations"(p_token uuid, p_manager_id uuid) to "authenticated";
grant EXECUTE on function "public"."manager_get_team_regularizations"(p_token uuid, p_manager_id uuid) to "service_role";
