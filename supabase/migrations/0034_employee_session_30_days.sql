-- plan.md §13 — employees were getting silently logged out after 18h (default set once at
-- login, never extended by activity), which is shorter than a normal day-to-day gap between
-- app opens. Bump the default lifetime so this is no longer a practical daily occurrence.
-- Admin sessions are deliberately untouched (out of scope, plan.md §13).
alter table "public"."employee_sessions"
  alter column "expires_at" set default (now() + interval '30 days');
