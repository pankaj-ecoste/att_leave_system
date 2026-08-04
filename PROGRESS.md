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
🔄 NOW       Nothing running — awaiting go-ahead
⬜ NEXT      Day 1 Morning → fix the 5 broken functions
```

| | Tasks |
|---|---:|
| ✅ Completed | **12** |
| ⬜ Day 1 | 43 |
| ⬜ Day 2 | 22 |
| ⬜ Day 3 | 24 |
| ⏭️ Deferred past Day 3 | 10 |
| 🚫 Open questions | 15 |

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

---

# 📅 DAY 1 — Foundation & correctness

> **Outcome:** 281 leaves unblocked · staff editable · imports working · balances populated · running on HRMS · attendance correct · clean codebase.
> **Needs nothing from you.**

## Morning — Safety net + the 5 fixes

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P0-1 | `git init`, first commit, `.gitignore` | ⬜ | DEV |
| P0-2 | Schema into `supabase/migrations/0001_baseline_schema.sql` | ⬜ | DEV |
| P0-3 | Create `.env.local` | ⬜ | DEV |
| P0-4 | Delete stray `vite.config.js.timestamp-*.mjs` | ⬜ | DEV |
| P0-5 | SheetJS CDN → npm dependency | ⬜ | DEV |
| P0-6 | README | ⬜ | DEV |
| **P0B-1** | Fix `admin_create_employee` | ⬜ | DEV |
| **P0B-2** | Fix `admin_update_employee` | ⬜ | DEV |
| **P0B-3** | Fix `fetch_directory` | ⬜ | DEV |
| **P0B-4** | Fix `manager_decide_leave` → **unblocks 281 requests** | ⬜ | DEV |
| **P0B-5** | Fix `admin_reset_leave_balances` | ⬜ | DEV |
| **P0B-6** | Re-run leave balance import → **131 staff currently have none** | ⬜ | DEV |

## Midday — Structure + the anti-bug guardrails

> Priority is a **bug-free, debuggable** app (`plan.md` §8C). Guardrails go in on Day 1, before the features that would otherwise inherit the same problems.

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P5-1 | Build out the `plan.md` §8A folder layout | ⬜ | DEV |
| P5-2 | `lib/` — constants · datetime · geo · format, **all pure functions** | ⬜ | DEV |
| P5-3 | `api/` split by domain · **all shape conversion in `mappers.js` only** | ⬜ | DEV |
| P5-4 | `components/ui/` + ErrorBoundary — no more white screens | ⬜ | DEV |
| P5-5 | Fix Tailwind safelist — `blue`/`green` missing, 2 cards unstyled | ⬜ | DEV |
| P5-6 | Remove dead code · duplicate cards · fake "Restore" button | ⬜ | DEV |
| **G-1** | **Schema ↔ code contract check** — catches the exact bug that broke 5 functions | ⬜ | DEV |
| **G-2** | **Smoke test all functions** — also catches missing `EXECUTE` grants | ⬜ | DEV |
| **G-3** | No magic numbers — every rule value from `constants.js` or settings | ⬜ | DEV |
| **G-4** | Errors carry context, never bare `alert()` | ⬜ | DEV |
| **G-5** | Tests for hours (incl. overnight) · status · leave maths · geofence · IST midnight | ⬜ | DEV |
| **G-6** | Health check page — DB · functions · last import · last cron run | ⬜ | DEV |

## Afternoon — Build HRMS fresh + seed

> 🆕 **Not a migration.** Old app stays live on its own Vercel + Supabase. Only **employees + holidays** cross over — no logs.

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P1-1 | ~~Confirm HRMS project, Mumbai~~ ✅ **Confirmed** | ✅ | YOU |
| P1-2 | Apply the **new clean schema** — built for 300 users, no legacy columns | ⬜ | DEV |
| P1-3 | Grant `EXECUTE` to `anon` on every function — miss it and everything 404s | ⬜ | DEV |
| P1-4 | Enable `pg_cron` for cleanup jobs | ⬜ | DEV |
| P1-5 | Export **131 employees + 10 holidays** from the old project | ⬜ | DEV |
| P1-6 | Import them — **hashing PINs on the way in** (old ones are plain text) | ⬜ | DEV |
| P1-7 | Re-link `manager_emp_id` so the manager chain survives new IDs | ⬜ | DEV |
| P1-8 | **Generate leave balances from the policy** — CL 12 · EL 6 · SL 4, pro-rata by joining date | ⬜ | DEV |
| P1-9 | Set all 131 existing staff → **Confirmed** | ⬜ | DEV |
| P1-10 | New Vercel project + environment variables | ⬜ | DEV |
| P1-11 | **Reset the old database password** (shared during planning) | ⬜ | YOU |

**Not carried over:** attendance · leave applications (incl. the 281 pending) · location logs · OD logs · audit logs · sessions · sheet caches

## Afternoon — Scale for 300 users *(applied during the migration, not after)*

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| **S-1** | **One-month ceiling** — admin opens on today only, "Load more" + month picker | ⬜ | DEV |
| **S-2** | Same ceiling for leaves, audit, staff panel (own month) and manager team view | ⬜ | DEV |
| **S-2b** | **Exports stay unlimited** — server-generated for any range, never capped at what's on screen | ⬜ | DEV |
| **S-2c** | Add `day_type` to attendance — `working` / `week_off` / `holiday` | ⬜ | DEV |
| **S-3** | `attendance_monthly_summary` table + trigger to keep it current | ⬜ | DEV |
| **S-4** | Add the 9 missing indexes (`plan.md` §8B) | ⬜ | DEV |
| **S-5** | `pg_cron` cleanup — expired sessions daily · location logs 90 days | ⬜ | DEV |
| **S-6** | Cap the 3 spreadsheet caches — whole Excel files stored as one JSON row today | ⬜ | DEV |
| **S-7** | Confirm compute size — **Nano is too small for 300**, needs Small/Medium | ⬜ | YOU |
| **S-8** | Load-test the 09:00 punch spike — 300 punches in a 20-minute window | ⬜ | DEV |

## Evening — Correctness

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P2-1 | IST dates, recalculated live | ⬜ | DEV |
| P2-2 | Overnight shift hours (21:00 → 06:00) | ⬜ | DEV |
| P2-3 | `shift_type` column + wire up | ⬜ | DEV |
| P2-4 | **Employment status tag** + probation dates + alert | ⬜ | DEV |
| P2-5 | Weekends + holidays excluded from absence counts | ⬜ | DEV |
| P2-6 | Half-day threshold from settings, not hardcoded 4.5 | ⬜ | DEV |
| P2-7 | Import uses real company, not always the first | ⬜ | DEV |
| P2-8 | Wire `employee_get_regularizations` — staff can't see their own | ⬜ | DEV |
| P2-9 | Hash employee PINs · stop showing them · lock audit log · clean sessions | ⬜ | DEV |

---

# 📅 DAY 2 — Location & approvals

> **Outcome:** office staff geofenced · field staff tracked with notes · app and biometric side by side · approvals flowing with email.
> 🚫 **Needs `Q-1` (office coordinates) by morning.**

## Morning — Sites & geofence

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P3-1 | `sites` table + admin screen, per-site radius | 🚫 | DEV |
| P3-2 | Store real lat/lon/accuracy — **server decides, not the phone** | ⬜ | DEV |
| P3-3 | Punch screen — 3 office tiles with live distance | ⬜ | DEV |
| P3-4 | Reject punch outside radius (office staff only) | ⬜ | DEV |

## Midday — Field staff & quality

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P3-5 | Work mode per employee — Office / Field / Both | ⬜ | DEV |
| P3-6 | Structured note required for field staff | ⬜ | DEV |
| P3-7 | High accuracy · reject poor readings · retry | ⬜ | DEV |
| P3-8 | Ignore duplicate taps | ⬜ | DEV |
| P3-9 | Reverse geocoding server-side, cached, off Nominatim | ⬜ | DEV |

## Afternoon — App vs biometric

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P3-10 | **Separate app and biometric punches** — schema change | ⬜ | DEV |
| P3-11 | Side-by-side comparison + mismatch report | ⬜ | DEV |
| P3-12 | Admin switch for which source is official | ⬜ | DEV |
| P3-13 | Adoption dashboard — app vs machine | ⬜ | DEV |

## Evening — Two-stage approval + email

| ID | Task | Status | Owner |
|---|---|:--:|:--:|
| P4-1 | Extend leave status + record who decided and when | ⬜ | DEV |
| P4-2 | Routing rule for the 19 staff with no manager | ⬜ | DEV |
| P4-3 | Rebuild manager panel around the new flow | ⬜ | DEV |
| P4-4 | Admin sees manager's decision before final approval | ⬜ | DEV |
| P4-5 | Staff panel — manager name + email · attendance · leaves · pending | ⬜ | DEV |
| P4-6 | Email sending — Edge Function + Resend + DNS | 🚫 | DEV |
| P4-7 | Handle the **281 existing pending requests** | 🚫 | DEV |
| P4-8 | **Deduct balance on final approval** — never happens today | ⬜ | DEV |
| P4-9 | Block insufficient balance · server-side caps | ⬜ | DEV |

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
| P3-14 | Silent 2-hourly capture · only while punched in · 90-day retention | ⬜ | DEV |
| P3-15 | Manager view of own team's location log | ⬜ | DEV |
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
| **Q-1** | **3 office locations** — name, coordinates, radius · *user will supply on Day 2 when reached* | YOU | P3-1 → all location work | **Day 2 AM** |
| **Q-2** | Where is the app hosted? | YOU | P4-6 | Day 2 PM |
| **Q-3** | Who has DNS access for `ecoste.in`? | YOU | P4-6 | Day 2 PM |
| Q-4 | Confirm biometric stays official during dual-run | YOU | P3-12 | Day 2 PM |
| Q-5 | **Paternity Leave quota** — undefined in policy | YOU / HR | P4B-6 | Day 3 AM |
| Q-6 | Maternity "1 week" — calendar or working days? | YOU / HR | P4B-6 | Day 3 AM |
| Q-7 | Sick/Marriage/Maternity/Bereavement sit on top of 26? | YOU / HR | P4B-6 | Day 3 AM |
| Q-8 | Keep or drop "Partial Leave – 1 Hour / 2 Hours"? | YOU | P4B-2 | Day 3 AM |
| Q-9 | Existing 131 staff default to **Confirmed**? | YOU | P2-4 | Day 1 PM |
| Q-10 | ~~What to do with the 281 stuck requests?~~ ✅ **Resolved — stay in the old app, not migrated** | — | — | ✅ |
| **Q-15** | Still fix the 5 broken functions in the **old** app for interim relief, or skip since the new app lands in 3 days? | YOU | P0B | **Day 1 AM** |
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
