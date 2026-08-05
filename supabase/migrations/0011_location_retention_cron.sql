-- 90-day retention for location_logs and od_tracking_logs (P3-14, plan.md §8B S-5).
-- Deferred in 0002 until these tables carried real traffic — Phase 3's location work
-- (P3-1..P3-13) is now live, so it's time. Same posture as the expired-session cleanup
-- job already scheduled there: `cron.schedule` upserts by job name, so re-running this
-- on every migration apply is a no-op, not a duplicate job.

select cron.schedule(
  'cleanup-old-location-logs',
  '30 3 * * *', -- 03:30 IST daily, staggered a half hour after cleanup-expired-sessions
  $$
    delete from location_logs where captured_at < now() - interval '90 days';
    delete from od_tracking_logs where ts < now() - interval '90 days';
  $$
);
