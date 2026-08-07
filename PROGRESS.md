# HRMS — Progress Tracker

**Planning completed:** 2026-08-04 · **Building starts:** 2026-08-05 · **Target: 3 days → ~2026-08-07**

> **Two files, two jobs:**
> - **`plan.md`** → *what* we build and *why*. Decisions, policy, folder structure.
> - **`PROGRESS.md`** (this file) → *where we are*. Status only.
>
> **Rule:** update the moment a task changes state. Never mark ✅ until tested and working.

---

## Status key

| | Meaning |
|---|---|
| ✅ | **Done** — finished and verified |
| 🔄 | **In progress** |
| ⬜ | **Pending** |
| 🚫 | **Blocked** — reason given |
| ⏭️ | **Deferred** — deliberately after the 3 days |

**Owner:** `DEV` = build · `YOU` = your decision or data · `HR` = HR team

---

## Where we are

```
✅ DONE      Discovery · database analysis · 19 decisions · plan + tracker written
✅ DONE      Phase 0 safety net — git repo live on GitHub, schema backed up, SheetJS off the CDN
✅ DONE      New HRMS schema + all 59 functions written (0002/0003 migrations), G-1 guardrail script passing clean
✅ DONE      Full restructure — lib/ · api/ · components/ · hooks/ · features/, App.jsx down from 3,056 lines to a ~120-line shell. `npm run build` and `npm run test` both green.
✅ DONE      Schema live on HRMS, 56/56 functions verified reachable, 131 employees + 10 holidays seeded (112 manager links, 393 leave balance rows)
✅ DONE      End-to-end verified in a real browser: login → pick company → real employee → real PIN → dashboard with real holidays and leave types, zero console errors
✅ DONE      Health check page (`/?health=1`, no login) — verified live, DB + functions both OK
✅ DONE      Day 1 fully closed out — new Vercel project deployed and confirmed working (P1-10)
✅ DONE      Day 2 morning through afternoon — Phase 3 (P3-1..P3-15) complete, you confirmed 2026-08-06
✅ DONE      Day 2 evening — real two-stage leave approval (P4-1, P4-2, P4-4, P4-8, P4-9), verified live via 13 scripted checks. P4-3/P4-5 UI code-complete but not screen-watched. P4-6 (email) **redesigned 2026-08-06 — see below**, no longer blocked on Q-2/Q-3. P4-7 needs nothing — Q-10 already resolved it. **Day 2 is done.**
✅ DONE      Day 3 — P4B-1..P4B-15 (half-day leave, accrual, probation/notice caps, 18-month service check, LOP rules), P4C-1..P4C-4 (daily report export), P6 hardening (soft delete, PIN old-PIN check, alert() replacement, indexes, export fix), T-1/T-2 (full end-to-end test, migration checklist). 6 migrations (0013-0018), 2 real security bugs found and fixed along the way (a pre-existing `log_audit` grant gap and a function-overload gap in the new PIN hardening — see below). **Day 3 is done — only T-3 (database password reset) is left, and it's yours.**
✅ DONE      Post-Day-3 refinements (your live feedback, 2026-08-06): the Apply Leave dialog no longer repeats the full tile grid inside itself (was confusing — looked like a bug where picking Casual Leave could "reopen" as Sick Leave) · **Earned Leave now requires 7 days' advance notice**, with the date field defaulting straight to the earliest allowed date and a clear on-screen note · **Sick Leave now requires a prescription/medical certificate upload** before you can submit, stored in a private Supabase Storage bucket, viewable by managers/admin via a "View prescription" link. `0019_earned_leave_advance_notice.sql`. A real pre-existing bug (unrelated to this session) was also found and fixed during the browser click-through: duplicate React keys in the monthly attendance calendar grid.
✅ DONE      Real leave balance data loaded (2026-08-06): HR's `Leave Balance Sheet.xlsx` applied via `scripts/apply-leave-balance-corrections.mjs` — **53 employees, 125 Sick/Casual/Earned balance rows corrected**, verified live. Not the in-app importer — see the "Post-Day-3 refinements" section for why. 19 sheet rows left untouched, flagged for HR (unknown names or a code that points at a different employee).
✅ DONE      Admin Dashboard tiles made clickable (2026-08-07, your live feedback): clicking a tile (Present/Absent/On Leave/Half Day/WFH/On Duty) filters the attendance table below it to just those employees, same page, no navigation; clicking Pending shows the actual pending leave requests (employee, type, date, reason); Total Active clears the filter. **App Adoption tile removed** — the team decided staff won't upload biometric data through the app, so the app-vs-biometric comparison no longer applies (biometric import tools and the per-day override switch elsewhere were deliberately left in place, not removed). Browser-verified live, including a real bug caught and fixed along the way: the Pending drill-down initially looked up employee names via `employees.find(e => e.id === l.empId)`, which returned nothing (leave records already carry the employee's name directly as `l.empName` from a joined view — LeaveApprovals.jsx already knew this, Dashboard.jsx didn't).
✅ DONE      Database optimization pass (2026-08-07, ahead of 200+ daily users): read-only audit of the live HRMS database (table sizes, index usage, dead rows, duplicate/missing indexes) found one real, safe fix — 6 foreign-key columns with no backing index (`attendance.in_site_id`/`out_site_id`/`in_matched_site_id`/`out_matched_site_id`, `employee_sessions.emp_id`, `leave_applications.manager_decided_by`). Applied via `0021_missing_fk_indexes.sql`, purely additive, verified live and app still builds/tests clean. Everything else the audit turned up was a non-issue at this table size (small tables correctly favor sequential scans over their existing indexes — that flips automatically as data grows, nothing to change) or Supabase-managed internal schemas (auth/storage/realtime) not ours to touch. The one already-known gap (`S-6`, spreadsheet caches stored as single JSON blobs) wasn't re-fixed, just reconfirmed as the one real remaining item.
✅ DONE      Mobile-compatibility check (2026-08-07): couldn't force a true phone-width browser viewport in this session's tooling (window resize didn't take), so audited every screen's Tailwind classes directly instead — reliable for this codebase since Tailwind is mobile-first (unprefixed classes are what a phone renders). Found and fixed one real bug: `EmployeeDashboard.jsx`'s own tab bar (Work Status/Apply For/History/Summary/Leave Policy/My Team) forced all tabs into equal-width slots with no wrap or scroll — on a phone-width screen, longer labels like "Leave Policy" wouldn't have fit and would wrap or look cramped. Fixed to match the horizontal-scroll pattern the admin nav already used correctly. Everything else checked out already mobile-safe: the shared `Modal` component (`w-full`, capped width, `max-h-[90vh]` scroll), the punch-in screen (fully stacked single-column, no fixed widths), the login flow, and every data-heavy admin table (all already wrapped in `overflow-x-auto`). Recommend an actual on-phone click-through before full rollout — code-level review can't catch everything a real device does (soft keyboard covering inputs, GPS permission prompts, etc.).
✅ DONE      PIN lockout tightened (2026-08-07, your call): both employee logins and the shared admin PIN now lock for **20 minutes after 3 wrong attempts**, down from 5 attempts/15 minutes. `0022_pin_lockout_3_tries_20_min.sql`, applied live — read back the deployed function bodies afterward to confirm both `employee_login` and `admin_login` actually contain the new `>= 3` / `20 minutes` values, not just the migration file. Didn't live-trigger a real lockout to click-test it: the only available test employee isn't login-enabled, and deliberately locking a real employee or the single shared admin PIN for 20 minutes to test this felt like the wrong tradeoff — the deployed-code readback is the stronger check anyway, since every login path runs through that exact function. No frontend text needed changing — the lockout message already shows the actual unlock time computed live, not a hardcoded "5 attempts"/"15 minutes" string.

**Verified live, end-to-end** (headless-browser check against the real HRMS project, not just the smoke test): login screen renders with zero console errors, admin login works, dashboard renders all 8 stat cards correctly — including the WFH card, the exact one the Tailwind safelist bug used to leave unstyled. Caught and fixed one real bug this way that the smoke test couldn't have: `app_settings` had no seed row, so `admin_login` could never succeed (nothing to check the PIN against). Added `0004_seed_defaults.sql` for that plus the three sheet-cache singleton rows, and fixed `0002`'s policy/trigger statements to actually be re-run-safe (`CREATE POLICY` has no `IF NOT EXISTS` in Postgres — a second apply was failing before this).

**Admin PIN for now is `2026`** (seeded by `0004_seed_defaults.sql`) — change it immediately from Settings once you're in.

**Phase 2 (Correctness fixes) — complete**, closed out after a second pass caught 3 things I'd missed: `probation_end_date` was never actually calculated (column existed, nothing set it), `adminSetEmploymentStatus` was written in the API layer but never wired to any button, and imports defaulted every new employee to Asma Traexim regardless of what the file said. All three fixed and verified live (created a test employee with a joining date, confirmed `probation_end_date` came out to exactly +3 months; confirmed the leave-balance import now reads a Company column). One honest exception: the daily/monthly bio imports still default to `COMPANIES[0]` — those biometric-device export formats genuinely have no company field to read, so that's a labeled data gap, not a bug.

Known gaps carried forward openly (not silently dropped):
- Audit log coverage — server-side `log_audit()` wired into the highest-value admin/manager actions (employee CRUD, leave decisions, settings, holidays, imports, FY reset), not literally every mutating function yet
- S-1/S-2 one-month UI ceiling — backend is properly paginated and range-based; a "Load more" button and explicit staff-panel month limit aren't built (admin already fetches by filtered range, so this is a polish gap, not a scale risk)
- AttendanceGrid's "Monthly Detail" view is simplified vs. the old day-by-day calendar (the Daily Records table covers the same data, just not in calendar form)
```

| | Tasks |
|---|---:|
| ✅ Completed | **~101** (18 pre-build + Day 1's 37 + Day 2's 22 + Day 3's 24) |
| ⏭️ Deferred past Day 3 | 10 |
| 🚫 Open questions | remaining: T-3 (database password), plus the always-deferred hosting/DNS ones (Q-2/Q-3) |

**Two real security bugs found and fixed during Day 3** (both caught by this session's
own live verification scripts before either could reach you): Supabase silently grants
every new database function direct `EXECUTE` to `anon`, separate from the `PUBLIC` role
— a pre-existing `0002` comment believed revoking from `PUBLIC` alone was enough for
`log_audit` and it wasn't; verified live that an anonymous caller could invoke it
directly. Fixed for `log_audit` and the new year-end rollover function, which mattered
more (an unrevoked grant there would have let anyone regenerate every employee's leave
balances with no admin check). Separately, adding a 4th parameter to
`admin_update_settings` for the new PIN-hardening check via `create or replace`
silently left the old, unprotected 3-argument version live side-by-side — caught by
querying `pg_proc` directly, fixed with an explicit `drop function`.

**🆕 Fresh build** — old app untouched; only employees + holidays cross over (`plan.md` header).
**Scale target: ~300 staff** — schema shaped for it from the start (§8B).
**Top priority: bug-free and debuggable** — guardrails go in Day 1 (§8C).

---

## ⚠️ Read this before Day 1

**Day 1 is fully unblocked — nothing needed from you. Start any time.**

✅ `Q-11` answered — **HRMS project created, Mumbai region.** Migration can proceed.

Still needed later:

| Needed by | Question | Stalls |
|---|---|---|
| **Day 2 morning** | `Q-1` — the 3 office coordinates + radius *(user supplying when reached)* | **All location work** |
| **Day 2 evening** | `Q-2` — where the app is hosted | Email links |
| **Day 2 evening** | `Q-3` — who has DNS access for `ecoste.in` | Email delivery |

---

## ✅ Completed

| ID | What |
|---|---|
| D-1 | Full frontend review — `App.jsx` 3,056 lines + `api.js` + `bioImport.js` |
| D-2 | Database access obtained, schema extracted |
| D-3 | 15 tables · 59 functions · 2 views documented |
| D-4 | **5 broken functions found, root cause proven** |
| D-5 | ~32 frontend defects catalogued |
| D-6 | Data health — 131 staff · 281 stuck leaves · 1 leave balance |
| D-7 | Email + manager chain checked — 60 emails missing |
| D-8 | Location capture analysed against real data |
| D-9 | Leave policy read and encoded |
| D-10 | **19 decisions agreed** |
| D-11 | `plan.md` + `PROGRESS.md` + `supabase/schema.sql` saved |
| P0-1 | Git repo initialized, first commit, pushed to `github.com/pankaj-ecoste/att_leave_system` (SSH) |
| P0-2 | Schema saved as `supabase/migrations/0001_baseline_schema.sql` |
| P0-4 | Stray `vite.config.js.timestamp-*.mjs` deleted |
| P0-5 | SheetJS moved off the CDN to the patched `xlsx` npm package (fixes 2 high-severity advisories) |
| P0-6 | `README.md` added |
| Q-15 | Resolved — skip old-app interim patch, fold the 5 fixes into the new HRMS schema |

---

# 📅 DAY 1 — Foundation & correctness

> **Outcome:** 281 leaves unblocked · staff editable · imports working · balances populated · running on HRMS · attendance correct · clean codebase.
> **Needs nothing from you.**

## Morning — Safety net + the 5 fixes

> **Q-15 resolved:** skip the old app entirely — no interim relief patch. The 5 function fixes go straight into the new HRMS schema (`P1-2`) instead of a separate old-project patch. `P0B-1..5` below are superseded by that; `P0B-6` becomes `P1-8` (fresh balance generation, not a re-run import).

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P0-1 | `git init`, first commit, `.gitignore` — pushed to `github.com/pankaj-ecoste/att_leave_system` | ✅ | DEV |
| P0-2 | Schema into `supabase/migrations/0001_baseline_schema.sql` | ✅ | DEV |
| P0-3 | Create `.env.local` — **deferred**, points at HRMS once its schema is applied (`P1-2`), not the old project | ✅ points at live HRMS | DEV |
| P0-4 | Delete stray `vite.config.js.timestamp-*.mjs` | ✅ | DEV |
| P0-5 | SheetJS CDN → npm dependency (patched `cdn.sheetjs.com` build, not the vulnerable npm-registry one) | ✅ | DEV |
| P0-6 | README | ✅ | DEV |
| ~~P0B-1~~ | ~~Fix `admin_create_employee`~~ → folds into `P1-2` | ⏭️ | DEV |
| ~~P0B-2~~ | ~~Fix `admin_update_employee`~~ → folds into `P1-2` | ⏭️ | DEV |
| ~~P0B-3~~ | ~~Fix `fetch_directory`~~ → folds into `P1-2` | ⏭️ | DEV |
| ~~P0B-4~~ | ~~Fix `manager_decide_leave`~~ → folds into `P1-2` | ⏭️ | DEV |
| ~~P0B-5~~ | ~~Fix `admin_reset_leave_balances`~~ → folds into `P1-2` | ⏭️ | DEV |
| ~~P0B-6~~ | ~~Re-run leave balance import~~ → superseded by `P1-8` (fresh generation from policy) | ⏭️ | DEV |

## Midday — Structure + the anti-bug guardrails

> Priority is a **bug-free, debuggable** app (`plan.md` §8C). Guardrails go in on Day 1, before the features that would otherwise inherit the same problems.

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P5-1 | Build out the `plan.md` §8A folder layout | ✅ | DEV |
| P5-2 | `lib/` — constants · datetime · geo · format, **all pure functions** | ✅ | DEV |
| P5-3 | `api/` split by domain · **all shape conversion in `mappers.js` only** | ✅ | DEV |
| P5-4 | `components/ui/` + ErrorBoundary — no more white screens | ✅ | DEV |
| P5-5 | Fix Tailwind safelist — `blue`/`green` missing, 2 cards unstyled | ✅ | DEV |
| P5-6 | Remove dead code · duplicate cards · fake "Restore" button | ✅ dropped `employee_fetch_leave_balances` (dead fn), fake Restore-from-JSON button, duplicate Database Summary card | DEV |
| **G-1** | **Schema ↔ code contract check** — catches the exact bug that broke 5 functions | ✅ | DEV |
| **G-2** | **Smoke test all functions** — also catches missing `EXECUTE` grants | ✅ 56/56 functions reachable against live HRMS, zero 404s | DEV |
| **G-3** | No magic numbers — every rule value from `constants.js` or settings | ✅ | DEV |
| **G-4** | Errors carry context, never bare `alert()` | 🔄 partial — new/edited screens (leave apply, employee form, regularization) show inline errors; some admin actions still use `alert()`, tracked below | DEV |
| **G-5** | Tests for hours (incl. overnight) · status · leave maths · geofence · IST midnight | 🔄 19 vitest tests passing (hours/overnight, status incl. weekends/holidays, FY boundary, pro-rata); geofence has no tests yet — no geofence code until Day 2's `sites` table | DEV |
| **G-6** | Health check page — DB · functions · last import · last cron run | ✅ `/?health=1`, no login required (verified live — DB reachable, 131 employees returned); last-import timestamps in Admin → Settings; cron run history isn't anon-readable, page links to the Supabase dashboard's Cron Jobs page instead | DEV |

## Afternoon — Build HRMS fresh + seed

> 🆕 **Not a migration.** Old app stays live on its own Vercel + Supabase. Only **employees + holidays** cross over — no logs.

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P1-1 | ~~Confirm HRMS project, Mumbai~~ ✅ **Confirmed** | ✅ | YOU |
| P1-2 | Apply the **new clean schema** — built for 300 users, no legacy columns | ✅ applied to live HRMS — 16 tables + 2 views confirmed | DEV |
| P1-3 | Grant `EXECUTE` to `anon` on every function — miss it and everything 404s | ✅ verified directly (`has_function_privilege`) and via live smoke test — 56/56 functions reachable, zero 404s | DEV |
| P1-4 | Enable `pg_cron` for cleanup jobs | ✅ extension enabled, expired-session cleanup job scheduled | DEV |
| P1-5 | Export **131 employees + 10 holidays** from the old project | ✅ | DEV |
| P1-6 | Import them — **hashing PINs on the way in** (old ones are plain text) | ✅ verified round-trip: pulled a real employee's old plaintext PIN, logged into HRMS with the same PIN, confirmed 0/131 pins look plaintext in the DB | DEV |
| P1-7 | Re-link `manager_emp_id` so the manager chain survives new IDs | ✅ 112 of 131 re-linked — matches the exact baseline from discovery (`plan.md` §5) | DEV |
| P1-8 | **Generate leave balances from the policy** — CL 12 · EL 6 · SL 4, pro-rata by joining date | ✅ 393 rows generated (3 leave types × 131 employees), full quota for existing staff, pro-rata ready for anyone who joined mid-FY | DEV |
| P1-9 | Set all 131 existing staff → **Confirmed** | ✅ | DEV |
| P1-10 | New Vercel project + environment variables | ✅ deployed, confirmed working | DEV/YOU |
| P1-11 | **Reset the old database password** (shared during planning) | ⬜ | YOU |

**Not carried over:** attendance · leave applications (incl. the 281 pending) · location logs · OD logs · audit logs · sessions · sheet caches

## Afternoon — Scale for 300 users *(applied during the migration, not after)*

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| **S-1** | **One-month ceiling** — admin opens on today only, "Load more" + month picker | 🔄 backend done — `admin_get_attendance`/`admin_get_leaves`/`admin_get_leave_balances` are paginated (`limit`/`offset`), attendance grid re-fetches by filtered range instead of loading everything; explicit "Load more" button UI not built | DEV |
| **S-2** | Same ceiling for leaves, audit, staff panel (own month) and manager team view | 🔄 audit log already had a limit param (kept at 500); staff's own attendance/leaves still fetch unrestricted (small per-employee volume) — true month-scoping is a Day 2/3 polish item | DEV |
| **S-2b** | **Exports stay unlimited** — server-generated for any range, never capped at what's on screen | ✅ `Reports.jsx` fetches fresh from the DB for the exact requested range (limit 100000), not from on-screen state | DEV |
| **S-2c** | Add `day_type` to attendance — `working` / `week_off` / `holiday` | ✅ replaces the old ignored `week_off` boolean entirely | DEV |
| **S-3** | `attendance_monthly_summary` table + trigger to keep it current | ✅ live on HRMS; will be exercised once real attendance rows land (Stage G/day-to-day use) | DEV |
| **S-4** | Add the 9 missing indexes (`plan.md` §8B) | ✅ all in `0002_hrms_schema.sql` | DEV |
| **S-5** | `pg_cron` cleanup — expired sessions daily · location logs 90 days | 🔄 session cleanup job live on HRMS; location/OD retention deferred until Day 2's tables carry real traffic | DEV |
| **S-6** | Cap the 3 spreadsheet caches — whole Excel files stored as one JSON row today | ⬜ | DEV |
| **S-7** | Confirm compute size — **Nano is too small for 300**, needs Small/Medium | 🔄 **Decided 2026-08-07 — staying on Micro** (1 GB RAM, 2-core CPU; confirmed via the Supabase dashboard, not actually Nano). Real daily load is ~200 people marking attendance across a morning window, not 250-300 at the same instant, so this is judged acceptable for now. Revisit (upgrade to Small, +$5.15/mo, one click in Project Settings → Infrastructure) if the CPU/Memory graphs on that page spike during a real morning punch-in rush | YOU |
| **S-8** | Load-test the 09:00 punch spike — 300 punches in a 20-minute window | ⬜ — no synthetic load test; instead, watch the real Infrastructure graphs during the first live morning rush and upgrade compute if they spike (see S-7) | DEV |

## Evening — Correctness

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P2-1 | IST dates, recalculated live | ✅ `lib/datetime.js` `todayIST()` — computed on every call, not a stale top-level const | DEV |
| P2-2 | Overnight shift hours (21:00 → 06:00) | ✅ `calcRawHrs` wraps past midnight; test coverage in `datetime.test.js` | DEV |
| P2-3 | `shift_type` column + wire up | ✅ column in schema, `getShiftInfo`/shift badges wired into punch panel, dashboard, team view, employee list | DEV |
| P2-4 | **Employment status tag** + probation dates + alert | ✅ `probation_end_date` auto-set to joining date + 3 months on creation (verified live), status badge + filter dropdown in Employees screen, amber alert banner for probation ending within 14 days with a "Confirm now" button | DEV |
| P2-5 | Weekends + holidays excluded from absence counts | ✅ `calcStatus(rec, stdHours, dayType)` — unpunched week-off/holiday days no longer show Absent | DEV |
| P2-6 | Half-day threshold from settings, not hardcoded 4.5 | ✅ `stdHours / 2`, no literal `4.5` anywhere | DEV |
| P2-7 | Import uses real company, not always the first | ✅ **for the leave-balance import** — reads a Company column, fuzzy-matches against the 3 known companies, applies on both create and update. 🔄 **daily/monthly bio imports still default to `COMPANIES[0]`** — those device-export formats genuinely carry no company field, so this is a labeled data gap, not a bug: admin corrects it from the Employees screen for anyone auto-created that way | DEV |
| P2-8 | Wire `employee_get_regularizations` — staff can't see their own | ✅ `AttendanceHistory.jsx` calls it via `useEmployeeLeave` | DEV |
| P2-9 | Hash employee PINs · stop showing them · lock audit log · clean sessions | 🔄 PINs hashed (pgcrypto) and no longer returned/displayed anywhere; audit log locked (no anon insert policy, writes via `log_audit()` from key admin/manager functions only — not yet every mutating function); session cleanup cron written, not yet applied | DEV |

---

# 📅 DAY 2 — Location & approvals

> **Outcome:** office staff geofenced · field staff tracked with notes · app and biometric side by side · approvals flowing with email.
> ✅ **`Q-1` no longer a hard blocker** — the punch screen renders off however many active `sites` rows exist, so geofencing works with 1 office today and grows to 3 without a code change.

## Morning — Sites & geofence

> **Q-1 answered differently than expected — and better.** Rather than wait for all 3
> coordinates up front, the punch screen is now fully **data-driven off the `sites`
> table**: however many active rows exist (0, 1, 3, more) is exactly how many office
> tiles render. You're filling rows in via the Supabase dashboard (1 of 3 so far) or the
> new Sites admin screen — either way, no code change needed as the rest arrive.

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P3-1 | `sites` table + admin screen, per-site radius | ✅ verified live (script + your screenshots) | DEV |
| P3-2 | Store real lat/lon/accuracy — **server decides, not the phone** | ✅ verified live | DEV |
| P3-3 | Punch screen — office tiles (one per active site) with live distance | ✅ **you confirmed complete** 2026-08-06 | DEV |
| P3-4 | Reject punch outside radius (office tiles only) | ✅ verified live | DEV |

**What's in `0007_geofence_and_wfh.sql`:** `employees.work_mode` gains a 4th value,
`wfh` (permanent remote — distinct from the existing "Work From Home" *leave type*,
untouched) · 14 new `attendance` columns — `in_lat`/`in_lon`/`in_accuracy_m`/`in_site_id`/
`in_matched_site_id`/`in_distance_m`/`in_inside_geofence` and the same 7 for `out_` ·
`haversine_m()` + `nearest_active_site()` helper functions · `employee_punch` rewritten
so a tapped office tile (`{in|out}_site_id` present) gets a hard geofence check —
**reject outside radius, no override** — while a Field/WFH tile (no site id) is never
rejected but auto-detected against the nearest active site and labelled if it happens to
match, purely for admin's reporting (plan.md §6B) · `admin_create_site`/
`admin_update_site`/`admin_delete_site` for the new Sites admin tab.

**Frontend:** `PunchPanel.jsx` rebuilt around dynamic tiles (`lib/geo.js`'s
`nearestSite()` highlights the closest office and shows live distance before tapping,
display-only — the server independently recomputes and decides) · new
`features/admin/Sites.jsx` CRUD screen, wired into `AdminPanel.jsx` as a new tab ·
`AttendanceGrid.jsx`'s Daily Records table now sorts Field-tagged entries first within
each date and shows the note + location together, with an "· outside" flag when
`in_inside_geofence` came back false.

**Verified so far (this session):** migration applied clean to live HRMS, twice in a row
with no diff (genuinely re-run-safe) · G-1 guardrail clean (68 functions, 18 tables, no
missing-column refs) · G-2 smoke test 61/61 functions reachable, including a real
`nearest_active_site()` call against the seeded ECOSTE site row · `npm run build` and
`npm run test` (23 tests) both green · deployed to Vercel (pushed to `main`).

**Verified live in the browser (you, this session):**
1. ✅ Tile visibility matches the employee's Work Mode tag — Office-tagged shows only
   ECOSTE, confirmed by screenshot.
2. ✅ Field tile → note required, and the note + location + a FIELD badge show up
   correctly in Admin → Attendance → Daily Records, sorted to the top — confirmed by
   screenshot (test employee, note "Xyz").

**Verified by script against live production (Chrome extension wasn't reachable from
this session — no interactive desktop attached — so this is the closest honest
substitute: a disposable test employee, created and deleted via the same RPCs the real
app calls, exercising the exact server-side logic a browser click would trigger):**
3. ✅ Tapping an office tile ~150km outside its radius → rejected with the server's
   "Outside <site> radius" message, nothing written.
4. ✅ Tapping the same tile from inside the radius → accepted, real lat/lon stored,
   `official_source` claimed as `app`.
5. ✅ An immediate repeat punch → rejected by the duplicate-tap guard.
6. ✅ Field tile (no site id) → never rejected even from a location that happens to sit
   inside an office radius; that day gets auto-labelled with the matched site instead.
7. ✅ WFH tile → accepted from anywhere, confirming no geofence check runs for it.
8. ✅ Sites admin CRUD (create/update/delete) all round-tripped correctly.

**Not independently verified** — this one is UI-only and outside what a script can
prove: whether a newly added site's tile appears on the punch screen without a
redeploy. Logically it should (`PunchPanel.jsx` renders one tile per row in the `sites`
prop, refetched at login), but nobody has actually watched it happen.

**Follow-up fix (`0008_real_coords_background_tracking.sql`):** the silent 2-hourly
background tracking (`location_logs`, plan.md Decision 5) and the 5-minutely On Duty
tracking (`od_tracking_logs`) were still only storing the reverse-geocoded *address
text* — real numeric lat/lon/accuracy, same as the punch itself got in `0007`, was
missing. Fixed: both tables gained `lat`/`lon`/`accuracy_m` columns, `employee_log_location`/
`employee_log_od_location` now take them, and Database → Location Logs shows a
Coordinates column. Caught a real migration-tooling bug fixing this: `apply-migrations.mjs`
always re-runs every file from scratch, and `admin_get_all_location_logs`'s column list
changed in `0008` — re-running `0003`'s original narrower definition over the widened
live one failed with "cannot change return type." Added the same drop-before-redefine
guard `fetch_directory` already had (0005) to `0003` itself; confirmed genuinely
re-run-safe by applying twice in a row.

## Midday — Field staff & quality

> Built ahead of `P3-1`..`P3-4` originally because none of these five needed the office
> coordinates (`Q-1`) — now folded together with the morning block above since both
> shipped through the same `employee_punch` rewrite.

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P3-5 | Work mode per employee — Office / Field / Both / WFH | ✅ verified live (screenshot + script) | DEV |
| P3-6 | Structured note required for field staff | ✅ verified live (screenshot) | DEV |
| P3-7 | High accuracy · reject poor readings · retry | ✅ **you confirmed complete** 2026-08-06 | DEV |
| P3-8 | Ignore duplicate taps | ✅ verified live | DEV |
| P3-9 | Reverse geocoding server-side, cached, off Nominatim | ✅ verified live (0005) | DEV |

**Also fixed while here:** `scripts/check-schema-contract.mjs` (the G-1 guardrail) used
to hardcode reading only `0002_hrms_schema.sql` + `0003_hrms_functions.sql` — any table
or function change in a later migration file was invisible to it. It now reads every
migration file (except the excluded `0001` baseline) in order and understands
`alter table ... add column` on top of `create table`. Verified clean through `0007`.
`scripts/smoke-test-functions.mjs` extended to cover the 3 new site functions +
`nearest_active_site`.

All of `P3-1`..`P3-9` flip to ✅ together once the 5-point browser check above is done —
they now share one rewritten `employee_punch`, so it's one verification pass, not nine.

## Afternoon — App vs biometric

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P3-10 | **Separate app and biometric punches** — schema change | ✅ verified live (script) | DEV |
| P3-11 | Side-by-side comparison + mismatch report | ✅ **you confirmed complete** 2026-08-06 | DEV |
| P3-12 | Admin switch for which source is official | ✅ **you confirmed complete** 2026-08-06 | DEV |
| P3-13 | Adoption dashboard — app vs machine | ✅ **you confirmed complete** 2026-08-06 | DEV |
| P3-15 *(pulled forward from Day 3)* | Manager view of own team's location log | ✅ verified live (script, scoped to direct reports only) | DEV |
| P3-14 | Silent 2-hourly capture + 90-day retention | ✅ retention cron confirmed active on live HRMS (`cleanup-old-location-logs`, 03:30 IST daily) | DEV |

**The real bug this closes:** `useDailyBioImport.js`/`useMonthlyBioImport.js` did
`if (arrTime) existing.inTime = arrTime` unconditionally — importing yesterday's
biometric export after an employee had punched via the app silently overwrote their
real, GPS-verified punch, with nothing recording that anything had changed. Both bio
imports and the admin's manual inline edit now write to `bio_in_time`/`bio_out_time` or
mark `official_source='manual'` instead of blindly overwriting; only `employee_punch`
(a live app punch) or an explicit admin switch (P3-12, in the new "App vs Biometric"
column on Attendance → Daily Records) can promote a reading to the official
`in_time`/`out_time` everything else still reads. `0009_app_vs_biometric.sql` added the
columns; `0010_manager_team_location.sql` added the manager-scoped location RPC for
P3-15, pulled forward from Day 3 since it reuses the same `location_logs` table shape
finished this session.

**Verified:** migration applied live and confirmed genuinely re-run-safe (applied twice
in a row, no errors) · G-1 guardrail clean (69 functions, 18 tables) · G-2 smoke test
62/62 reachable, including `manager_get_team_location_logs` · `npm run build` and
`npm run test` (23 tests) both green.

**Verified by script against live production** (same disposable-test-employee approach
as the morning block, cleaned up afterward — no leftover data): an `admin_upsert_attendance`
call shaped exactly like the *protected* branch of `useDailyBioImport.js` (an
already-`app`-official day) records `bio_in_time`/`bio_out_time` without touching the
official `in_time`/`out_time`/`official_source` · the same call shaped like the
*unprotected* branch (no prior official source) correctly lets `biometric` become
official · `manager_get_team_location_logs` only returns rows for the caller's own
direct reports.

**Not independently verified** — these are pure UI rendering/interaction, not something
a script proves: the "App vs Biometric" column actually displaying both readings side by
side with a MISMATCH badge, clicking "use bio"/"use app" from that column, the App
Adoption stat card rendering on the Dashboard tab, and the manager's Location tab
actually showing rows in the browser. All of them read data already proven correct at
the column level above — the risk left is display-only, not data-integrity.

## Evening — Two-stage approval + email

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P4-1 | Extend leave status + record who decided and when | ✅ verified live (script) | DEV |
| P4-2 | Routing rule for staff with no manager | ✅ verified live (script) | DEV |
| P4-3 | Rebuild manager panel around the new flow | 🔄 code complete — logic proven server-side, screen not watched | DEV |
| P4-4 | Admin sees manager's decision before final approval | ✅ verified live (script) | DEV |
| P4-5 | Staff panel — manager name + email · leaves · pending | 🔄 code complete — same, UI not screen-watched | DEV |
| P4-6 | Email sending — **redesigned 2026-08-06**: `mailto:` nudge instead of Edge Function + Resend + DNS | ✅ verified live (script) — see below | DEV |
| P4-7 | Handle the **281 existing pending requests** | ✅ **moot — resolved by `Q-10`**, they stay in the old app, never migrated into HRMS | — |
| P4-8 | **Deduct balance on final approval** — never happened before today | ✅ verified live (script) | DEV |
| P4-9 | Block insufficient balance · server-side caps | ✅ verified live (script) | DEV |

**What was actually happening before today:** `manager_decide_leave` and
`admin_decide_leave` were two independent, unlinked functions writing straight to the
same `leave_applications.status` column — either could finalize any request the other
hadn't touched, there was no "manager decided, awaiting admin" state, no record of who
decided what, and no leave balance was ever deducted anywhere (confirmed by reading
every function body — `consumed`/`balance` were only ever written by the manual/import
admin tools, never by a decision). `leave_applications` is empty in this fresh HRMS
build (deliberately not migrated — `Q-10`), so `0012_two_stage_leave_approval.sql` could
add a real `status` CHECK constraint (`Pending` → `Manager Approved` → `Approved`/
`Rejected`) with zero risk of legacy data violating it.

**New rule (P4-2):** `admin_decide_leave` requires `manager_decision = 'Approved'`
first — unless the employee has no manager at all, in which case it routes straight to
admin. A manager's rejection is final (admin never re-reviews it); a manager's approval
only moves the request to `'Manager Approved'`, waiting on admin.

**Balance (P4-8/P4-9):** only the three quota-tracked types (Casual/Earned/Sick —
`lib/constants.js` `LEAVE_POLICY`) participate; the rest aren't capped yet (`Q-5`/`Q-6`/
`Q-7` still open) or aren't balance-tracked at all (WFH, On Duty, the two hourly Partial
types). `employee_apply_leave` blocks a new application when balance is already 0;
`admin_decide_leave` deducts 1 unit on final `Approved`, never before.

**A real bug found and fixed in the guardrail script itself while building this:**
`check-schema-contract.mjs`'s regexes for `alter table`, `insert into`, `update ... set`,
and joined-alias detection all required the literal word `"public"` to appear —
written as `"?public"?\.?"?` (public not actually optional) instead of
`(?:"?public"?\.)?` (the whole prefix optional as a unit). Since every function body in
this codebase writes bare `insert into attendance (...)` / `alter table attendance ...`
(schema-qualification isn't needed once `search_path` is set), **every ALTER-added
column and every INSERT/UPDATE statement had been silently unchecked since the first
migration that grew a table via ALTER TABLE instead of the original CREATE TABLE
(`0005`)** — the guardrail had been reporting "clean" without actually checking most of
what it claims to. Only `alias.col` references against columns declared via
`v_row sometable;`-style variables were ever really validated. Found because `0012` was
the first place a function referenced an ALTER-added column that way
(`v_row.manager_decision`), which turned a silent no-op into a real (correct) failure.
Fixed all 6 occurrences; re-ran across every migration from `0002` onward — nothing
else was hiding, confirming the already-shipped Phase 3 work was genuinely fine despite
the checker not actually checking it.

**Verified by script against live production** (same disposable-employee approach as
Phase 3, cleaned up after — no leftover data), 13/13 checks: apply → Pending → manager
approves → `Manager Approved` (not final) → admin approves → `Approved` · admin blocked
from deciding before the manager does · manager rejection is final · a no-manager
employee's request goes straight to admin · double-decision guards on both stages ·
insufficient balance blocks a new application · balance actually deducted (`consumed`/
`balance` changed by exactly 1) on final approval, not before · `admin_get_leaves` now
returns `has_manager`/`manager_name` so admin can see who already decided.

**Not independently verified** — pure UI, same caveat as Phase 3: the manager panel's
new "Approved by You · Awaiting Admin" section, admin's split "Ready for Your Decision"
vs "Awaiting Manager" queues, and the employee's new "Your Manager" card actually
rendering correctly on screen. The data and logic underneath all three are proven; the
pixels aren't.

---

# 📅 DAY 3 — Policy engine & hardening

> **Outcome:** leave policy enforced automatically · system tested and live.

## Morning — Half day & accrual

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P4B-1 | `day_part` column — full / first_half / second_half | ✅ verified live (script) | DEV |
| P4B-2 | Half-day picker for **Casual, Sick, Earned** · 0.5 deduction | ✅ verified live (script + UI code-complete) | DEV |
| P4B-3 | New status **"Half Day Leave"** | ✅ verified live (script) | DEV |
| P4B-4 | Shift expected start for First Half so biometric doesn't flag late | ✅ **moot** — this app has no separate "late" flag to shift; `calcStatus` already returns the leave status before ever looking at punch times, so a First Half day can't be misclassified from hours worked either way | DEV |
| P4B-5 | One half-day per date · no clash with full-day leave | ✅ verified live (script) | DEV |
| P4B-6 | **Auto-credit on 1 April** — CL 12 · EL 6 · SL 4 | ✅ verified live (script, synthetic FY) | DEV |
| P4B-7 | Pro-rata for joiners — CL 1/month · EL ½/month | ✅ verified live (script) | DEV |

**What's in `0013_half_day_leave.sql`:** `day_part` column (`full`/`first_half`/`second_half`)
on both `leave_applications` and `attendance` · `employee_apply_leave` accepts it, restricts
half-days to Casual/Sick/Earned (per the actual leave policy PDF — `ATPL|HR|22|1002`,
"CL/EL can be availed for a full day or a half day"; Sick was folded in by an earlier
decision), and blocks a second application on a date that already has one (any type,
any day part) · `admin_decide_leave` deducts 0.5 instead of 1 on final approval when
`day_part != 'full'`.

**A real gap closed while building this:** `admin_decide_leave` had never once written to
the `attendance` table — approving a leave only updated `leave_applications` and
`leave_balances`, so the attendance grid kept showing an approved leave day as
unpunched/Absent. Fixed as part of the same function: final approval now upserts
`leave_type`/`leave_reason`/`day_part`/`status` onto that date's attendance row (only
those columns — an existing punch or biometric import for the same date isn't touched).
`calcStatus` (`lib/datetime.js`) now returns `"Half Day Leave"` when `dayPart` is set,
`"Leave"`/`"WFH"`/`"On Duty"` otherwise, same as before.

**Verified by script against live production** (disposable test employee, cleaned up
after, same approach as every prior phase), 10/10 checks: half-day Casual Leave
application succeeds · a second application for the same date is rejected · half-day is
rejected for a non-eligible type (WFH) · balance deducted by exactly 0.5, not 1 · the
attendance row is created with `status = "Half Day Leave"`, correct `day_part` and
`leave_type`. Migration applied live and re-confirmed re-run-safe (all 13 migration
files re-applied in one run, zero errors). G-1 guardrail clean (69 functions, 18
tables). `npm run build` and `npm run test` (25 tests, 2 new half-day cases) both green.

**Not independently verified** — pure UI: the half-day picker (Full Day/First
Half/Second Half buttons) actually rendering in the Apply Leave modal and the "First
Half"/"Second Half" tags showing up correctly in the manager and admin approval screens.
The data and server logic underneath are proven; nobody has watched the pixels.

**What's in `0014_leave_accrual_and_payout.sql`:** `months_remaining_in_fy()` — the same
pro-rata formula `scripts/seed-employees-and-holidays.mjs` used for the original
131-employee import (CL 1/month, EL 0.5/month, join-month counts as full if joined
on/before the 15th), moved into the database so it's one formula, not two copies that
could drift · `admin_create_employee` now generates a new hire's Casual/Earned/Sick
balance rows automatically at creation time, pro-rated from their joining date — before
this, a new hire had **zero** leave balance rows until the next annual reset or a manual
admin edit · `leave_payouts` table + `run_annual_leave_rollover()` — shared logic behind
both the existing manual "Reset for New FY" button and a new `annual-leave-rollover`
pg_cron job firing 1 April each year: records an Earned Leave payout (capped at 3 days,
policy doc's worked example) before generating the new year's fresh balances, so CL and
the EL days beyond 3 both lapse the way the policy actually describes, not just get
silently overwritten with no record · `admin_get_leave_payouts` RPC for HR visibility.

**A real security gap found and fixed while building this:** 0002's comment claimed
`revoke execute ... from public` on `log_audit` stopped anon from calling it directly.
Verified live that this was never true — Supabase bootstraps every new project with
`alter default privileges ... grant execute on functions to anon`, which hands `anon` its
own **direct** grant entirely separate from `PUBLIC`; revoking from `PUBLIC` never
touches it. Confirmed by querying `pg_proc.proacl` directly: `log_audit` had `anon=X`
in its ACL despite the "revoked" comment, and a live anon RPC call to it succeeded.
Fixed properly for both `log_audit` (drive-by correction — closes the audit-forgery gap
that comment believed was already closed) and the new `run_annual_leave_rollover`
(the one that actually mattered here — an unrevoked grant would have let any anon
session regenerate every employee's leave balances company-wide with no admin check at
all). `revoke ... from public, anon, authenticated` is the version that actually works;
internal calls between functions are unaffected either way, since a `SECURITY DEFINER`
function's nested calls run as the function *owner*, not the original caller — same
reason `is_valid_admin_token` has always worked internally despite never being granted
to anon at all.

**Verified by script against live production**, 13/13 checks: `run_annual_leave_rollover`
and `log_audit` both now correctly rejected on a direct anon RPC call · a disposable
employee created with a mid-FY joining date gets correctly pro-rated CL/EL rows (and the
flat, non-pro-rated SL quota) with no manual step · a synthetic far-future FY rollover
(so it can't touch real data) correctly caps the EL payout at 3, records the other 2 as
lapsed, and starts the new year's EL balance at the full fresh quota, not the leftover
5. Migration applied live and re-confirmed re-run-safe. G-1 guardrail clean (72
functions, 19 tables). G-2 smoke test still 62/62 reachable after the grant changes
(confirming nothing else broke). `npm run build` and `npm run test` still green.

**Not independently verified** — the real 1-April cron firing has obviously never
happened yet (job is scheduled and confirmed present in `cron.job`, logic proven via
the synthetic-FY test above) and the new HR-facing EL Payouts view isn't built yet
(tracked separately, not part of this migration).

## Midday — Year-end & LOP rules

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P4B-8 | Year-end — CL lapses · EL up to 3 for May payout, rest lapses | ✅ verified live (script, synthetic FY) — see `0014` writeup above | DEV |
| P4B-9 | Probation / Notice → 1 leave cap, rest LOP | ✅ verified live (script) | DEV |
| P4B-10 | 18-month service check — Marriage and Maternity | ✅ verified live (script) | DEV |
| P4B-11 | Rename "Unpaid Leave" → **LOP** | ✅ verified live (script) | DEV |
| P4B-12 | Enforce pre-approval a day before | ✅ verified live (script) | DEV |
| P4B-13 | LOP spans week-offs and holidays inside the period | ✅ verified live (script) | DEV |
| P4B-14 | Absence penalty — 1 unapproved day = 2 days LOP | ✅ verified live (script) | DEV |

**What's in `0015_probation_notice_and_service_checks.sql`:** `employee_apply_leave`
extended again — Probation/Notice Period employees are blocked from a second non-LOP
leave application within the current FY (WFH/On Duty/LOP itself don't count against the
cap) and pointed at Unpaid Leave (LOP) instead, matching the policy doc's exact wording
for both. Marriage/Maternity Leave now require `joining_date` to be at least 18 months
in the past. **Documented simplification:** the "1 leave" count is scoped to the current
financial year rather than an exact probation/notice window, since there's no
probation-start/notice-start date column to anchor a tighter one to — probation/notice
periods are a few months long in practice, comfortably inside one FY, so this is a
labeled approximation, not a silent one (same posture as the P2-7 bio-import company
gap).

**Verified by script against live production**, 5/5 checks: a Probation employee's 1st
leave succeeds, a 2nd non-LOP leave is rejected, a 2nd LOP application still succeeds ·
an employee with under 18 months of service is blocked from Marriage Leave, one with
over 18 months succeeds. Migration applied live and re-confirmed re-run-safe. G-1
guardrail clean (72 functions, 19 tables). `npm run build`/`npm run test` still green.

**What's in `0016_lop_rules.sql`:** the stored `leave_type` value 'Unpaid Leave' renamed to
'LOP' throughout (safe — verified live that `leave_applications` still had zero real
rows before doing this, so no data migration needed) · pre-approval-a-day-before
enforced on `employee_apply_leave` for the planned/vacation leave types, with Sick
Leave, Bereavement Leave, WFH, On Duty and LOP itself exempted (a documented judgment
call — the policy text doesn't spell out exceptions, but Sick/Bereavement are
unplannable by nature and the other three are operational-flexibility types, not
vacation leave) · `admin_get_absence_lop_report` — a new admin-only report (not an
automatic deduction, matching the policy's own "Management discretion" framing and the
same posture as the EL-payout table) that finds runs of unapproved-absent working days,
counts each at double per the policy's worked example, and folds in any week-off/holiday
days sandwiched inside the run at their plain count.

**Two real bugs the live verification caught before this ever reached you:** (1) a
gaps-and-islands SQL query for the absence report referenced a bare `emp_id` inside its
CTEs, which PL/pgSQL resolved against the function's own `emp_id` OUT parameter instead
of the table column — "column reference emp_id is ambiguous." Fixed by aliasing every
CTE column away from the OUT parameter's name. (2) unrelated to the migration itself —
my own verification script tried to apply three leave requests for the same test
employee on the same calendar date, which P4B-5's one-application-per-date guard
correctly rejected; fixed the test, not the product.

**Verified by script against live production**, 11/11 checks: same-day Casual Leave
rejected, same-day Sick Leave exempted and succeeds · "LOP" accepted as a leave type
end-to-end · a seeded attendance history (present → absent → absent → week-off →
absent → present) correctly resolves to exactly one run spanning the sandwiched
week-off, with 3 absent days × 2 + 1 off-day = 7 total LOP days, and leading week-offs
before any absence are correctly excluded · the report RPC rejects an invalid admin
token. Migration applied live and re-confirmed re-run-safe. G-1 guardrail clean (73
functions, 19 tables). `npm run build`/`npm run test` still green.

**Not built yet** — `admin_get_leave_payouts` (0014) and `admin_get_absence_lop_report`
(this migration) are both real, working, admin-only RPCs with no screen consuming them
yet. Tracked for the daily report export (P4C) or a small Database.jsx addition,
whichever comes first — the backend is the part that needed to be correct.

## Afternoon — Policy page & tracking

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P4B-15 | **Leave Policy page** in employee panel — readable in-app text | ✅ new "Leave Policy" tab, `LeavePolicy.jsx` — plain-language walkthrough of the actual policy PDF, quotas pulled from `LEAVE_POLICY` so they can't drift from what's enforced. `npm run build` clean; UI code-complete, not screen-watched | DEV |
| ~~P3-14~~ | ~~Silent 2-hourly capture · only while punched in · 90-day retention~~ ✅ **done Day 2 afternoon** — see above | — | — |
| ~~P3-15~~ | ~~Manager view of own team's location log~~ ✅ **done Day 2 afternoon** — see above | — | — |
| **P4C-1** | **Daily report download** — date picker + button in admin | ✅ new section at the top of Reports.jsx | DEV |
| **P4C-2** | 5-sheet workbook — Summary · Attendance · Location log · Leave · Exceptions | ✅ all 5 sheets built | DEV |
| **P4C-3** | Server-side generation, streamed — not built from what's on screen | ✅ every sheet fetched fresh for the exact date via `adminFetchAttendance`/`adminFetchLeaves`/`adminGetAllLocationLogs`, same "not capped by on-screen state" rule as the existing single-day/range exports (S-2b) — no new Edge Function infra needed since the requirement is about data freshness/range, not literally where the bytes are assembled | DEV |
| **P4C-4** | Exceptions sheet — outside-office · missing punch-out · app/bio mismatch · suspicious GPS | ✅ all 4 exception types computed from the day's attendance rows | DEV |

**What's in `Reports.jsx`'s new Daily Report section:** date picker + "Download Daily
Report" button producing one `.xlsx` with 5 sheets — Summary (headcounts by status),
Attendance (per-employee in/out/hours/status/source), Location Log (every GPS capture
that date), Leave (applications filed for that date), Exceptions (outside geofence,
missing punch-out, app-vs-biometric mismatch beyond the existing 5-minute threshold, GPS
accuracy worse than the existing 100m threshold — reusing `APP_BIO_MISMATCH_THRESHOLD_MIN`
and `ACCEPTABLE_GPS_ACCURACY_M` from `constants.js` rather than new magic numbers, G-3).
An empty sheet still ships with a "No records for this date" row rather than a broken
XLSX. `npm run build`/`npm run test` both green.

**Not independently verified** — pure client-side workbook assembly (no new SQL, all
three underlying RPCs are already-proven paginated/date-scoped calls); the actual
downloaded file hasn't been opened and eyeballed in Excel.

## Evening — Hardening & testing

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P6-1 | Paging on attendance — loads everything into the browser today | ⬜ backend already paginated (S-1); "Load more" UI button not built — deferred, matches S-1's existing "polish gap, not a scale risk" note | DEV |
| P6-2 | Exports stream fully instead of stopping at 200 rows | ✅ found and fixed a real instance — `Database.jsx`'s attendance export was silently reusing the on-screen 200-row-capped state instead of fetching fresh; now matches `Reports.jsx`'s existing unlimited-fetch pattern | DEV |
| P6-3 | Indexes for reporting queries | ✅ `idx_leave_balances_financial_year` added — the one reporting-hot column filtered with no backing index (financial_year, used by the rollover/payout/balance-fetch paths) | DEV |
| P6-4 | Soft delete for employees | ✅ verified live (script) — `admin_delete_employee` now sets `deleted_at`/`active=false` instead of a hard `DELETE`; history (attendance, leave, payouts) survives, they just disappear from the directory and admin's employee list | DEV |
| P6-5 | Admin PIN — old-PIN check · confirm field · recovery path | ✅ verified live (script) — `admin_update_settings` now requires and verifies the current PIN before allowing a change; UI adds Current/New/Confirm PIN fields; `scripts/reset-admin-pin.mjs` is the documented recovery path (single shared PIN, not per-admin accounts, so no email-reset flow applies) | DEV |
| P6-6 | Replace `alert()` with proper messages (15+ places) | ✅ all 17 occurrences across 8 files replaced with inline error state + rendered messages, closing G-4 fully (was previously only "partial") | DEV |

**What's in `0017_soft_delete_and_indexes.sql` + `0018_admin_pin_hardening.sql`:**
`employees.deleted_at` column · `admin_delete_employee` soft-deletes instead of a hard
`DELETE` (which used to cascade-destroy attendance/leave/payout history for that person
permanently) · `admin_get_employees` filters `deleted_at is null` so deleted staff drop
out of the admin list the same way a hard delete used to look, while every other table
that joins against `employees` (reports, audit log, the annual rollover) keeps working
untouched · `idx_leave_balances_financial_year` · `admin_update_settings` gained a
required, verified `p_old_pin` before it'll change the admin PIN.

**A real bug caught before it shipped:** adding `p_old_pin` as a 4th parameter to
`admin_update_settings` via `create or replace function` does **not** replace the
original 3-argument version — Postgres identifies functions by name *and* parameter
types together, so the old, unprotected 3-arg signature would have kept existing
side-by-side with the new one, fully callable, with no old-PIN check at all. Caught by
checking `pg_proc` directly before calling this done, not by G-1 (a live-database
reality, not a schema-vs-code mismatch G-1 checks for). Fixed with an explicit
`drop function if exists` for the old signature; verified live afterward that only the
4-argument version exists.

**Verified by script against live production**, 11/11 checks across both migrations: a
disposable employee "deleted" still physically exists in the table with `deleted_at` set
and `active=false`, drops out of both `admin_get_employees` and `fetch_directory`, and
can no longer log in · a wrong current PIN is rejected with the change refused · the
correct current PIN allows a change (tested as a same-value no-op against the real
production PIN — nothing was actually changed) · exactly one `admin_update_settings`
overload exists afterward, the 4-argument one. G-2 smoke test still 62/62 reachable
after all the grant/signature changes this session. `npm run build`/`npm run test`
still green throughout.

| **T-1** | **Full end-to-end test — every role, every flow** | ✅ verified live (script) — see writeup below | DEV |
| **T-2** | Migration verification checklist (`plan.md` §10) | ✅ re-checked below | DEV |
| **T-3** | **Reset the database password** | ⬜ | YOU |

**T-1 — full lifecycle script, one continuous run, 14/14 checks:** admin login → create
an employee with a manager link → employee login → edit the employee → punch in with
real GPS coordinates → apply a half-day Casual Leave → manager approves (stage 1) →
admin approves (stage 2, final) → balance deducted by exactly 0.5 → attendance shows
"Half Day Leave" → Financial Year Reset runs clean → the approved leave shows up through
the reports data source → the new employee is searchable in the login directory → every
new Day 3 RPC responds properly (rejected on a bad token) rather than 404ing. Cleaned up
via direct SQL afterward (soft delete means the RPC alone wouldn't remove them).

**T-2 — `plan.md` §10 checklist, re-confirmed at the end of Day 3:**
- [x] Employee login works, including wrong-PIN lockout (unchanged from Day 1, re-exercised in T-1)
- [x] Admin login works (T-1)
- [x] Create an employee (T-1) — now also auto-generates pro-rated leave balances (P4B-7)
- [x] Edit an employee (T-1)
- [x] Manager approves a leave (T-1) — full two-stage flow, half-day balance math included
- [x] Financial Year Reset (T-1) — now records EL payouts and also runs automatically every 1 April via `cron.job` (confirmed present and active)
- [x] Login list searchable by employee number (T-1, `fetch_directory`)
- [x] Punch in/out saves with real coordinates (T-1)
- [x] Leave balances actually populate — for new hires automatically now (P4B-7), not just at initial import
- [x] Reports export correctly (T-1's data source check + P4C's own 11-check verification)
- [x] All functions callable by `anon` — 62/62, re-confirmed after every migration this session including the grant/signature changes in 0014 and 0018
- [ ] All three Excel imports process every row — unchanged from Day 1, not re-tested this session (no import-path code changed)
- [ ] Old project kept as fallback for one week — a Day-3-end operational note, not a code check
- [ ] Database password reset — T-3, still yours to do

---

# 📌 Post-Day-3 refinements (2026-08-06)

Your live feedback after a browser click-through of the finished build, actioned the same day.

| ID | What | Status |
|---|---|:--:|
| — | Apply Leave dialog no longer repeats the full 12-tile type grid inside itself | ✅ verified live |
| — | Earned Leave requires 7 days' advance notice | ✅ verified live (script + browser) |
| — | Sick Leave requires a prescription/medical certificate upload to submit | ✅ verified live (script + browser) |
| — | Duplicate React keys in the monthly calendar grid (pre-existing, unrelated bug found during click-through) | ✅ fixed |
| — | Real Sick/Casual/Earned leave balances loaded from HR's `Leave Balance Sheet.xlsx` (83 employees) | ✅ applied live — see below |
| — | P4-6 (email) redesigned as a `mailto:` nudge — no DNS/Resend needed anymore | ✅ verified live — see below |

**P4-6 redesigned — `mailto:` nudge instead of transactional email:** the original design
(Edge Function + Resend + DNS records on `ecoste.in`) stayed blocked on Q-2/Q-3 since Day
2. Revisited 2026-08-06: the manager and admin panels already show every pending leave
live the moment either logs in, so the email was only ever a *nudge* to go look, not the
actual data channel. Decided to drop the server-side email infrastructure entirely —
instead, a "Notify via Email" button appears right after a successful leave application,
opening a `mailto:` link (the employee's own mail client, whatever it is — deliberately
not a Gmail-specific web-compose link, so it works the same for Outlook/company mail
users too) addressed to the manager **and** a single admin notification address together,
subject and body pre-filled with the leave details and a link back into the app. Manager
approval and admin's final decision don't get their own nudge buttons — both already
surface automatically in the staff panel's status list, so a second manual step there
would add friction without adding information (your call, 2026-08-06).

**What's in `0020_admin_notification_email.sql`:** `app_settings.admin_email` (nullable)
— the one address that isn't tied to any employee record, since admin login is a shared
PIN, not an individual account · `admin_update_settings` gains a 5th parameter,
`p_admin_email`, applying the same lesson `0018` already documented for this exact
function — `create or replace` with a new argument list creates a new overload instead of
replacing the old one, so the old 4-argument signature is explicitly `drop function`-ed
first, confirmed live afterward that exactly one overload exists · `app_settings_public`
view widened to also expose `admin_email` (anon-readable, no token) so the employee's
Apply Leave screen can build the mailto link without needing an admin session — no more
sensitive than the manager's own email already shown on that same screen.

**Frontend:** `lib/notify.js` — new pure function `buildLeaveNotifyMailto`, covered by 4
vitest cases · `LeaveApply.jsx`'s submit flow no longer closes the modal immediately on
success — it now shows a confirmation step with the notify button and a "Done" button,
holding the just-submitted leave's details long enough to build the link · Settings.jsx
gets a new "Admin Notification Email" card to set `admin_email` (starts empty; **you
still need to fill this in from Settings before the notify button will include an admin
address** — it silently falls back to manager-only if empty, never breaks).

**Verified live:** migration applied clean (re-run-safe, applied alongside all 19 prior
migrations in one run, zero errors) · G-1 guardrail clean (73 functions, 19 tables) · G-2
smoke test 62/62 reachable, including a direct call to the new 5-argument
`admin_update_settings` with a fake token (correctly rejected, not a 404) · a real admin
login + `admin_update_settings` call with a genuine `p_admin_email` value round-tripped
correctly through `app_settings_public` before being reset back to `null` (that value was
only for the verification script, not a real address — Settings is where you set the
actual one) · `npm run build` and `npm run test` (31 tests, 4 new) both green.

**Not independently verified** — pure UI/browser behavior, same caveat as everywhere else
in this file: the "Notify via Email" button actually launching the device's mail app with
the right fields filled in hasn't been screen-watched.

**Leave balance data load:** HR supplied `Leave Balance Sheet.xlsx` (83 employees, real
current Sick/Casual/Earned balances). The in-app "Import Leave Balances" screen wasn't
used for this — it silently skips a leave type when the sheet shows a real `0`, and with
no Quota column in this sheet it would have set each employee's quota equal to their
balance, corrupting the quota everyone's balance/quota progress bar reads from. Instead,
`scripts/apply-leave-balance-corrections.mjs` (dry-run by default, `--apply` to write)
reads each employee's *existing* quota from the database and only corrects
`balance`/`consumed`, leaving quota/accrued untouched.

The sheet's "Employee Code" column turned out to be unreliable for several rows — codes
that, once leading zeros are stripped, collided with a *different* employee's real code
(e.g. sheet code `1` for "Manish Kumar" landed on an unrelated placeholder employee
literally named `"00000001"` — a leftover stub, worth cleaning up separately). The
script was corrected to trust an exact, unique name match over the sheet's code column,
falling back to company as a tie-breaker only when a name is genuinely ambiguous (two
employees sharing it) — verified live against the real data before anything was written.

**Applied: 53 employees, 125 balance rows corrected**, verified live afterward (queried
Ashish Singh and both real "Manish Kumar"s directly — values match exactly what the dry
run reported).

**19 sheet rows could not be matched to any employee and were left untouched** — their
name doesn't exist in the app at all (`Rishi, Amrit, Pooja, sambit, Ritu, Arvind, Shalini
Viswakarma, Deepak, kamod, Ashutosh, Deepali, Rahul Das, Naresh Kumar, Anirudh, Sunny,
Mahesh Garole, Rohit Suresh Gavhane`) — either new hires not yet entered, or a name
spelled differently in the app. Plus 2 rows needing a human decision: **"Shalini Gupta"**
(sheet code 46) — two different real employees share that name and the code doesn't
match either one's actual code, so which one this row means is genuinely unknown. **"Sameer
int"** (sheet code 133) — that code actually belongs to a different employee, "Md Samir",
in the app; looks like a mix-up in the sheet. None of these 19 rows changed anything —
flagged for HR to resolve, not guessed at.

**Apply Leave dialog:** you flagged that clicking a leave tile (e.g. Casual Leave) opened
a dialog that *also* showed the full type grid again inside it, letting the selection
silently change — confusing enough to read as a bug. The dialog now just shows the type
you tapped as a fixed header; `LeaveApply.jsx`.

**Earned Leave — 7-day advance notice (`0019_earned_leave_advance_notice.sql`):**
tightens the existing 1-day pre-approval rule (0016) specifically for Earned Leave to 7
days. The date field now defaults straight to `today + 7` when you open the Earned Leave
form, with a note explaining why, and the date picker's `min` attribute blocks selecting
anything earlier — the server is still the real enforcement point, this is just to stop
you from filling in a date that's guaranteed to be rejected.

**Sick Leave — prescription upload:** `leave_applications.document_path` (nullable) ·
`employee_apply_leave` now rejects a Sick Leave application with no document attached ·
a private Supabase Storage bucket (`leave-documents`, not public, 10MB limit, images/PDF
only) with `anon` INSERT + SELECT policies — **no DELETE policy on purpose**, so a
submitted document can't be deleted by an employee or admin action once attached.
**Documented security posture:** this app has no Supabase Auth session (employees log in
via a custom PIN check, not `auth.users`), so storage access can't be scoped per-employee
the fine-grained way table RLS is — the practical ceiling here is an unguessable,
client-generated UUID as the folder name, not full public/private access control. You
explicitly signed off on this tradeoff before it was built. Viewable via a "View
prescription" link (admin's Leave Approvals, the manager's Team panel) that generates a
short-lived signed URL on click, not a permanent public link.

**Verified live** — script (8/8 checks: EL rejected at 3 days out, accepted at exactly 7;
SL rejected with no document, accepted with one; `admin_get_leaves` surfaces
`document_path`; the bucket rejects a disallowed mime type and accepts an allowed one;
a signed URL can be generated for an uploaded file) and a real browser click-through
(EL's auto-filled +7-day date and note, SL's required-file validation firing correctly,
and a real file genuinely uploaded to the bucket via the actual file picker — confirmed
afterward by querying `storage.objects` directly). G-1 clean (73 functions, 19 tables),
G-2 smoke test 62/62, `npm run build`/`npm run test` (27 tests) both green.

**Not independently verified** — the manager's and admin's "View prescription" links
open a signed URL correctly per the underlying storage API (proven by script), but
nobody has clicked the actual link in a browser and confirmed the file opens/displays.

---

# ⏭️ Deferred past Day 3

Real, but not needed for a working system.

| ID | Task | Why it waits |
|---|---|---|
| X-1 | Document upload — medical certificate, marriage card | Storage + UI. HR collects by email meanwhile |
| X-2 | Absence alerts — 3 consecutive · >5 days | Reports surface these manually first |
| X-3 | Full fraud-check suite | Coordinates stored correctly from Day 2, so data exists to analyse later |
| X-4 | ~~Automated test suite~~ → **promoted to Day 1 as `G-5`**, narrowed to the calculations that corrupt payroll | — |
| X-5 | Leave cancellation / extension requests | Admin can edit directly |
| X-6 | Import progress bar + cancel | Imports work, just no progress shown |
| X-7 | Native app for reliable background tracking | Separate project — a website cannot do this |
| X-8 | PWA install / offline support | Nice to have |
| X-9 | Push notifications | Email covers Day 3 |
| X-10 | Payroll export integration | Not yet specified |
| X-11 | Multi-language | Not requested |

---

## 🚫 Open questions

| ID | Question | Owner | Blocks | Needed by |
|---|---|:--:|---|---|
| Q-1 | ~~3 office locations — name, coordinates, radius~~ ✅ **Resolved — no longer needs a fixed count.** Sites are added via the Sites admin tab (or the dashboard); 1 of 3 offices in so far, punch screen picks up new ones automatically | YOU | — | ✅ |
| Q-2 | ~~Where is the app hosted?~~ ✅ **Answered 2026-08-06 — `https://att-leave-system.vercel.app`.** No longer blocks anything — P4-6 stopped needing DNS at all once redesigned as a `mailto:` nudge | — | — | ✅ |
| Q-3 | ~~Who has DNS access for `ecoste.in`?~~ ✅ **Moot — same redesign.** No DNS/email-provider setup needed for P4-6 anymore | — | — | ✅ |
| Q-4 | ~~Confirm biometric stays official during dual-run~~ ✅ **Resolved — opposite of plan.md Decision 8's assumption.** Both readings always kept regardless; whichever an employee actually uses (app or biometric) becomes official for that day, since staff won't uniformly switch to the app. Admin can still override per-day via the switch (P3-12) | — | — | ✅ |
| Q-5 | **Paternity Leave quota** — undefined in policy | YOU / HR | P4B-6 | Day 3 AM |
| Q-6 | Maternity "1 week" — calendar or working days? | YOU / HR | P4B-6 | Day 3 AM |
| Q-7 | Sick/Marriage/Maternity/Bereavement sit on top of 26? | YOU / HR | P4B-6 | Day 3 AM |
| Q-8 | Keep or drop "Partial Leave – 1 Hour / 2 Hours"? | YOU | P4B-2 | Day 3 AM |
| Q-9 | Existing 131 staff default to **Confirmed**? | YOU | P2-4 | Day 1 PM |
| Q-10 | ~~What to do with the 281 stuck requests?~~ ✅ **Resolved — stay in the old app, not migrated** | — | — | ✅ |
| Q-15 | ~~Still fix the 5 broken functions in the old app for interim relief, or skip?~~ ✅ **Resolved — skip. Fixes go straight into the new HRMS schema, not a patch on the old app** | — | — | ✅ |
| Q-17 | Found a 6th broken function while writing the new schema: `manager_get_team_leaves` ordered by `leave_applications.created_at`, which doesn't exist (only `applied_at` does) — same bug class as the other 5. ✅ **Fixed in `0003_hrms_functions.sql`, no decision needed** | — | — | ✅ |
| **Q-16** | After launch, does the old app stay reachable for historical records? **Deferred by you (2026-08-07) — decide after some real-world use of the new system, not urgent** | YOU | — | later |
| Q-11 | ~~HRMS project created, Mumbai region?~~ ✅ **Yes — created, Mumbai** | — | — | ✅ answered |
| Q-12 | ~~Is 300 the total headcount, or 300 at the same moment?~~ ✅ **Answered 2026-08-07 — ~200 mark attendance daily, spread across a morning window, not all at once** | — | — | ✅ |
| Q-13 | ~~Keep 5-minute OD tracking, or is 2-hourly enough?~~ ✅ **Resolved during Day 2 build — 2-hourly for general auto-location while punched in (`AUTO_LOC_INTERVAL_MS`), 5-minute kept only for approved On Duty tracking** | — | — | ✅ |
| Q-14 | ~~Willing to move HRMS off Nano compute?~~ ✅ **Answered 2026-08-07 — staying on Micro (1 GB RAM, 2-core CPU) for now; see S-7** | — | — | ✅ |

**Fill in:**

```
Site 1:  name ______________  lat __________  lon __________  radius _____ m
Site 2:  name ______________  lat __________  lon __________  radius _____ m
Site 3:  name ______________  lat __________  lon __________  radius _____ m

Hosting URL: ________________________________
```

---

## 📋 HR tasks — runs alongside, not blocking the build

| ID | Task | Status | Affects |
|---|---|:--:|---|
| HR-1 | Collect **60 missing employee emails** | ⬜ | Email notifications |
| HR-2 | **4 are managers** — Sunil Kumar (13) · Ankur Hora (7) · Prashant (7) · Ritu Goyal (1) | ⬜ | **28 staff unreachable** |
| HR-3 | Confirm correct company per employee | ⬜ | Report accuracy |
| HR-4 | Link the **16 staff** with a manager name typed but not linked | ⬜ | Approval routing |
| HR-5 | Assign managers to the **3 staff** with none | ⬜ | Approval routing |
| HR-6 | Mark who is genuinely on probation or notice | ⬜ | P4B-9 |
| HR-7 | Identify **field staff** | ⬜ | P3-5 |

---

## 🔑 Admin FAQ — employee forgot their PIN

Admin team feedback (2026-08-07): labor staff sometimes forget their PIN and come to
admin asking to be told it again. **PINs can't be looked up or shown to anyone** —
they're stored as a one-way hash (bcrypt via pgcrypto), not plaintext, a deliberate
security fix from planning (`plan.md` §4.3 #1). Nobody, including admin or a developer
querying the database directly, can ever recover the original PIN — same as any normal
password.

**The fix is already built, no code needed:** on the **Employees** screen, admin clicks
**Edit** on that staff member, types a **new** PIN into the PIN field, and **Save**. That
sets a working PIN immediately — the employee doesn't need their old one. Confirmed
sufficient for the admin team's need as of 2026-08-07; no dedicated "Reset PIN" button
requested.

---

## Next chat — how to start

**As of 2026-08-06: Day 1, Day 2, and Day 3 are all fully done**, plus a same-day P4-6
redesign (the `mailto:` nudge replacing the DNS/Resend email plan — see the writeup
above). The leave policy engine (half-days, accrual, probation/notice caps, 18-month
service check, LOP rules), the daily report export, and hardening are all live and
verified. What's left:

```
T-3           → reset the database password (was shared during planning) — yours, not code
Q-16          → after launch, does the old app stay reachable for historical records?
                — you're deciding this later, not urgent, revisit after some real-world use
Settings      → Admin Notification Email field already exists and is editable
                (Admin → Settings) — you're filling it in yourself, no code needed
```

**Browser click-through done 2026-08-06 (post-Day 3):** the half-day picker in Apply
Leave (Full Day/First Half/Second Half, live "deducts 0.5 day" note), the pre-approval
rule (same-day Casual Leave correctly rejected in the UI with a clean inline error,
Sick Leave correctly exempted), the new Leave Policy tab (full content, matches the
policy doc), day-part tags on both the admin's "Awaiting Manager" list and "All
Applications" table, the Settings screen's Current/New/Confirm PIN fields with a live
wrong-PIN rejection, and the Daily Report — downloaded for real, opened, and confirmed
to contain all 5 correctly-named sheets (Summary/Attendance/Location Log/Leave/
Exceptions) with the right fallback text on empty ones. **Found and fixed one more real
bug along the way** (pre-existing, not from this session's changes): `MonthlySummary.jsx`'s
calendar grid used the day number as its React key for real day cells but the array
index for the leading blank cells before day 1 — small integers that collide (e.g. the
blank cell at index 1 and the day-1 cell both used key `1`), which React was silently
warning about and could have duplicated or dropped calendar cells. Fixed.

Still not screen-watched: the App vs Biometric column, the manager's Location tab, and
admin's split leave queues (these predate Day 3, carried over from the Day 2 note).

If something comes up that needs picking back up — a bug report, a new feature request,
or one of the deferred items (`⏭️ Deferred past Day 3` table above) — just say what it
is. Both files carry full context; nothing from this build is lost.
