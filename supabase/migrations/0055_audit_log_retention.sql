-- plan.md §33.8a (system health audit, 2026-09-22) — audit_logs was the one high-volume
-- log table with no retention at all. Every other constantly-written table
-- (location_logs, od_tracking_logs) gets a 90-day purge (0011); audit_logs never did,
-- so it grows forever for as long as the app is used. Retention period (1 year) is
-- the user's own explicit call, not a technical default — audit entries have real
-- investigative value (e.g. the 2026-09-04 leave-approval-functions incident), so this
-- is deliberately much longer than the operational GPS-log retention, not the same
-- number reused by habit.
--
-- Same idempotent-by-name pattern as every other cron job here (0011, 0014, 0024) —
-- re-running this migration is a no-op, not a duplicate job.

select cron.schedule(
  'cleanup-old-audit-logs',
  '0 4 * * *', -- 04:00 IST daily, staggered after cleanup-expired-sessions (03:00) and cleanup-old-location-logs (03:30)
  $$
    delete from audit_logs where ts < now() - interval '1 year';
  $$
);
