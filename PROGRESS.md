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
🔄 NOW       Day 2 evening — real two-stage leave approval built and verified live (P4-1, P4-2, P4-4, P4-8, P4-9 ✅; P4-3/P4-5 UI not screen-watched). P4-6 (email) blocked on Q-2/Q-3; P4-7 moot (Q-10 already resolved). Day 2 fully code-complete
⬜ NEXT      Day 3 — P4B-1..P4B-15 (half-day + accrual + year-end leave policy engine), hardening, testing

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
| ✅ Completed | **18** |
| ⬜ Day 1 | 37 |
| ⬜ Day 2 | 22 |
| ⬜ Day 3 | 24 |
| ⏭️ Deferred past Day 3 | 10 |
| 🚫 Open questions | 14 |

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
| **S-7** | Confirm compute size — **Nano is too small for 300**, needs Small/Medium | ⬜ | YOU |
| **S-8** | Load-test the 09:00 punch spike — 300 punches in a 20-minute window | ⬜ | DEV |

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
| P4-6 | Email sending — Edge Function + Resend + DNS | 🚫 blocked on `Q-2`/`Q-3` (hosting URL, DNS access) | DEV |
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
| P4B-1 | `day_part` column — full / first_half / second_half | ⬜ | DEV |
| P4B-2 | Half-day picker for **Casual, Sick, Earned** · 0.5 deduction | ⬜ | DEV |
| P4B-3 | New status **"Half Day Leave"** | ⬜ | DEV |
| P4B-4 | Shift expected start for First Half so biometric doesn't flag late | ⬜ | DEV |
| P4B-5 | One half-day per date · no clash with full-day leave | ⬜ | DEV |
| P4B-6 | **Auto-credit on 1 April** — CL 12 · EL 6 · SL 4 | ⬜ | DEV |
| P4B-7 | Pro-rata for joiners — CL 1/month · EL ½/month | ⬜ | DEV |

## Midday — Year-end & LOP rules

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P4B-8 | Year-end — CL lapses · EL up to 3 for May payout, rest lapses | ⬜ | DEV |
| P4B-9 | Probation / Notice → 1 leave cap, rest LOP | ⬜ | DEV |
| P4B-10 | 18-month service check — Marriage and Maternity | ⬜ | DEV |
| P4B-11 | Rename "Unpaid Leave" → **LOP** | ⬜ | DEV |
| P4B-12 | Enforce pre-approval a day before | ⬜ | DEV |
| P4B-13 | LOP spans week-offs and holidays inside the period | ⬜ | DEV |
| P4B-14 | Absence penalty — 1 unapproved day = 2 days LOP | ⬜ | DEV |

## Afternoon — Policy page & tracking

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P4B-15 | **Leave Policy page** in employee panel — readable in-app text | ⬜ | DEV |
| ~~P3-14~~ | ~~Silent 2-hourly capture · only while punched in · 90-day retention~~ ✅ **done Day 2 afternoon** — see above | — | — |
| ~~P3-15~~ | ~~Manager view of own team's location log~~ ✅ **done Day 2 afternoon** — see above | — | — |
| **P4C-1** | **Daily report download** — date picker + button in admin | ⬜ | DEV |
| **P4C-2** | 5-sheet workbook — Summary · Attendance · Location log · Leave · Exceptions | ⬜ | DEV |
| **P4C-3** | Server-side generation, streamed — not built from what's on screen | ⬜ | DEV |
| **P4C-4** | Exceptions sheet — outside-office · missing punch-out · app/bio mismatch · suspicious GPS | ⬜ | DEV |

## Evening — Hardening & testing

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P6-1 | Paging on attendance — loads everything into the browser today | ⬜ | DEV |
| P6-2 | Exports stream fully instead of stopping at 200 rows | ⬜ | DEV |
| P6-3 | Indexes for reporting queries | ⬜ | DEV |
| P6-4 | Soft delete for employees | ⬜ | DEV |
| P6-5 | Admin PIN — old-PIN check · confirm field · recovery path | ⬜ | DEV |
| P6-6 | Replace `alert()` with proper messages (15+ places) | ⬜ | DEV |
| **T-1** | **Full end-to-end test — every role, every flow** | ⬜ | DEV |
| **T-2** | Migration verification checklist (`plan.md` §10) | ⬜ | DEV |
| **T-3** | **Reset the database password** | ⬜ | YOU |

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
| **Q-2** | Where is the app hosted? | YOU | P4-6 | Day 2 PM |
| **Q-3** | Who has DNS access for `ecoste.in`? | YOU | P4-6 | Day 2 PM |
| Q-4 | ~~Confirm biometric stays official during dual-run~~ ✅ **Resolved — opposite of plan.md Decision 8's assumption.** Both readings always kept regardless; whichever an employee actually uses (app or biometric) becomes official for that day, since staff won't uniformly switch to the app. Admin can still override per-day via the switch (P3-12) | — | — | ✅ |
| Q-5 | **Paternity Leave quota** — undefined in policy | YOU / HR | P4B-6 | Day 3 AM |
| Q-6 | Maternity "1 week" — calendar or working days? | YOU / HR | P4B-6 | Day 3 AM |
| Q-7 | Sick/Marriage/Maternity/Bereavement sit on top of 26? | YOU / HR | P4B-6 | Day 3 AM |
| Q-8 | Keep or drop "Partial Leave – 1 Hour / 2 Hours"? | YOU | P4B-2 | Day 3 AM |
| Q-9 | Existing 131 staff default to **Confirmed**? | YOU | P2-4 | Day 1 PM |
| Q-10 | ~~What to do with the 281 stuck requests?~~ ✅ **Resolved — stay in the old app, not migrated** | — | — | ✅ |
| Q-15 | ~~Still fix the 5 broken functions in the old app for interim relief, or skip?~~ ✅ **Resolved — skip. Fixes go straight into the new HRMS schema, not a patch on the old app** | — | — | ✅ |
| Q-17 | Found a 6th broken function while writing the new schema: `manager_get_team_leaves` ordered by `leave_applications.created_at`, which doesn't exist (only `applied_at` does) — same bug class as the other 5. ✅ **Fixed in `0003_hrms_functions.sql`, no decision needed** | — | — | ✅ |
| **Q-16** | After launch, does the old app stay reachable for historical records? | YOU | — | Day 3 |
| Q-11 | ~~HRMS project created, Mumbai region?~~ ✅ **Yes — created, Mumbai** | — | — | ✅ answered |
| **Q-12** | Is **300** the total headcount, or 300 *at the same moment*? Changes compute sizing | YOU | S-7 | **Day 1 PM** |
| **Q-13** | Keep 5-minute OD tracking, or is the agreed 2-hourly enough? **Cuts ~1.2M rows/year** | YOU | S-5, P3-14 | **Day 1 PM** |
| **Q-14** | Willing to move HRMS off Nano compute? 300 users needs Small/Medium (paid upgrade) | YOU | S-7 | **Day 1 PM** |

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

## Next chat — how to start

Say any of these:

```
"start day 1"          → runs the whole Day 1 block in order
"start P0B"            → just the 5 broken function fixes
"do P0B-4"             → one specific task
"Q-1 answer is ..."    → records an answer and unblocks its tasks
"status"               → current position
```

Both files carry full context. Nothing from the planning conversation is lost.
