-- Read-only DB audit (2026-08-07, ahead of 200+ people using the app daily) found 6
-- foreign-key columns in our own tables with no backing index: Postgres has to
-- sequentially scan the whole child table to enforce the FK whenever the referenced
-- parent row is updated/deleted, and any query filtering/joining on these columns does
-- the same. Doesn't show yet since these tables are still small, but attendance in
-- particular will grow fastest (200 people x ~300 working days/year) — cheap to add now
-- while tables are tiny, purely additive, no behavior change.

create index if not exists idx_attendance_in_site_id on attendance (in_site_id);
create index if not exists idx_attendance_out_site_id on attendance (out_site_id);
create index if not exists idx_attendance_in_matched_site_id on attendance (in_matched_site_id);
create index if not exists idx_attendance_out_matched_site_id on attendance (out_matched_site_id);
create index if not exists idx_employee_sessions_emp_id on employee_sessions (emp_id);
create index if not exists idx_leave_applications_manager_decided_by on leave_applications (manager_decided_by);
