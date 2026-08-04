# HRMS — Attendance & Leave System · Project Plan

**Last updated:** 2026-08-04
**Status:** 🆕 **Building a new application.** The existing app stays live and untouched on its own Vercel + Supabase.

> ### This is a fresh build, not a migration
>
> | | Old app | New app |
> |---|---|---|
> | Vercel | stays as-is | new project |
> | Supabase | `attendance_tracker` (free) | **HRMS** (paid, Mumbai) |
> | Fate | keeps running · read-only reference | replaces it |
>
> **Only two things carry across: the employee list and the holiday list.**
> Attendance, leave applications, location logs, audit logs and sessions are **not** migrated — they stay in the old system.
>
> **Consequence:** the new app starts with **no attendance history**. Records before go-live are looked up in the old app.
>
> This is a big advantage — the schema is designed correctly from scratch for 300 users, with no broken columns or legacy shapes to carry forward.

> 📊 **Live status is tracked in [`PROGRESS.md`](./PROGRESS.md)** — what's done, what's running, what's pending.
> This file is *what and why*. That file is *where we are*. No building has started yet.

---

## 1. What this project is

A web app for **Ecoste group** covering attendance and leave across three companies:

- Asma Traexim Pvt Ltd
- Metamask Design Solutions LLP
- Lamora Buildtech Pvt Ltd

**131 active employees. 18 managers.** Attendance data runs from **17 June 2026** to today.

### How it is used *today*

```
FIELD STAFF      → punch in/out from the app (GPS captured)
EVERYONE ELSE    → punch on the biometric machine
                   → HR exports Excel at end of day
                   → HR uploads it into the app
```

### Where it is going

**All 131 employees punch from the app. Biometric machine retired.**
Both run side by side during the changeover so staff learn to trust the app.

---

## 2. Technology

| Part | What it is |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Supabase (PostgreSQL 17.6) |
| Logic | 59 database functions — all business rules live here, not in the app |
| Login | Custom PIN → token. **Not** Supabase Auth |
| Excel | SheetJS, loaded from a CDN at runtime |

### Files

```
src/
  App.jsx          3,056 lines   ← the entire app, one component, ~60 state variables
  lib/api.js         651 lines   ← database calls + field name mapping (well written)
  lib/bioImport.js   122 lines   ← Excel parsing helpers
  lib/supabase.js     13 lines
```

**No git repository. No tests. No linter. No README. No SQL in the repo.**

---

## 3. What is already built and working

**Employee**
- Login: pick company → pick name → enter PIN. Lockout after 5 wrong tries (15 min)
- Punch in/out with GPS
- Apply for leave — 12 types
- View attendance calendar, monthly summary, leave balances
- Request attendance correction (regularization)

**Manager** — "My Team" tab appears automatically if they have direct reports
- See team leave and correction requests
- See team attendance summary by month

**Admin** — 7 tabs
- Dashboard, attendance grid with inline editing, leave approvals
- Employee management, reports (XLSX/CSV), database browser, settings
- Three Excel importers: leave balances, daily biometric, monthly biometric grid
- Holiday calendar, audit log, financial-year reset

**Database** — 15 tables, 59 functions, 2 views

---

## 4. Confirmed defects

Everything in this section was **verified against the live database**, not guessed.

### 4.1 🔴 Five broken database functions — one root cause

Someone renamed columns on the `employees` table and never updated the functions that use them.

| Function looks for | Column is actually called |
|---|---|
| `bu` | `business_unit` |
| `dept` | `department` |
| `sub_dept` | `sub_department` |
| `shift_type` | **does not exist at all** |

Proof — calling the live login function:

```
fetch_directory() -> FAILS AT RUNTIME:
    column e.bu does not exist
```

| Broken function | Wrong reference | What users experience |
|---|---|---|
| `admin_create_employee` | `bu`, `dept`, `sub_dept`, `shift_type` | **Cannot add any employee** |
| `admin_update_employee` | same | **Cannot edit any employee** |
| `fetch_directory` | same | Login list degrades; **cannot search by employee number** |
| `manager_decide_leave` | `leave_applications.updated_at` | **Manager approval fails every time** |
| `admin_reset_leave_balances` | `audit_logs.performed_by` | **Financial Year Reset fails** |

**Consequences that trace directly back to this:**

1. **281 leave requests stuck on Pending.** Managers *are* clicking approve — it errors every time.
2. **131 employees, 1 leave balance record.** The Excel import updates the employee first, that throws, so it never reaches the balance step.
3. **Shift Type does nothing.** There is nowhere to store it. Every employee is permanently "No Shift" — which is also why night shift never works.
4. All three Excel importers fail on every row.

### 4.2 🔴 Attendance calculated wrongly

| # | Problem | Effect |
|---|---|---|
| 1 | `TODAY` uses UTC, computed once at page load (`App.jsx:73`) | Anyone punching between **00:00–05:30 IST records against yesterday**. Tab left open overnight keeps using the old date |
| 2 | `calcRawHrs` cannot handle overnight (`App.jsx:82`) | Night shift 21:00→06:00 computes as −15h → clamped to 0 → **always "Absent", always 0 hours** |
| 3 | Weekends and holidays counted as Absent | Monthly summaries and payroll reports inflate absences. `week_off` flag exists but is ignored |
| 4 | Half-day threshold hardcoded to 4.5h | Settings screen promises `stdHours ÷ 2`. Set 8 hours → UI says 4.0, code uses 4.5 |
| 5 | Excel import assigns everyone to `COMPANIES[0]` | All imported staff land in Asma Traexim regardless of real employer |
| 6 | Employees never see their own correction requests | The DB function `employee_get_regularizations` exists but **the frontend never calls it** |

### 4.3 🔴 Security

| # | Problem | Detail |
|---|---|---|
| 1 | **Employee PINs stored in plain text** | `employee_login` does `v_pin <> p_pin`. Admin PIN *is* properly hashed — employees were missed |
| 2 | Admin screen displays every PIN | `App.jsx:2681` |
| 3 | Anyone can forge audit log entries | `audit_logs` allows anonymous INSERT with no token check |
| 4 | Imported staff get guessable PINs | Last 4 digits of employee code — and the login screen publicly lists names + codes |
| 5 | Employee directory public | Names, codes, job titles, departments readable by anyone |
| 6 | Session token stored in plain `localStorage` | "Remember me" |

**Done correctly:** admin PIN hashing (pgcrypto), login rate limiting, token expiry (18h employee / 12h admin), and all 15 tables locked down with row-level security — access only via `SECURITY DEFINER` functions. **The security foundation is sound.**

### 4.4 🟠 Location capture — the weakest area

| # | Problem | Detail |
|---|---|---|
| 1 | **GPS coordinates thrown away** | Column is named `lat_lon` but stores a place *name*: `"Nagpur, नागपूर शहर तालुका, ... 440035, India"`. Checked all 40 records — **zero contain coordinates** |
| 2 | Nothing is ever verified | **No office locations exist anywhere in the database.** Punching from home is silently accepted |
| 3 | Low accuracy requested deliberately | `enableHighAccuracy: false` → guesses from cell towers, off by hundreds of metres. Same employee logs pin code `440035` some days, `440008` others |
| 4 | Same office, different names | `"...Shalimar Bagh, Saraswati Vihar Tehsil, North West Delhi..."` ×10 vs `"...Ashok Vihar, Shalimar Bagh, Central North Delhi..."` ×1 — same building. Text names are unusable as data |
| 5 | Accuracy value discarded | Cannot tell a 5m fix from a 5km fix |
| 6 | Duplicate punches | Live data: same person, `punch_in` at 03:47:54 **and** 03:48:22 |
| 7 | Background tracking unreliable | Browser timers stop when the phone locks. **A website cannot run in the background** — OS restriction, not fixable in code |
| 8 | OpenStreetMap abused | Every punch calls their free service from the browser. Against their terms; they will block it. Also sends staff locations to a third party |

### 4.5 🟠 Broken or misleading features

| # | Problem |
|---|---|
| 1 | **"Restore from JSON" is a fake button** — shows an alert, does nothing (`App.jsx:1353`) |
| 2 | **Two stat cards render unstyled** — `tailwind.config.js` safelist omits `blue` and `green`, used at `App.jsx:1875` and `2465` |
| 3 | Admin login loads **the entire attendance table** into browser memory, no paging — will not scale |
| 4 | Database exports silently capped at 100–200 rows — users believe they exported everything |
| 5 | Std-hours input fires a database write **on every keystroke** (`App.jsx:2357`) |
| 6 | Admin PIN change has no old-PIN check and no confirm field — **one typo locks you out permanently** |
| 7 | Manager and admin approvals are independent and can silently overwrite each other |
| 8 | Manager team data loads once via `setTimeout(…, 600)` and never refreshes — must log out and back in |
| 9 | Employee delete is permanent, despite an `active` flag existing |
| 10 | No error boundary — any crash shows a white screen |
| 11 | `alert()` used for errors in 15+ places, leaking raw database messages |
| 12 | No duplicate-leave check; no balance check on apply; partial-leave caps enforced only in the browser |
| 13 | Attendance year selector starts at current year — older data looks missing |
| 14 | `leaveBalEditor` mutates React state directly (`App.jsx:3018`) |
| 15 | Dead code: `navigator.geolocation._timeout` (`App.jsx:527`); duplicate "Database Summary" card |

### 4.6 Dead database functions

Never called by the app: `admin_fetch_all_leave_balances`, `admin_get_holidays`, `admin_get_location_logs`, `employee_fetch_leave_balances`, `employee_get_regularizations` *(this one should be wired up, not deleted — see 4.2 #6)*.

---

## 5. Data health — as of 2026-08-04

| Table | Rows | Note |
|---|---:|---|
| employees | 131 | |
| attendance | 336 | 17 Jun → 4 Aug |
| leave_applications | 290 | **281 Pending**, 8 Approved, 1 Rejected |
| **leave_balances** | **1** | ⚠️ should be ~1,000 |
| audit_logs | 1,837 | |
| employee_sessions | 617 | 608 expired, never cleaned |
| location_logs | 23 | |
| od_tracking_logs | 236 | |
| holidays | 10 | |
| regularization_requests | 2 | |

**Total: 3,640 rows** — small, so the migration will be quick.

### Blockers for the new email + approval flow

| Check | Result |
|---|---|
| Employees with an email address | **71 of 131** — 60 missing |
| Managers with **no** email | **4** — Sunil Kumar (13 reports), Ankur Hora (7), Prashant (7), Ritu Goyal (1) = **28 staff unreachable** |
| Employees with manager properly linked | 112 of 131 |
| Manager name typed but not linked | 16 |
| No manager at all | 3 |
| Pending leaves with no manager to route to | **49 of 281** |

> **Action for HR (not a coding task):** collect the 60 missing email addresses, especially the 4 managers. The email feature cannot work for those staff until this is done.

---

## 6. Decisions locked in

| # | Decision |
|---|---|
| 1 | **Punch screen shows all 3 office locations as tiles**, highlighting the one the employee is at |
| 2 | **Each office has its own radius**, editable from admin |
| 3 | **Outside the radius = punch rejected.** No warning, no override, nothing saved |
| 4 | **Field staff exempt** from the office check — must write a note instead (where they are / where going) |
| 5 | **2-hourly location tracking runs silently** — no indicator, no notice. Deliberate decision; see risk note below |
| 6 | Location log visible to **manager (own team only) and admin** |
| 7 | **App and biometric punches stored completely separately**, shown side by side |
| 8 | **Biometric stays official** for reports during the dual-run; flip to app via an admin switch when ready *(assumption — confirm)* |
| 9 | Two-stage leave approval: **manager first, then admin**, with email at each step |
| 10 | Database migrates to the new paid Supabase project **HRMS** |
| 11 | **Broken functions are fixed during the migration**, not copied across |
| 12 | **Half-day leave** available for **Casual, Sick and Earned** — First Half / Second Half / Full Day |
| 13 | Half day = **0.5 deducted**; employee must work the other half (Standard Hours ÷ 2) |
| 14 | Miss the half-day hours → **unpaid**, status becomes plain "Half Day" |
| 15 | Balances **carry forward month to month** within the leave year, then follow the lapse rules below |
| 16 | Quotas editable per employee — from the admin panel **and** directly in Supabase |
| 17 | **All three companies follow the same leave policy** (Asma Traexim's) — no per-company variants needed |
| 18 | The **full leave policy is shown as readable text inside every employee's panel**, so staff can refer to it any time |
| 19 | Every employee carries an **employment status tag** — new staff default to **Probation**; admin changes it to **Confirmed**. Drives the policy's 1-leave caps |

> **Risk noted on #5:** location is personal data under India's DPDP Act 2023. Covert tracking of staff on personal phones carries legal and trust risk. This was raised and the decision was reaffirmed — building as instructed. Mitigations applied anyway: tracking only between punch-in and punch-out, and 90-day automatic deletion.
>
> **Build constraint on #5:** the browser shows its own permission prompt on first use, and Chrome displays a location icon in the address bar while active. That is browser UI and cannot be suppressed by any app.

---

## 6A. Leave policy — the rules the app must enforce

Source: **ATPL|HR|22|1002 — Leave Management Policy, Asma Traexim Pvt Ltd.**

> ✅ **All three companies follow this same policy.** One rule set, no per-company variants.
>
> ✅ The full policy text is shown inside every employee's panel for reference.

### Leave year

- Runs **1 April → 31 March**
- Entitlement credited **in full on 1 April** (not monthly)
- "1 every month" / "½ every month" is the **pro-rata rate for part-year staff**, not a monthly top-up
- Unused balance **carries forward month to month within the year**, then follows the lapse rules

### Entitlements

| Leave | Per year | Half day? | Carry / lapse | Conditions |
|---|---:|:---:|---|---|
| Gazetted + Restricted Holiday | **8** | — | Calendar published before 1 April | |
| **Casual (CL)** | **12** | ✅ | **Lapses 31 March** | Pro-rata 1/month for part-year |
| **Earned (EL)** | **6** | ✅ | **Up to 3 paid out in May**, rest lapses | Pro-rata ½/month |
| **Sick (SL)** | **4** | ✅ | — | **Medical certificate** + Manager & HR approval |
| Marriage — family | **4** | ❌ | — | **18 months service** + invitation card |
| Marriage — self | **7** | ❌ | — | **18 months service** + invitation card |
| Maternity | **1 week paid** | ❌ | — | 18 months service · **max 2 children** · +15 days unpaid optional · +1 month WFH optional |
| Bereavement | **up to 4** | ❌ | — | Death of immediate family |
| Paternity | ⚠️ **not defined in policy** | — | — | Listed but no quota given |
| LOP / Unpaid | unlimited | — | — | Only when no other leave remains |

**Stated total: 26** = GH&RH 8 + CL 12 + EL 6. Sick, Marriage, Maternity and Bereavement sit **on top** of that.

### EL year-end payout

> Balance 5 EL at year end → **3 carried for payment**, **2 lapse**. Paid in May.

### Rules the app must apply

| Rule | Meaning |
|---|---|
| **Pre-approval required** | Leave must be applied and approved **at least a day before** |
| **Absence without approval** | **1 absent day = 2 days LOP** |
| **3 consecutive unapproved days** | Deemed terminated from the first day |
| **>5 continuous absent days** | HR letter triggered |
| **Probation** (3 months, extendable to 6) | **Only 1 leave**; beyond that is LOP. More than 5 leaves harms confirmation |
| **Notice period** | **Only 1 leave**; beyond that is LOP |
| **First year after joining** | Entitlement **pro-rata** from joining date |
| **LOP spans** | Week-offs and public holidays **inside** an LOP period also count as LOP |
| **Cancellation** | Department head may cancel a sanctioned leave; taking it anyway = absence |
| **Extension** | Needs prior approval; overstay = absence |

### Where the app disagrees with the policy today

| # | Gap |
|---|---|
| 1 | **No accrual at all.** Balances only arrive via Excel import — which is broken. Needs automatic crediting on 1 April, pro-rata for joiners |
| 2 | **No year-end processing** — CL lapse, EL payout of up to 3, rest lapse |
| 3 | **No half-day support** — needs a `day_part` column on `leave_applications` |
| 4 | **Balance is never deducted on approval** |
| 5 | **No document upload** — policy requires medical certificate (SL) and invitation card (Marriage). Needs Supabase Storage |
| 6 | **No service-length check** — 18 months required for Marriage and Maternity. `joining_date` exists and can drive this |
| 7 | **No probation or notice-period tracking** — both cap leave at 1. Neither field exists. Solved by the employment status tag (Decision 19) |
| 8 | **Same-day and backdated leave allowed** — policy requires a day's notice |
| 9 | **"Unpaid Leave" should be renamed "LOP"** to match the policy |
| 10 | **"Partial Leave – 1 Hour / 2 Hours" are not in the policy** — decide whether to keep |
| 11 | Policy quotas not reflected: app has no default quotas at all |
| 12 | **No LOP / absence penalty logic** — 1 absent = 2 LOP is unimplemented |

---

## 7. The plan

### Phase 0 — Safety net · do first

Nothing else is safe until this exists.

- [ ] `git init`, first commit, `.gitignore`
- [ ] Save the extracted schema into `supabase/migrations/` — **the entire backend currently exists only inside the live project and is not backed up anywhere**
- [ ] Create `.env.local` (the app cannot currently run without it)
- [ ] Delete stray `vite.config.js.timestamp-*.mjs`
- [ ] Move SheetJS from CDN to an npm dependency
- [ ] Add README

### Phase 1 — Migrate to the paid HRMS project

- [ ] Create/confirm HRMS project — **same region (Mumbai / ap-south-1)** so speed is unchanged
- [ ] Apply the schema **with the 5 broken functions corrected**
- [ ] Copy all 3,640 rows
- [ ] **Re-apply function permissions** — if `EXECUTE` is not granted to `anon`, every call returns 404 and the app looks completely dead. This is the classic Supabase migration failure
- [ ] Verify row counts match table by table
- [ ] Exercise all 59 functions against the new project
- [ ] Update `.env.local` and hosting environment variables
- [ ] Cut over on a Sunday or late evening — attendance is written all day
- [ ] Keep the old project running one week as fallback
- [ ] **Reset the database password afterwards** (it was shared during this work)

> ⚠️ **Superseded — see the block below.** This is now a fresh build, not a migration.

### Phase 1 (revised) — Build the HRMS database + seed it

No migration. A clean schema, then two small imports.

**Build**
- [x] Confirm HRMS project — Mumbai / ap-south-1 ✅
- [ ] Apply the **new schema**, designed for 300 users from the start (§8B) — none of the old broken columns carried forward
- [ ] Grant `EXECUTE` to `anon` on every function — miss this and every call 404s. The classic Supabase mistake
- [ ] Enable `pg_cron` for the cleanup jobs

**Seed — the only data that crosses over**

| From the old app | Rows | Notes |
|---|---:|---|
| `employees` | **131** | Names, codes, company, department, manager links, email, phone, joining date |
| `holidays` | **10** | Straight copy |

- [ ] Export employees + holidays from the old project
- [ ] Import into HRMS, **hashing the PINs on the way in** — the old ones are plain text, and this is the clean moment to fix it
- [ ] Re-link `manager_emp_id` after import so the manager chain survives new IDs
- [ ] **Generate leave balances fresh from the policy** — CL 12, EL 6, SL 4, pro-rata by joining date. Do *not* import the old `leave_balances`: it has 1 row and is meaningless
- [ ] Set employment status — existing 131 → **Confirmed**
- [ ] Load the 3 office sites

**Deliberately not carried over**

`attendance` · `leave_applications` (including the 281 pending) · `location_logs` · `od_tracking_logs` · `audit_logs` · sessions · sheet caches

- [ ] New Vercel project + environment variables
- [ ] **Reset the old database password** (it was shared during this work)

### Phase 2 — Correctness fixes

- [ ] Date handling in IST, recalculated live instead of once at page load
- [ ] Overnight shift hours (21:00 → 06:00)
- [ ] Add the missing `shift_type` column and wire the feature up
- [ ] Add **employment status tag** — same migration as `shift_type`:
  - `employment_status`: **Probation** (default for new staff) · **Confirmed** · **Notice Period** · **Exited**
  - `probation_end_date` — auto-set to joining date + 3 months, admin can extend to 6 per policy
  - `confirmed_on` — recorded when admin marks Confirmed
  - Coloured tag on the employee list + filter by status
  - Admin alert when probation is nearing its end
  - **Existing 131 staff default to Confirmed** — they are established; only new additions start on Probation *(confirm)*
- [ ] Exclude weekends and holidays from absence counts; honour `week_off`
- [ ] Half-day threshold driven by settings, not hardcoded
- [ ] Import respects the real company instead of defaulting to the first
- [ ] Wire up `employee_get_regularizations` so staff see their own requests
- [ ] Hash employee PINs; stop displaying them
- [ ] Lock down audit log writes
- [ ] Automatic cleanup of expired sessions

### Phase 3 — Location and attendance rebuild

**New `sites` table** — name, latitude, longitude, radius, active.

**Store the real numbers** — latitude, longitude, accuracy, matched site, distance, plus the address as a *cached label only*.

**The server decides, not the phone:**

```
Phone sends:  lat 28.704100 · lon 77.102500 · accuracy 12m
        ↓  server calculates
Head Office · 47m · inside ✅  →  punch accepted
                     outside ❌ →  punch rejected
```

- [ ] `sites` table + admin screen to manage the 3 offices and their radii
- [ ] Employee work mode: **Office / Field / Both**
- [ ] Punch screen showing 3 tiles with live distance
- [ ] Hard rejection outside radius (office staff only)
- [ ] Structured note required for field staff
- [ ] Request **high** accuracy; reject poor readings and retry
- [ ] Ignore duplicate taps
- [ ] **Separate app and biometric punches** — schema change; today one row per day means the Excel import overwrites app punches
- [ ] Side-by-side comparison view + mismatch report
- [ ] Admin switch for which source is official
- [ ] Silent 2-hourly capture, only while punched in, 90-day retention
- [ ] Manager view of own team's location log
- [ ] Reverse geocoding moved server-side, cached, non-blocking, off Nominatim
- [ ] Adoption dashboard — who is using the app vs the machine

**Fraud checks that genuinely work in a browser** (fake-GPS detection itself does **not** — that needs an installed app):

| Check | Catches |
|---|---|
| Impossible travel | Delhi 10:00 → Jaipur 10:15 |
| Identical coordinates | Real GPS never repeats to 6 decimals; fake apps do |
| Suspicious accuracy | Fake apps report unnaturally perfect values |
| Note vs actual area | Note says Gurgaon, coordinates say Nagpur |

Output is a **short daily review list**, not proof — a human decides.

### Phase 4 — Two-stage leave approval + email

```
Staff applies
     ↓  📧 email → manager + admin (with app link)
Manager approves in his staff panel
     ↓  📧 email → admin + staff
Admin gives final approval
     ↓  📧 email → staff
   ✅ Approved
```

- [ ] Extend leave status: Pending → Manager Approved → Approved / Rejected, recording **who** decided and **when**
- [ ] Rule for the 19 staff with no manager → route straight to admin
- [ ] Rebuild the manager panel around the new flow
- [ ] Admin sees the manager's decision before giving final approval
- [ ] Staff panel shows manager name + email, attendance, leaves taken, pending
- [ ] Email sending (Supabase Edge Function + provider — Resend suggested, free at ~25/day; needs DNS records on `ecoste.in`)
- [ ] Decide what happens to the **281 existing Pending requests** — bulk-action or migrate into the new flow
- [ ] Deduct leave balance on final approval — **currently never happens**
- [ ] Block applying with insufficient balance; enforce caps on the server

### Phase 4B — Leave policy engine

Everything in Section 6A. This is the largest single piece of new logic.

- [ ] `day_part` column: `full` / `first_half` / `second_half`
- [ ] Half-day picker for **Casual, Sick, Earned**; 0.5 deduction; other half must be worked
- [ ] New status **"Half Day Leave"** — distinct from "Half Day" (worked short, unpaid)
- [ ] Half-day threshold from **Standard Hours ÷ 2**, not the hardcoded 4.5
- [ ] Expected start shifts to the afternoon for First Half leave, so biometric does not flag them late
- [ ] One half-day per date; cannot combine with a full-day leave on the same date
- [ ] **Automatic crediting on 1 April** — CL 12, EL 6, SL 4, per policy
- [ ] **Pro-rata for joiners** — CL 1/month, EL ½/month from `joining_date`
- [ ] **Year-end run:** CL lapses · EL up to 3 carried for May payout, remainder lapses
- [ ] Document upload (Supabase Storage) — medical certificate for SL, invitation card for Marriage
- [ ] **18-month service check** for Marriage and Maternity
- [ ] Probation and notice-period fields → cap of 1 leave, remainder LOP
- [ ] Rename "Unpaid Leave" → **LOP**
- [ ] Enforce **pre-approval a day before**
- [ ] LOP spans week-offs and holidays inside the period
- [ ] Absence penalty: **1 unapproved absent day = 2 days LOP**
- [ ] Alerts: 3 consecutive unapproved absences · >5 continuous absent days → HR
- [ ] Leave cancellation by department head; leave extension request
- [ ] **"Leave Policy" page in the employee panel** — full policy as readable in-app text (not a PDF download), always available for reference

### Phase 4C — Daily report export

A **download button in the admin panel** with a date picker. Produces one Excel workbook covering everything that happened on that day.

**Generated in the database and streamed** — never assembled from what happens to be loaded on screen (§8B). So it is complete regardless of the one-month display ceiling.

**Five sheets in one workbook:**

| Sheet | Contents |
|---|---|
| **1 · Summary** | Headcount · present · absent · half day · leave · WFH · on duty · late · **punches outside office** · app vs biometric adoption |
| **2 · Attendance** | One row per employee — the full picture (below) |
| **3 · Location log** | Every ping that day — time, employee, coordinates, address, type (punch-in / punch-out / auto) |
| **4 · Leave** | Leave covering that day, plus requests raised that day with their approval stage |
| **5 · Exceptions** | Only the rows needing attention — outside-office punches, missing punch-out, app/biometric mismatches, suspicious GPS |

**Sheet 2 — columns per employee:**

```
Emp code · Name · Company · Department · Designation · Manager
Employment status · Work mode · Shift · Day type (working/week-off/holiday)

APP        in · out · location · site matched · distance · inside/outside
BIOMETRIC  in · out · late hrs · early hrs · work hrs · OT
OFFICIAL   which source counted · raw hrs · net hrs · overtime

Status · Leave type · Day part (full/first half/second half) · Leave reason
WFH · On Duty · Field note (where they are / going)
Location pings · Regularization raised? · Remarks
```

Sheet 5 is the one HR will actually live in — it surfaces the handful of rows worth chasing instead of scanning 300.

- [ ] Date picker + download button in admin
- [ ] Server-side generation, all five sheets
- [ ] Exceptions sheet logic
- [ ] *(optional)* scheduled version emailed to HR each evening

### Phase 5 — Restructure

Split `App.jsx` (3,056 lines) feature by feature, one slice at a time:

```
src/
  features/  auth · attendance · leave · employees · imports · admin · location
  components/   hooks/   lib/
```

- [ ] Error boundary
- [ ] Replace `alert()` with proper messages
- [ ] Remove dead code and duplicated blocks
- [ ] Fix the Tailwind safelist (`blue`, `green`)
- [ ] Remove or build the fake Restore button

### Phase 6 — Scale and hardening

- [ ] Paging on attendance — loading everything into the browser will not survive a year of data
- [ ] Exports stream fully instead of stopping at 200 rows
- [ ] Indexes for the reporting queries
- [ ] Soft delete for employees
- [ ] Confirm + old-PIN check on admin PIN change, with a recovery path
- [ ] Basic tests around hours, status and leave balance calculations
- [ ] Import progress bar and cancel

---

## 8. Three-day delivery plan

**Constraint: 3 days to a fully working system.**

### Honest scope assessment

94 tasks will not all fit in 3 days. The plan below delivers a **complete, working, correct system** and pushes genuinely optional work to a follow-up. Nothing essential is cut.

**Key change from the original ordering:** the **restructure moves to Day 1**. Building the location system, approval flow and policy engine into a 3,056-line single file would cost more time than the restructure itself. Doing it first is faster overall, not slower.

### Day 1 — Foundation and correctness

> Goal: safe, migrated, properly structured, and calculating attendance correctly.

| Block | Work |
|---|---|
| **Morning** | Phase 0 safety net · **fix the 5 broken functions** · re-run the leave balance import |
| **Midday** | **Restructure into the target folder layout** (Section 8A) |
| **Afternoon** | Migrate to HRMS + verify all 59 functions |
| **Evening** | Correctness: IST dates · night shift · weekends/holidays · `shift_type` · employment status tag · PIN hashing |

**End of Day 1:** 281 leave requests unblocked · staff can be added and edited · imports work · balances populated · running on HRMS · attendance calculating correctly · clean codebase.

### Day 2 — Location and approvals

> Goal: the two big features working end to end.

| Block | Work |
|---|---|
| **Morning** | `sites` table + admin screen · geofence on the server · punch screen with 3 tiles |
| **Midday** | Field-staff mode + note · accuracy handling · duplicate-tap guard |
| **Afternoon** | **Separate app and biometric punches** + side-by-side view · adoption dashboard |
| **Evening** | Two-stage approval (manager → admin) · staff panel · email notifications |

**End of Day 2:** office staff geofenced · field staff tracked with notes · app and biometric side by side · leave approvals flowing with email.

### Day 3 — Policy engine and hardening

> Goal: the leave policy fully enforced, then tested.

| Block | Work |
|---|---|
| **Morning** | Half-day leave · balance deduction on approval · accrual and pro-rata |
| **Midday** | Year-end lapse and EL payout · probation/notice caps · LOP rules |
| **Afternoon** | Leave Policy page · silent 2-hourly tracking · manager location view |
| **Evening** | Paging · indexes · error boundary · **full end-to-end testing** |

**End of Day 3:** leave policy enforced automatically · system tested and live.

### Pushed to follow-up — deliberately

These are real but not required for a working system:

| Item | Why it can wait |
|---|---|
| Document upload (medical certificate, marriage card) | Needs storage setup + UI. HR can collect on email meanwhile |
| Absence alerts (3 consecutive · >5 days) | Reporting can surface these manually at first |
| Full fraud-check suite | Coordinates are being stored correctly from Day 2, so the data is there to analyse later |
| Automated test suite | Manual testing on Day 3 covers the launch |
| Leave cancellation / extension requests | Admin can edit directly |
| Import progress bar | Imports work; they just lack a progress indicator |

### Must be answered before Day 1

**Phase 3 cannot start without the 3 office coordinates.** If `Q-1` is not answered by Day 2 morning, the whole location block stalls. Same for the hosting URL and DNS access for email.

See `PROGRESS.md` → Open Questions.

---

## 8A. Target folder structure

The restructure delivers this. Every file has one clear job.

```
att_leave_system/
├── plan.md                     what & why
├── PROGRESS.md                 where we are
├── README.md
├── .env.local                  (gitignored)
│
├── supabase/
│   ├── migrations/
│   │   ├── 0001_baseline_schema.sql
│   │   ├── 0002_fix_broken_functions.sql
│   │   ├── 0003_employee_shift_and_status.sql
│   │   ├── 0004_sites_and_geofence.sql
│   │   ├── 0005_attendance_split_app_bio.sql
│   │   ├── 0006_leave_two_stage_approval.sql
│   │   ├── 0007_leave_policy_engine.sql
│   │   └── 0008_indexes_and_retention.sql
│   ├── functions/              Edge Functions
│   │   ├── send-leave-email/
│   │   └── reverse-geocode/
│   └── seed/sites.sql
│
└── src/
    ├── main.jsx
    ├── App.jsx                 shell + routing only (~100 lines, from 3,056)
    │
    ├── lib/
    │   ├── supabase.js
    │   ├── constants.js        companies · leave types · shifts · statuses
    │   ├── datetime.js         IST dates · overnight hours · half-day threshold
    │   ├── geo.js              distance · accuracy · geofence helpers
    │   └── format.js
    │
    ├── api/
    │   ├── mappers.js          snake_case ↔ camelCase
    │   ├── auth.js
    │   ├── employees.js
    │   ├── attendance.js
    │   ├── leave.js
    │   ├── location.js
    │   ├── imports.js
    │   └── admin.js
    │
    ├── hooks/
    │   ├── useAuth.js
    │   ├── useAttendance.js
    │   ├── useLeave.js
    │   └── useGeolocation.js
    │
    ├── components/
    │   ├── ErrorBoundary.jsx
    │   ├── ui/                 Badge · Card · Button · Input · Modal · Table · Spinner
    │   └── layout/
    │
    └── features/
        ├── auth/               LoginScreen · AdminLogin
        ├── employee/           Dashboard · PunchPanel · AttendanceHistory
        │                       LeaveApply · LeaveBalances · MonthlySummary
        │                       Regularization · LeavePolicy
        ├── manager/            TeamPanel · TeamRequests · TeamLocationLog
        └── admin/              AdminPanel · Dashboard · AttendanceGrid
                                LeaveApprovals · Employees · Sites
                                Imports · Reports · Database · Settings
```

**Rules going forward:** business logic lives in `lib/` and the database, never in a component. Every database call goes through `api/`. No file over ~300 lines.

---

## 8B. Built for 300 users — schema & performance

**Target: ~300 staff, heavy concurrent use, fast data growth.**

The database must be shaped for this **before** the HRMS migration — migrating is the natural moment to apply it. Doing it afterwards means migrating twice.

### Growth projection at 300 employees

| Table | Rows / year | Note |
|---|---:|---|
| `od_tracking_logs` | **~1,267,000** | ⚠️ only if 5-minute field tracking is kept |
| `location_logs` | **~554,000** | 2-hourly + punches · **working days only** — fires only while punched in |
| `attendance` | **~109,500** | 300 × **365** — a row exists for **every calendar day**, including Sundays and holidays, marked as such |
| `employee_sessions` | ~75,000 | if never cleaned — today 608 of 617 are already dead |
| `audit_logs` | ~50,000 | |
| `leave_applications` | ~7,800 | 26 leaves each |
| **Total year 1** | **~2 million** | dominated by location tracking |

> **Attendance carries a row per employee per calendar day**, whatever the day is. Sundays, gazetted holidays and week-offs all get a row, flagged accordingly. So the table needs an explicit **`day_type`** — `working` / `week_off` / `holiday` — rather than inferring it. This is also what makes the "weekends counted as Absent" bug (§4.2 #3) properly fixable.

With 90-day retention on location data, **steady state drops to roughly 450,000** — very comfortable for Postgres, *provided* the query patterns are fixed.

### 🔴 The real bottleneck — not indexes, query shape

These three functions return **every row in the table** with no filter, no limit:

```
admin_get_all_attendance      →  109,500 rows/year, growing every year
admin_get_all_leaves          →    7,800 rows/year
admin_get_all_leave_balances  →   ~2,400 rows
```

The browser then holds it all in memory and filters client-side. At 300 employees that is tens of megabytes of JSON on every admin login — and it will crash phones before it troubles the server.

### ✅ Agreed fix — a hard one-month ceiling

**No screen ever loads more than one month of data.**

| Screen | Opens with | On demand |
|---|---|---|
| **Admin — attendance** | **Today only** — ~300 rows | "Load more" → month picker → ~9,300 rows |
| **Admin — leaves** | Pending + current month | Month picker |
| **Admin — location logs** | Selected day only | Day picker *(already works this way)* |
| **Admin — audit** | Latest page | Paginated |
| **Staff panel** | **Own current month only** — ~31 rows | Month picker |
| **Manager — team** | Team, current month | Month picker |

**Effect:** ~300 rows on open instead of 109,500 — a **365× reduction**, and it stays flat forever. Year 5 opens exactly like year 1.

```
admin_get_attendance(token, from, to, company, dept, emp_id, limit, offset)
```

Even the heaviest case — a full month, all 300 staff — is **9,300 rows**, and the existing company/location filters usually cut that much further.

### ⚠️ Exports are the exception — and must stay that way

Reports still need to cover any range: a full financial year, a quarter, every employee. Those are **generated in the database and streamed**, never assembled from whatever is on screen.

This matters because the app currently caps exports at 200 rows **while telling the user nothing** (§4.5 #4). People believe they exported everything.

| | Limit |
|---|---|
| On screen | **1 month — hard ceiling** |
| Export / report | **Any range** — server-generated |

### Summaries never load rows at all

Dashboard tiles, monthly totals and year-on-year views read from `attendance_monthly_summary` — one small row per employee per month. A twelve-month comparison costs **12 rows per person, not 365**.

### Peak load is a spike, not a steady stream

Attendance apps are bursty — **300 people punch between 08:55 and 09:15**, then again at 18:00. Everything else is quiet. The system must be sized for that spike, not the average.

Current compute is **Nano** (200 max client connections, pool size 15). For 300 staff this needs upgrading on the paid plan — **Small at minimum**, likely Medium. The app talks through PostgREST so browser users don't map one-to-one onto database connections, but throughput at the spike is the real test.

### Schema work required

**1. Summary tables instead of scanning raw rows**

`attendance_monthly_summary` — one row per employee per month holding present / absent / half-day / leave / WFH / OD / total hours / OT. Kept current by trigger. Dashboards and reports read this instead of scanning tens of thousands of rows.

**2. Indexes to add**

| Table | Index | Why |
|---|---|---|
| `leave_applications` | `(status)`, `(emp_id, date)`, `(date)` | Admin filters heavily by status |
| `regularization_requests` | `(emp_id)`, `(status)`, `(date)` | **No indexes at all today** |
| `location_logs` | `(date)`, `(captured_at)` | Admin views by date; cleanup by age |
| `od_tracking_logs` | `(date)`, `(ts)` | Same |
| `employee_sessions` | `(expires_at)` | Cleanup job |
| `admin_sessions` | `(expires_at)` | Cleanup job |
| `attendance` | `(date, emp_id)` | Range reports |
| `employees` | `(active)`, `(emp_num)` | `emp_num` drives all import matching |
| `holidays` | `(date)` | |

Already present and adequate: `attendance(emp_id)`, `attendance(date)`, `attendance(emp_id,date)` unique, `audit_logs(ts)`, `employees(company)`, `employees(manager)`, `leave_applications(emp_id)`, `location_logs(emp_id,date)`, `od_tracking_logs(emp_id,date)`.

**3. Retention and cleanup — scheduled via `pg_cron`**

| Data | Keep | Then |
|---|---|---|
| Location logs | 90 days | Delete |
| OD tracking logs | 90 days | Delete |
| Expired sessions | — | Delete daily |
| Audit logs | 1 year | Archive |
| Attendance | Forever | Archive after 3 years |

**4. Fix the spreadsheet caches**

`bio_sheet_cache`, `imported_sheet_cache` and `monthly_sheet_cache` each store an **entire uploaded spreadsheet as one JSON blob in a single row**. At 300 employees that becomes a large object rewritten on every import. Cap the preview to a few hundred rows, or move the file to Supabase Storage and keep only a reference.

**5. Reduce location write volume**

The single biggest lever. If 5-minute OD tracking is dropped in favour of the agreed 2-hourly capture, **yearly rows fall from ~1.8 million to ~630,000** — a two-thirds reduction with no loss of the agreed functionality.

### Not needed yet

**Table partitioning.** At ~450,000 steady-state rows with retention in place, plain indexed tables are comfortably fast. Revisit only if 5-minute tracking is kept, or after two years of growth.

---

## 8C. Engineering standards — built to stay bug-free

**Stated top priority: a bug-free app that is easy to debug and safe to change.**

The old app failed at exactly this. Columns were renamed, five functions were never updated, and **nobody found out for months** — because nothing was watching. Employee editing, all three imports, 131 leave balances and 281 leave requests all broke from one silent fault.

The rule below follows from that: **prefer a guardrail that makes a whole class of bug impossible over fixing one instance of it.**

### The four guardrails

**1. Schema ↔ code contract check** — *the one that would have caught everything*

An automated check that reads every database function and verifies **every column it references actually exists**. Runs before each deploy.

```
✗ admin_create_employee  →  employees.bu         MISSING
✗ manager_decide_leave   →  leave_applications.updated_at   MISSING
```

This exact check found all five broken functions in minutes. Making it permanent means that bug class can never return silently.

**2. Smoke test across every function**

After any schema change or deploy, call **all** functions with a valid token and confirm none error and none 404 (a missing `EXECUTE` grant is invisible until a user hits it).

**3. One name for one thing**

The five broken functions came from the same word meaning two things — `dept` in SQL, `department` in the table, `dept` again in JavaScript. Going forward: database columns are the single source of truth, and **all** conversion happens in `api/mappers.js`. Nowhere else.

**4. No magic numbers**

The half-day threshold was hardcoded `4.5` while the settings screen promised "standard hours ÷ 2". Both were visible, neither matched. Every rule value comes from `lib/constants.js` or settings — never typed inline.

### Code rules

| Rule | Reason |
|---|---|
| No file over ~300 lines | 3,056 lines is where bugs hide |
| No business logic in components | Rules live in `lib/` or the database, never in JSX |
| Calculations are **pure functions** | Hours, status, balances, distance — testable alone, no React, no network |
| Every database call goes through `api/` | One place to look when a call misbehaves |
| Server validates everything | Never trust the browser — geofence, balances and caps are all decided server-side |
| Errors carry context | *"Could not save punch: outside office radius (340m from Head Office)"*, not `alert(err.message)` |
| One migration per change, never edited after applying | History stays truthful |

### Tests — narrow and high-value

Not broad coverage. Only the calculations that quietly corrupt payroll if wrong:

- Work hours, **including overnight shifts** (currently returns 0)
- Day status — present / half day / absent / leave, **with weekends and holidays**
- Leave balance maths — accrual, pro-rata, half days, year-end lapse, EL payout
- Geofence distance and the inside/outside decision
- IST date handling **around midnight**, where the current bug lives

### Debuggability in production

- **Error boundary** — a crash shows a real message, not a white screen
- **Audit trail** on every write: who, what, when, from where
- **Import logs** kept per row, so a failed import says *which* row failed and why
- **Health check** page: database reachable · functions responding · last import · last cron run

> Every one of these is aimed at a specific failure this project already had. None are theoretical.

---

## 9. Still needed

| # | Item | From |
|---|---|---|
| 1 | **3 office locations** — name, coordinates, radius each | You |
| 2 | Confirm biometric stays official during dual-run | You |
| 3 | Where the app is hosted (Vercel?) — emails need a real link | You |
| 4 | Who has DNS access for `ecoste.in` (email setup) | You |
| 5 | **60 missing employee emails** — 4 of them managers | HR |
| 6 | Which of the 3 companies each employee really belongs to | HR |
| 7 | Decision on the 281 existing Pending leave requests | You |
| 8 | Confirm HRMS project created, region Mumbai | You |
| 9 | **Paternity Leave quota** — listed in the policy but never given a number | You / HR |
| 10 | **Maternity "1 week"** — 7 calendar days or 7 working days? | You / HR |
| 11 | ~~Do Metamask and Lamora use the same policy?~~ ✅ **Answered — all three identical** | — |
| 12 | Keep or drop **"Partial Leave – 1 Hour / 2 Hours"** (not in the policy) | You |
| 13 | Confirm Sick / Marriage / Maternity / Bereavement sit **on top** of the stated 26 | You / HR |
| 14 | Probation end date and notice-period status per employee — neither field exists today | HR |

**Fill in when available:**

```
Site 1:  name ______________  lat __________  lon __________  radius _____ m
Site 2:  name ______________  lat __________  lon __________  radius _____ m
Site 3:  name ______________  lat __________  lon __________  radius _____ m
```

*Google Maps → right-click the location → click the numbers to copy.*

---

## 10. Migration verification checklist

Run after cutting over to HRMS:

- [ ] Row counts match table by table against Section 5
- [ ] Employee login works — including wrong-PIN lockout
- [ ] Admin login works
- [ ] **Create an employee** (broken today)
- [ ] **Edit an employee** (broken today)
- [ ] **Manager approves a leave** (broken today)
- [ ] **Financial Year Reset** (broken today)
- [ ] Login list searchable by employee number (broken today)
- [ ] Punch in/out saves with real coordinates
- [ ] All three Excel imports process every row
- [ ] Leave balances actually populate
- [ ] Reports export correctly
- [ ] All 59 functions callable by `anon` — no 404s
- [ ] Old project kept as fallback for one week
- [ ] Database password reset

---

## Appendix — Reference

**Old project:** `attendance_tracker` · ref `pwoilxkcyqvvnwdqspos` · founderoffice-ecoste's Org · Free · Nano · ap-south-1
**New project:** `HRMS` · paid

**Tables (15):** admin_sessions, app_settings, attendance, audit_logs, bio_sheet_cache, employee_sessions, employees, holidays, imported_sheet_cache, leave_applications, leave_balances, location_logs, monthly_sheet_cache, od_tracking_logs, regularization_requests

**Views (2):** app_settings_public, employees_directory

**Leave types (12):** Sick · Casual · Earned · Unpaid · Bereavement · Marriage · Maternity · Paternity · Partial 1hr (max 2/month) · Partial 2hr (max 1/month) · Work From Home · On Duty

**Extracted schema files** (temporary — move into the repo in Phase 0):
`schema.sql` · `schema-report.md` · `schema.json`
