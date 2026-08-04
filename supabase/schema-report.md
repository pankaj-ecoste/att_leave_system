# Schema report

PostgreSQL 17.6 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit

Generated 2026-08-04T06:35:56.374Z

## Totals

| Object | Count |
|---|---|
| Tables | 15 |
| Views | 2 |
| Functions | 59 |
| Triggers | 0 |
| RLS policies | 2 |
| Indexes | 27 |
| Extensions | 5 |
| Cron jobs | 0 |

## Row counts (migration verification baseline)

| Table | Rows | RLS |
|---|---:|---|
| public.admin_sessions | 153 | on |
| public.app_settings | 1 | on |
| public.attendance | 336 | on |
| public.audit_logs | 1837 | on |
| public.bio_sheet_cache | 1 | on |
| public.employee_sessions | 617 | on |
| public.employees | 131 | on |
| public.holidays | 10 | on |
| public.imported_sheet_cache | 1 | on |
| public.leave_applications | 290 | on |
| public.leave_balances | 1 | on |
| public.location_logs | 23 | on |
| public.monthly_sheet_cache | 1 | on |
| public.od_tracking_logs | 236 | on |
| public.regularization_requests | 2 | on |

## Tables

### public.admin_sessions

| Column | Type | Null | Default |
|---|---|---|---|
| token | uuid | NO | gen_random_uuid() |
| created_at | timestamptz | NO | now() |
| expires_at | timestamptz | NO | (now() + '12:00:00'::interval) |

Constraints:
- `PRIMARY KEY` admin_sessions_pkey: PRIMARY KEY (token)

### public.app_settings

| Column | Type | Null | Default |
|---|---|---|---|
| id | int2 | NO |  |
| admin_pin_hash | text | NO |  |
| std_hours | numeric | NO | 9 |
| admin_failed_attempts | int4 | NO | 0 |
| admin_locked_until | timestamptz | YES |  |

Constraints:
- `CHECK` app_settings_id_check: CHECK ((id = 1))
- `PRIMARY KEY` app_settings_pkey: PRIMARY KEY (id)

### public.attendance

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| emp_id | uuid | NO |  |
| date | date | NO |  |
| in_time | time | YES |  |
| out_time | time | YES |  |
| in_location | text | YES |  |
| out_location | text | YES |  |
| leave_type | text | YES |  |
| leave_reason | text | YES |  |
| wfh | bool | NO | false |
| on_duty | bool | NO | false |
| status | text | YES |  |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| late_hrs | text | YES |  |
| early_hrs | text | YES |  |
| bio_wrk_hrs | text | YES |  |
| bio_ot | text | YES |  |
| shift | text | YES |  |
| shift_start | text | YES |  |
| in_temp | text | YES |  |
| out_temp | text | YES |  |
| remark | text | YES |  |
| card_no | text | YES |  |
| designation | text | YES |  |
| bio_status_raw | text | YES |  |
| bio_source | text | YES |  |
| monthly_source | text | YES |  |
| week_off | bool | NO | false |
| source | text | YES |  |

Constraints:
- `FOREIGN KEY` attendance_emp_id_fkey: FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE
- `PRIMARY KEY` attendance_pkey: PRIMARY KEY (id)
- `UNIQUE` attendance_emp_id_date_key: UNIQUE (emp_id, date)

### public.audit_logs

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| ts | timestamptz | NO | now() |
| action | text | NO |  |
| detail | text | YES |  |
| by_name | text | YES |  |

Constraints:
- `PRIMARY KEY` audit_logs_pkey: PRIMARY KEY (id)

Policies:
- **anon can insert audit logs** (INSERT, roles {anon}) using: `-` check: `true`

### public.bio_sheet_cache

| Column | Type | Null | Default |
|---|---|---|---|
| id | int2 | NO |  |
| filename | text | YES |  |
| cols | jsonb | NO | '[]'::jsonb |
| rows | jsonb | NO | '[]'::jsonb |
| report_date | date | YES |  |
| synced | int4 | YES |  |
| skipped | int4 | YES |  |
| imported_at | timestamptz | YES |  |

Constraints:
- `CHECK` bio_sheet_cache_id_check: CHECK ((id = 1))
- `PRIMARY KEY` bio_sheet_cache_pkey: PRIMARY KEY (id)

### public.employee_sessions

| Column | Type | Null | Default |
|---|---|---|---|
| token | uuid | NO | gen_random_uuid() |
| emp_id | uuid | NO |  |
| created_at | timestamptz | NO | now() |
| expires_at | timestamptz | NO | (now() + '18:00:00'::interval) |

Constraints:
- `FOREIGN KEY` employee_sessions_emp_id_fkey: FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE
- `PRIMARY KEY` employee_sessions_pkey: PRIMARY KEY (token)

### public.employees

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| emp_num | text | YES |  |
| name | text | NO |  |
| pin | text | NO |  |
| company | text | NO |  |
| job_title | text | YES |  |
| business_unit | text | YES |  |
| department | text | YES |  |
| sub_department | text | YES |  |
| location_info | text | YES |  |
| cost_center | text | YES |  |
| manager | text | YES |  |
| email | text | YES |  |
| phone | text | YES |  |
| joining_date | date | YES |  |
| active | bool | NO | true |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |
| failed_pin_attempts | int4 | NO | 0 |
| locked_until | timestamptz | YES |  |
| manager_emp_id | uuid | YES |  |

Constraints:
- `FOREIGN KEY` employees_manager_emp_id_fkey: FOREIGN KEY (manager_emp_id) REFERENCES employees(id) ON DELETE SET NULL
- `PRIMARY KEY` employees_pkey: PRIMARY KEY (id)

### public.holidays

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| date | date | NO |  |
| name | text | NO |  |
| type | text | NO | 'Public'::text |
| created_at | timestamptz | NO | now() |

Constraints:
- `PRIMARY KEY` holidays_pkey: PRIMARY KEY (id)

Policies:
- **anon can read holidays** (SELECT, roles {anon}) using: `true` check: `-`

### public.imported_sheet_cache

| Column | Type | Null | Default |
|---|---|---|---|
| id | int2 | NO |  |
| filename | text | YES |  |
| cols | jsonb | NO | '[]'::jsonb |
| rows | jsonb | NO | '[]'::jsonb |
| imported_at | timestamptz | YES |  |

Constraints:
- `CHECK` imported_sheet_cache_id_check: CHECK ((id = 1))
- `PRIMARY KEY` imported_sheet_cache_pkey: PRIMARY KEY (id)

### public.leave_applications

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| emp_id | uuid | NO |  |
| emp_name | text | YES |  |
| company | text | YES |  |
| leave_type | text | NO |  |
| date | date | NO |  |
| reason | text | YES |  |
| location | text | YES |  |
| status | text | NO | 'Pending'::text |
| applied_at | timestamptz | NO | now() |

Constraints:
- `FOREIGN KEY` leave_applications_emp_id_fkey: FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE
- `PRIMARY KEY` leave_applications_pkey: PRIMARY KEY (id)

### public.leave_balances

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| emp_id | uuid | NO |  |
| leave_type | text | NO |  |
| accrued | numeric | NO | 0 |
| consumed | numeric | NO | 0 |
| balance | numeric | NO | 0 |
| quota | numeric | NO | 0 |
| unit | text | NO | 'Days'::text |
| financial_year | int4 | NO | (date_part('year'::text,
CASE
    WHEN (date_part('month'::t |

Constraints:
- `FOREIGN KEY` leave_balances_emp_id_fkey: FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE
- `PRIMARY KEY` leave_balances_pkey: PRIMARY KEY (id)
- `UNIQUE` leave_balances_emp_id_leave_type_fy_key: UNIQUE (emp_id, leave_type, financial_year)

### public.location_logs

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| emp_id | uuid | NO |  |
| date | date | NO |  |
| lat_lon | text | NO |  |
| captured_at | timestamptz | NO | now() |
| type | text | NO | 'auto'::text |

Constraints:
- `FOREIGN KEY` location_logs_emp_id_fkey: FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE
- `PRIMARY KEY` location_logs_pkey: PRIMARY KEY (id)

### public.monthly_sheet_cache

| Column | Type | Null | Default |
|---|---|---|---|
| id | int2 | NO |  |
| filename | text | YES |  |
| report_month | int4 | YES |  |
| report_year | int4 | YES |  |
| synced | int4 | YES |  |
| skipped | int4 | YES |  |
| imported_at | timestamptz | YES |  |

Constraints:
- `CHECK` monthly_sheet_cache_id_check: CHECK ((id = 1))
- `PRIMARY KEY` monthly_sheet_cache_pkey: PRIMARY KEY (id)

### public.od_tracking_logs

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| emp_id | uuid | NO |  |
| date | date | NO |  |
| lat_lon | text | NO |  |
| ts | timestamptz | NO | now() |

Constraints:
- `FOREIGN KEY` od_tracking_logs_emp_id_fkey: FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE
- `PRIMARY KEY` od_tracking_logs_pkey: PRIMARY KEY (id)

### public.regularization_requests

| Column | Type | Null | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| emp_id | uuid | NO |  |
| date | date | NO |  |
| requested_in | time | YES |  |
| requested_out | time | YES |  |
| reason | text | NO |  |
| status | text | NO | 'Pending'::text |
| created_at | timestamptz | NO | now() |
| updated_at | timestamptz | NO | now() |

Constraints:
- `FOREIGN KEY` regularization_requests_emp_id_fkey: FOREIGN KEY (emp_id) REFERENCES employees(id) ON DELETE CASCADE
- `PRIMARY KEY` regularization_requests_pkey: PRIMARY KEY (id)


## Functions

| Function | Args | SecDef | Lang |
|---|---|---|---|
| admin_add_holiday | `p_token uuid, p_date date, p_name text, p_type text` | **yes** | plpgsql |
| admin_bulk_upsert_attendance | `p_token uuid, p_records jsonb` | **yes** | plpgsql |
| admin_bulk_upsert_leave_balances | `p_token uuid, p_records jsonb` | **yes** | plpgsql |
| admin_clear_bio_sheet | `p_token uuid` | **yes** | plpgsql |
| admin_clear_imported_sheet | `p_token uuid` | **yes** | plpgsql |
| admin_clear_monthly_sheet | `p_token uuid` | **yes** | plpgsql |
| admin_create_employee | `p_token uuid, p_data jsonb` | **yes** | plpgsql |
| admin_decide_leave | `p_token uuid, p_leave_id uuid, p_decision text` | **yes** | plpgsql |
| admin_decide_regularization | `p_token uuid, p_id uuid, p_status text` | **yes** | plpgsql |
| admin_delete_employee | `p_token uuid, p_id uuid` | **yes** | plpgsql |
| admin_delete_holiday | `p_token uuid, p_id uuid` | **yes** | plpgsql |
| admin_fetch_all_leave_balances | `p_token uuid` | **yes** | plpgsql |
| admin_get_all_attendance | `p_token uuid` | **yes** | plpgsql |
| admin_get_all_leave_balances | `p_token uuid` | **yes** | plpgsql |
| admin_get_all_leaves | `p_token uuid` | **yes** | plpgsql |
| admin_get_all_location_logs | `p_token uuid, p_date date` | **yes** | plpgsql |
| admin_get_audit_logs | `p_token uuid, p_limit integer` | **yes** | plpgsql |
| admin_get_bio_sheet | `p_token uuid` | **yes** | plpgsql |
| admin_get_employees | `p_token uuid` | **yes** | plpgsql |
| admin_get_holidays | `p_token uuid` | **yes** | plpgsql |
| admin_get_imported_sheet | `p_token uuid` | **yes** | plpgsql |
| admin_get_location_logs | `p_token uuid, p_emp_id uuid, p_date date` | **yes** | plpgsql |
| admin_get_monthly_sheet | `p_token uuid` | **yes** | plpgsql |
| admin_get_od_logs | `p_token uuid, p_emp_id uuid, p_date date` | **yes** | plpgsql |
| admin_get_regularizations | `p_token uuid` | **yes** | plpgsql |
| admin_login | `p_pin text` | **yes** | plpgsql |
| admin_logout | `p_token uuid` | **yes** | sql |
| admin_reset_leave_balances | `p_token uuid` | **yes** | plpgsql |
| admin_set_bio_sheet | `p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb, p_report_da` | **yes** | plpgsql |
| admin_set_imported_sheet | `p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb` | **yes** | plpgsql |
| admin_set_monthly_sheet | `p_token uuid, p_filename text, p_report_month integer, p_report_year i` | **yes** | plpgsql |
| admin_toggle_employee_status | `p_token uuid, p_id uuid` | **yes** | plpgsql |
| admin_update_employee | `p_token uuid, p_emp_id uuid, p_data jsonb` | **yes** | plpgsql |
| admin_update_settings | `p_token uuid, p_std_hours numeric, p_new_admin_pin text` | **yes** | plpgsql |
| admin_upsert_attendance | `p_token uuid, p_emp_id uuid, p_data jsonb` | **yes** | plpgsql |
| admin_upsert_leave_balance | `p_token uuid, p_emp_id uuid, p_leave_type text, p_accrued numeric, p_c` | **yes** | plpgsql |
| current_fy | `` | no | sql |
| employee_apply_leave | `p_token uuid, p_emp_id uuid, p_data jsonb` | **yes** | plpgsql |
| employee_fetch_leave_balances | `p_token uuid, p_emp_id uuid` | **yes** | plpgsql |
| employee_get_attendance | `p_token uuid, p_emp_id uuid` | **yes** | plpgsql |
| employee_get_leave_balances | `p_token uuid, p_emp_id uuid` | **yes** | plpgsql |
| employee_get_leaves | `p_token uuid, p_emp_id uuid` | **yes** | plpgsql |
| employee_get_my_team | `p_token uuid, p_emp_id uuid` | **yes** | plpgsql |
| employee_get_od_logs | `p_token uuid, p_emp_id uuid, p_date date` | **yes** | plpgsql |
| employee_get_regularizations | `p_token uuid, p_emp_id uuid` | **yes** | plpgsql |
| employee_log_location | `p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text` | **yes** | plpgsql |
| employee_log_od_location | `p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date` | **yes** | plpgsql |
| employee_login | `p_employee_id uuid, p_pin text` | **yes** | plpgsql |
| employee_logout | `p_token uuid` | **yes** | sql |
| employee_punch | `p_token uuid, p_emp_id uuid, p_data jsonb` | **yes** | plpgsql |
| employee_submit_regularization | `p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone,` | **yes** | plpgsql |
| fetch_directory | `` | **yes** | plpgsql |
| is_valid_admin_token | `p_token uuid` | **yes** | sql |
| is_valid_employee_token | `p_token uuid, p_emp_id uuid` | **yes** | sql |
| manager_decide_leave | `p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text` | **yes** | plpgsql |
| manager_decide_regularization | `p_token uuid, p_manager_id uuid, p_reg_id uuid, p_status text` | **yes** | plpgsql |
| manager_get_team_attendance | `p_token uuid, p_manager_id uuid, p_month integer, p_year integer` | **yes** | plpgsql |
| manager_get_team_leaves | `p_token uuid, p_manager_id uuid` | **yes** | plpgsql |
| manager_get_team_regularizations | `p_token uuid, p_manager_id uuid` | **yes** | plpgsql |

## Function source

### admin_add_holiday(p_token uuid, p_date date, p_name text, p_type text)

```sql
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

```

### admin_bulk_upsert_attendance(p_token uuid, p_records jsonb)

```sql
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

```

### admin_bulk_upsert_leave_balances(p_token uuid, p_records jsonb)

```sql
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

```

### admin_clear_bio_sheet(p_token uuid)

```sql
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

```

### admin_clear_imported_sheet(p_token uuid)

```sql
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

```

### admin_clear_monthly_sheet(p_token uuid)

```sql
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

```

### admin_create_employee(p_token uuid, p_data jsonb)

```sql
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

```

### admin_decide_leave(p_token uuid, p_leave_id uuid, p_decision text)

```sql
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

```

### admin_decide_regularization(p_token uuid, p_id uuid, p_status text)

```sql
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

```

### admin_delete_employee(p_token uuid, p_id uuid)

```sql
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

```

### admin_delete_holiday(p_token uuid, p_id uuid)

```sql
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

```

### admin_fetch_all_leave_balances(p_token uuid)

```sql
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

```

### admin_get_all_attendance(p_token uuid)

```sql
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

```

### admin_get_all_leave_balances(p_token uuid)

```sql
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

```

### admin_get_all_leaves(p_token uuid)

```sql
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

```

### admin_get_all_location_logs(p_token uuid, p_date date)

```sql
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

```

### admin_get_audit_logs(p_token uuid, p_limit integer)

```sql
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

```

### admin_get_bio_sheet(p_token uuid)

```sql
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

```

### admin_get_employees(p_token uuid)

```sql
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

```

### admin_get_holidays(p_token uuid)

```sql
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

```

### admin_get_imported_sheet(p_token uuid)

```sql
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

```

### admin_get_location_logs(p_token uuid, p_emp_id uuid, p_date date)

```sql
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

```

### admin_get_monthly_sheet(p_token uuid)

```sql
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

```

### admin_get_od_logs(p_token uuid, p_emp_id uuid, p_date date)

```sql
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

```

### admin_get_regularizations(p_token uuid)

```sql
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

```

### admin_login(p_pin text)

```sql
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

```

### admin_logout(p_token uuid)

```sql
CREATE OR REPLACE FUNCTION public.admin_logout(p_token uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (delete from admin_sessions where token = p_token returning 1)
  select true;
$function$

```

### admin_reset_leave_balances(p_token uuid)

```sql
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

```

### admin_set_bio_sheet(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb, p_report_date date, p_synced integer, p_skipped integer)

```sql
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

```

### admin_set_imported_sheet(p_token uuid, p_filename text, p_cols jsonb, p_rows jsonb)

```sql
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

```

### admin_set_monthly_sheet(p_token uuid, p_filename text, p_report_month integer, p_report_year integer, p_synced integer, p_skipped integer)

```sql
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

```

### admin_toggle_employee_status(p_token uuid, p_id uuid)

```sql
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

```

### admin_update_employee(p_token uuid, p_emp_id uuid, p_data jsonb)

```sql
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

```

### admin_update_settings(p_token uuid, p_std_hours numeric, p_new_admin_pin text)

```sql
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

```

### admin_upsert_attendance(p_token uuid, p_emp_id uuid, p_data jsonb)

```sql
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

```

### admin_upsert_leave_balance(p_token uuid, p_emp_id uuid, p_leave_type text, p_accrued numeric, p_consumed numeric, p_balance numeric, p_quota numeric, p_unit text)

```sql
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

```

### current_fy()

```sql
CREATE OR REPLACE FUNCTION public.current_fy()
 RETURNS integer
 LANGUAGE sql
 STABLE
AS $function$
  select date_part('year', case when date_part('month', now()) >= 4 then now() else now() - interval '1 year' end)::int;
$function$

```

### employee_apply_leave(p_token uuid, p_emp_id uuid, p_data jsonb)

```sql
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

```

### employee_fetch_leave_balances(p_token uuid, p_emp_id uuid)

```sql
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

```

### employee_get_attendance(p_token uuid, p_emp_id uuid)

```sql
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

```

### employee_get_leave_balances(p_token uuid, p_emp_id uuid)

```sql
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

```

### employee_get_leaves(p_token uuid, p_emp_id uuid)

```sql
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

```

### employee_get_my_team(p_token uuid, p_emp_id uuid)

```sql
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

```

### employee_get_od_logs(p_token uuid, p_emp_id uuid, p_date date)

```sql
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

```

### employee_get_regularizations(p_token uuid, p_emp_id uuid)

```sql
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

```

### employee_log_location(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date, p_type text)

```sql
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

```

### employee_log_od_location(p_token uuid, p_emp_id uuid, p_lat_lon text, p_date date)

```sql
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

```

### employee_login(p_employee_id uuid, p_pin text)

```sql
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

```

### employee_logout(p_token uuid)

```sql
CREATE OR REPLACE FUNCTION public.employee_logout(p_token uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with d as (delete from employee_sessions where token = p_token returning 1)
  select true;
$function$

```

### employee_punch(p_token uuid, p_emp_id uuid, p_data jsonb)

```sql
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

```

### employee_submit_regularization(p_token uuid, p_emp_id uuid, p_date date, p_in time without time zone, p_out time without time zone, p_reason text)

```sql
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

```

### fetch_directory()

```sql
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

```

### is_valid_admin_token(p_token uuid)

```sql
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

```

### is_valid_employee_token(p_token uuid, p_emp_id uuid)

```sql
CREATE OR REPLACE FUNCTION public.is_valid_employee_token(p_token uuid, p_emp_id uuid)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (select 1 from employee_sessions where token = p_token and emp_id = p_emp_id and expires_at > now());
$function$

```

### manager_decide_leave(p_token uuid, p_manager_id uuid, p_leave_id uuid, p_status text)

```sql
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

```

### manager_decide_regularization(p_token uuid, p_manager_id uuid, p_reg_id uuid, p_status text)

```sql
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

```

### manager_get_team_attendance(p_token uuid, p_manager_id uuid, p_month integer, p_year integer)

```sql
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

```

### manager_get_team_leaves(p_token uuid, p_manager_id uuid)

```sql
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

```

### manager_get_team_regularizations(p_token uuid, p_manager_id uuid)

```sql
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

```


## Queries that failed

- cron_jobs: relation "cron.job" does not exist
