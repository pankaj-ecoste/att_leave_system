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
| 8 | **Resolved 2026-08-06, opposite of the original assumption:** whichever source an employee actually uses that day (app or biometric) becomes official — not biometric-by-default. Staff won't uniformly switch to the app, so defaulting to biometric would mean early app adopters' real, GPS-verified punches get silently ignored. Both readings are always kept regardless of which is official; admin can still override per-day via the switch (P3-12) |
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

## 6B. Work-mode tags & the 5-tile punch screen (refined 2026-08-05)

Worked out in conversation while building `P3-5`..`P3-9` (the coordinate-independent
half of Phase 3) — this is the locked design for `P3-1`..`P3-4`, still waiting on `Q-1`
(the 3 office coordinates) to actually build. Refines Decision 1 and Decision 4 above;
doesn't replace them.

### The tag

Every employee gets one tag, **set by Admin when the profile is created, editable later
but not meant to change often**:

| Tag | Meaning |
|---|---|
| **OS** — Office Staff | Works from one of the 3 offices |
| **FS** — Field Staff | Visits clients/sites, no fixed location |
| **WFH** | **Permanently** remote — this is their normal way of working, not a request |

This is the `employees.work_mode` column already added in
`0005_field_staff_and_geo.sql` (currently `office`/`field`/`both`) — it will need a
`wfh` value added when this lands, and the admin Employees form's "Work Mode" dropdown
already built is the same UI, just relabelled OS/FS/WFH.

### The punch screen — 5 tiles

Instead of one generic Punch In/Out panel, every employee sees tiles matching their tag:

```
OS  →  Office 1 · Office 2 · Office 3   (Decision 1 — highlights the nearest one)
FS  →  Field Staff                      (a note is required — Decision 4)
WFH →  Work From Home                   (their daily routine, not a request)
```

- **Office tiles**: GPS is checked against that office's radius. Outside it → punch
  rejected, no override (Decision 3, unchanged).
- **Field tile**: a short note is required ("where are you / where going" — Decision 4,
  unchanged). The punch is never rejected based on location.
- **WFH tile**: no office check either — this is their expected daily pattern.
- **GPS is captured on every tile, no exceptions** (Decision 5 — the silent 2-hourly
  tracking already applies to everyone regardless of tag).

### Handling a Field employee who's actually at the office that day

No manual "I'm at the office today" switch. Since GPS is captured on the Field tile
too, the server can silently check whether that day's coordinates happen to fall inside
an office radius, and label the record accordingly for reporting — without rejecting
the punch if they *aren't* there. Zero extra taps for the employee; better data for
Admin either way.

### Occasional WFH for an OS/FS employee is NOT a tile

That's already the existing "Work From Home" **leave type** — applied for in advance,
approved by the manager, and once approved the day's status is already set to WFH
automatically (`lib/datetime.js`'s `calcStatus` already does this — untouched, no
change needed here). The WFH *tile* is only ever shown to employees tagged `WFH`
(permanently remote); everyone else requesting an occasional work-from-home day goes
through that existing approval flow, not a self-service tile.

### Admin visibility — Field Staff surfaces first

On the admin's daily attendance/log view, entries from Field-tagged employees sort to
the top, each showing the note and the captured location together — so Admin's eye
goes straight to the handful of entries that need a judgment call (does the note match
where the GPS says they actually were?) instead of scanning past every ordinary office
punch. This is the practical form of the "note vs actual area" fraud check already
listed in Phase 3 below (`Note says Gurgaon, coordinates say Nagpur`).

### Open, for when `P3-1` starts

Whether Field-tagged employees should also see the 3 office tiles as an option (so a
day spent genuinely at the office gets the real geofence check instead of just a
plausibility label) — leaning no, since the auto-detect-and-label approach above gets
the same reporting value without adding a manual step; revisit if it turns out Admin
wants the stronger guarantee for those days specifically.

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
- [ ] Employee tag: **OS / FS / WFH**, admin-set at creation, editable — see §6B for the full design
- [ ] 5-tile punch screen: 3 office tiles (OS) · Field tile (FS, note required) · WFH tile (WFH tag only) — §6B
- [ ] Hard rejection outside radius (office tiles only)
- [ ] Structured note required for the Field tile
- [ ] Auto-detect + label when a Field-tagged employee's GPS happens to match an office that day — no manual switch, never rejects (§6B)
- [x] Request **high** accuracy; reject poor readings and retry — done in `0005_field_staff_and_geo.sql` / `useGeolocation.js` (P3-7)
- [x] Ignore duplicate taps — done, client in-flight guard + server-side cooldown in `employee_punch` (P3-8)
- [ ] **Separate app and biometric punches** — schema change; today one row per day means the Excel import overwrites app punches
- [ ] Side-by-side comparison view + mismatch report
- [ ] Admin switch for which source is official
- [ ] Silent 2-hourly capture, only while punched in, 90-day retention
- [ ] Manager view of own team's location log
- [ ] Admin daily log sorts Field-tagged entries first, with note + captured location shown together (§6B)
- [x] Reverse geocoding moved server-side, cached, non-blocking, off Nominatim — `reverse_geocode()` RPC + `geocode_cache` table, live-verified (P3-9)
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

## 11. V2 — HR Enhancement Requirements (added 2026-08-10)

**Status:** scoped and locked in, per `PROGRESS.md` → **📅 V2**. Nothing built yet.

The app has been live and stable since 2026-08-07 (see the Day 3 build above). On
2026-08-10 HR submitted 6 new requirements — company structure, leave balance logic, a
new leave type, overtime tracking, birthday notifications, and asset management. Each
was brainstormed and scoped against the *live* system, item by item, before any code —
same rule as the rest of this project: settle the *why* and the edge cases first.

### V2 decisions locked in

| # | Decision |
|---|---|
| 1 | **"Asma + Production Plant" is a 4th value in the existing `COMPANIES` list**, not a new entity — `employees.company` is already free text, so the tile itself needs no schema change |
| 2 | Plant employees are moved into the new tile **manually, one at a time**, via the existing Edit Employee screen — no bulk-migration tool |
| 3 | The 8 restricted leave types for Plant (BL, ML, MT, PT, P1, P2, WH, OD) are hidden **and blocked server-side** in `employee_apply_leave` — hiding in the UI alone isn't the pattern this app uses; every other guardrail (probation cap, pre-approval, half-day rules) is enforced at the database layer, not just the screen |
| 4 | Plant history involving those 8 types, if any exists before the policy lands, is **left untouched** — the restriction is forward-only |
| 5 | CL/EL move from the current **annual lump-sum-on-1-April** model to **monthly crediting** (CL +1/month, EL +0.5/month), carried forward, with applications capped by the employee's **current ledger balance**, not the annual quota |
| 6 | The existing year-end **EL-payout-cap-at-3** rule (§6A — "Balance 5 EL at year end → 3 carried for payment, 2 lapse") **stays exactly as-is**. Only the crediting *cadence* changes, from once-a-year to monthly — the year-end lapse logic itself is untouched |
| 7 | Sick Leave is **not** touched by this change — stays a flat 4/year, no ledger |
| 8 | New joiners are **pro-rated in their first month**, same rule already live (`months_remaining_in_fy()`, P4B-7) — the ledger model doesn't change this |
| 9 | The ledger/balance-cap logic applies **uniformly to Plant employees too** — Plant only loses the 8 named leave types (Decision 3), nothing else about how CL/EL/Sick work for them changes |
| 10 | New leave type **Compensatory Leave (Comp-Off)**: 1 credit per full day (≥ `stdHours`) worked on a Sunday or a listed holiday |
| 11 | Comp-off is **applied exactly like Casual Leave** — normal apply → manager → admin approval flow — but blocked if the employee's comp-off balance is 0 |
| 12 | Comp-off unused at month-end **auto-converts to a payout record**, same posture as the existing `leave_payouts` table (P4B-6 / `0014`) — the system records it, HR still does the actual payroll entry manually. **No separate "choose leave or payout" screen** — the employee's only real choice is *when during the month* to use it as leave |
| 13 | **Overtime = hours worked beyond `stdHours`** (Settings-driven, same threshold for everyone including Plant — no per-company override) |
| 14 | OT is **tracking only** in this phase — no payroll integration, matching every other money-adjacent feature already in this app (EL payout, the LOP/absence report) |
| 15 | OT surfaces in three places: the staff's own "My Overtime" view, an admin report, and a **new column + summary total in the existing Daily Report export** (`Reports.jsx`, the 5-sheet workbook from P4C) — not a standalone feature disconnected from reporting |
| 16 | **Date of Birth** is a new nullable `employees` column, added to the Add/Edit Staff form |
| 17 | The birthday banner and admin alert are **computed live** off today's date whenever a dashboard loads — no cron job, no stored "shown today" flag, nothing that can silently fail overnight the way a missed cron run would |
| 18 | The birthday banner shows for **all companies, including Plant** |
| 19 | The birthday message text lives in **Settings** (editable), same pattern as the existing Admin Notification Email field — ships with a placeholder until HR confirms final wording, no code change needed when they do |
| 20 | The admin's birthday alert gets a **"mark as done"** action, per employee per day |
| 21 | New `employee_assets` table — **free-text** entries (type, serial, date assigned, status, assigned-by), deliberately not a predefined dropdown (your call, overriding the recommended default) |
| 22 | Assets are **editable by admin/HR** from the employee profile; **staff can view their own, read-only** |
| 23 | Exit/offboarding ties in as **one confirmation flag** — admin marks "all assets returned" when an employee's status is set to Exited, not per-item return dates |

### Open, not a build blocker

| Item | Status |
|---|---|
| Final birthday message wording (placeholder: *"Happy Birthday [Name]! May Supreme Energy bless you. We are thankful to have you in our workspace. — By Ankur Hora and Team"*) | Ships as an editable Settings field — HR can update the text any time, no code change needed |

### How this interacts with the existing leave policy (§6A)

The only rule in §6A that V2 changes is the **crediting cadence** for CL/EL — front-loaded
once a year becomes monthly. Every other rule in that section — the 1-day pre-approval
requirement, probation/notice caps, LOP spanning week-offs, the 18-month service check,
the 3-consecutive-day and >5-day absence rules — is untouched.

---

## 12. V3 — HR Enhancement Requirements (added 2026-08-17)

**Status:** 10 items scoped and locked in below. Same rule as V2: settle the *why* and
edge cases in discussion first, write the decision here, build after.

### V3 decisions locked in

| # | Decision |
|---|---|
| 1 | **Partial Leave (1hr/2hr) can be applied for today**, not just future dates. Today `employee_apply_leave` requires every leave type except Sick/Bereavement/WFH/On Duty/LOP/Earned Leave to be applied **at least 1 day in advance** (`v_date < current_date + 1` → rejected) — Partial Leave was never added to that exemption list, so HR staff hit "must be applied at least a day in advance" when trying to apply for an hourly leave the same day it's needed. Fix: add both Partial Leave types to the exemption, but with their **own lower bound of "today", not "no bound"** — a new dedicated check blocks only genuinely *past* dates for these two types (`v_date < current_date` → rejected with "cannot be applied for a past date"), so today and any future date both work, matching how Earned Leave gets its own dedicated advance-notice rule rather than reusing Sick Leave's unrestricted one. This was **not** about letting the 1hr and 2hr types be combined on the same date (an earlier misread during discussion) — it's purely about removing the 1-day-advance wait for these two types |
| 2 | **A punched-in employee (in-punch recorded, no out-punch yet) must never display as Absent** — confirmed live via screenshot (Shalini Vishwakarma, IN 09:02, Status showed "Absent"; admin dashboard's "Present" tile also read 0 despite people having punched in). Root cause: `calcStatus` (`lib/datetime.js`) computes hours-worked as `out time − in time`; with no out-punch, that's `0`, which falls below the half-day threshold and returns `Absent`. This status is written to the `attendance.status` column the moment the employee punches in (`useEmployeeAttendance.js`), so every screen reading that stored value — staff panel, admin dashboard, admin attendance grid — shows the same wrong "Absent" simultaneously. **Fix, chosen over just showing "Present":** a new distinct status, **"Punched In"**, returned by `calcStatus` whenever `inTime` is set and `outTime` isn't — skips the hours math entirely rather than running it against a missing out-time. The moment the employee punches out, `calcStatus` runs again with the real out-time and settles into the correct Present/Half Day/Absent, same as it already did before this bug was found — only the *in-progress* window was ever wrong. Gets its own badge color (blue) alongside the existing Present/Absent/Half Day/Leave/WFH/On Duty palette. The admin dashboard's "Present" stat tile (already labeled "Punched in today") counts **both** "Present" and "Punched In" so the number matches its own subtitle; the "Absent" tile now only ever means "no punch at all today". Deployed 2026-08-17 (`ac604d5`) along with decision 1; a live data correction also fixed 35 already-mis-stored "Absent" rows for that day |
| 3 | **"On Duty" stays** — reconsidered mid-discussion after an earlier draft of this decision proposed removing it as redundant with the Field Staff punch tile (§6B). The user pointed out a real, distinct case it still covers: a regular (non-Field-tagged) employee who goes straight from home to a client/vendor without ever coming to a physical office — On Duty is how that day gets recorded as legitimate work, not Absent. **No removal.** The only change: the admin dashboard's "Present" stat tile now also counts `status === 'On Duty'` (alongside "Present" and "Punched In" from decision 2), so the summary number reflects everyone who's actually working that day. The row-level badge/label stays exactly "On Duty" — not relabeled to "Present" — so admin can still see at a glance who's out on official duty vs. at their desk. Scoped to `Dashboard.jsx` only; the dedicated "On Duty" tile/column and all reports (Reports.jsx, TeamPanel, AttendanceGrid, MonthlySummary) are untouched |
| 4 | **Leave approval: manager and admin get fully equal, independent authority** — today, `admin_decide_leave` is blocked from acting until the employee's manager has approved first ("Waiting on manager approval first"), so a busy/unresponsive manager stalls the whole request. Fix: whichever of manager or admin decides *first* (Approve or Reject) fully finalizes the leave application immediately — balance deduction and the attendance-record write (previously only inside `admin_decide_leave`) move into one shared internal function, `apply_leave_approval_effects`, called by both `manager_decide_leave` and `admin_decide_leave` on approval. Once either has decided, `status` is immediately `Approved`/`Rejected` (no more interim "Manager Approved" waiting state for *new* decisions) and the other party is locked out ("Already decided"). The manager retains full visibility into their team's requests regardless of who ends up deciding (`TeamPanel`'s "Requests" tab is unaffected). Historical rows already sitting in the old interim `Manager Approved` state remain valid and still appear in the admin's actionable queue so that backlog isn't stranded. Admin's screen (`LeaveApprovals.jsx`) drops the old "Awaiting Manager — not yet actionable" split queue, since nothing is ever off-limits to admin anymore; it shows the manager's decision (if any) as an informational note, not a gate |
| 5 | **Hard-block a punch-out within 5 minutes of punch-in** — HR reported staff sometimes hit Punch In and Punch Out back-to-back by mistake. New rule, checked both client-side (`useEmployeeAttendance.js`, instant feedback, reusing the existing `calcRawHrs`) and server-side (`employee_punch`, the real guardrail — same "don't just hide the button" posture as every other rule in this app): if a punch-out is attempted less than 5 minutes after that day's recorded punch-in, it's rejected outright with a clear message, not a dismissible warning. Overnight shifts are unaffected — the gap is only computed forward from in-time to out-time, so a wrapped (next-day) out-time is never mistaken for a same-moment double-tap |
| 6 | **Admin dashboard stat tiles undercounted almost everyone — 137 active employees, but Present/Absent/Half Day/WFH/On Duty tiles only summed to 39.** Confirmed live via screenshot (Present 36, Absent 2, On Duty 1, everything else 0 — 98 employees invisible to every tile). Root cause: the tiles were built from `Object.values(attendance)` — literally only rows that already exist in the database for today. An employee who simply hasn't punched in yet has **no row at all** until they do, so they were invisible to every tile, including Absent. The table underneath the tiles never had this bug — it already looped over every active employee and defaulted a missing record to `{}`, with `Badge status={r.status || 'Absent'}` correctly showing Absent for someone with nothing recorded. **Fix:** the tiles now use the exact same loop-over-every-active-employee-and-default-to-`{}` approach the table already used (extracted into one shared `todayRecordFor` lookup, also reused by the existing click-a-tile-to-filter list so all three — tiles, filtered list, table — can never disagree again), and the `absent` predicate now explicitly treats a missing status as Absent (`(r.status || 'Absent') === 'Absent'`), matching the table's own fallback instead of silently requiring a real stored `'Absent'` row. Frontend-only, no migration |
| 7 | **Office locations should display as their site name, not a raw reverse-geocoded address** — the Database → Location Logs tab, the manager's Location tab, and the daily Report's "Location Log" sheet all showed the full messy address text for every entry, whether it was a normal office punch or a genuinely off-site one. Rule: if a location's GPS point falls inside a known site's radius, show that site's short name (live data: `ECOSTE`, `MetaMask`, `PLANT SONIPAT HARYANA`) — otherwise show the full address, exactly as today. Driven by where the point actually is, reusing the existing `nearest_active_site` function (already used by `employee_punch` for the geofence check), not by the employee's work-mode tag — so Field and WFH staff naturally always show the full address (they're essentially never inside a site radius) without needing a separate rule for them, and an Office-tagged employee whose ping doesn't match anything still correctly falls back to the address rather than being mislabeled with a site name that isn't true. Also fixes a real pre-existing gap in the Monthly Register export's `registerLocationCell` (Reports.jsx): it already had this exact site-name-vs-address logic for office/field, but WFH fell into the office branch by omission, showing "Outside" instead of their home address. **Follow-up fix, found while verifying this live:** the location log written at the moment of punch in/out called the raw `employee_log_location` RPC directly instead of the existing `employeeLogLocation` API wrapper, silently dropping the `meta` (lat/lon/accuracy) it already had in hand — so a punch-time entry could never resolve to a site name, only the 2-hourly auto-tracking could. `useEmployeeAttendance.js`'s `punch()` now goes through the same wrapper the auto-tracking already uses |
| 8 | **A dedicated Field Staff view on the admin dashboard** — not a new tile in the top row (would just repeat a headcount the Employees list already shows), but a 9th entry in the existing click-a-tile-to-filter-the-table pattern. When active, the table's columns swap to show, side by side, what the employee typed at punch time (the required field note — "where are you / where going") next to what GPS actually captured (the address, per decision 7) — the practical form of the "note vs. actual location" check plan.md §6B already envisioned but never built a screen for |
| 9 | **WFH tile missed every permanently-remote employee** — it only counted `attendance.wfh`, set exclusively when an approved WFH *leave application* lands (someone not normally remote, taking an occasional WFH day). An employee whose permanent tag is `wfh` (plan.md §6B — "this is their normal way of working, not a request") just punches in like anyone else; that punch never touches `attendance.wfh` at all, so the tile stayed at 0 even with 5 such employees active in the database. Fix, same shape as decision 3's On Duty fix: `wfh: (r, e) => r.wfh || e.workMode === 'wfh'` — covers both "approved WFH leave today" and "this is a WFH-tagged employee," matching how the Field Staff tile (decision 8) already counts by tag alone |
| 10 | **15-minute grace period on the Half Day boundary, plus a fix so Partial Leave actually works as "early leave" (HR request 2026-08-19).** Today `calcStatus` (`lib/datetime.js`) marks **any** shortfall against `stdHours` (9h) as Half Day, even a 5-10 minute miss — no forgiveness at all. New rule, confirmed with HR: a shortfall of **up to `GRACE_PERIOD_MIN` (15 min)** is absorbed automatically — day still shows **Present**, no leave needed. A shortfall **beyond** 15 min needs an applied **Partial Leave – 1 Hour / 2 Hours** to cover it (staff picks whichever matches how early they left); if applied and it covers the gap (plus the 15-min grace), the day shows Present. If nothing is applied, or the applied type doesn't fully cover the gap, the day falls through to Half Day/Absent exactly as it does today — unchanged. **Bug found and fixed along the way:** Partial Leave's `deduct` value (1 or 2 hours, `constants.js`) was being *subtracted* from hours actually worked before the Half Day comparison (`eff = cappedRaw - deduct`) — the opposite of what a leave meant to excuse early departure should do. That made applying Partial Leave push a day *closer* to Half Day, not away from it, so the feature never worked as "early leave" cover in the first place. Fixed by crediting `deduct` back against the shortfall instead. Scoped to `calcStatus` only — `calcOvertimeHours` (OT math) is deliberately untouched, so Partial Leave still doesn't earn OT credit for the excused hour, matching its existing behavior. No SQL/migration involved — this status logic is purely client-side, computed fresh from `inTime`/`outTime` every render, never stored precomputed |

---

## 13. Employee "session expired" confusion (HR/staff-reported, added 2026-08-20)

**Reported symptom:** staff open the app, still see their name/avatar and a working Logout
button (looks logged in), tap Punch In, and get a small message reading "Invalid or expired
session" near the punch buttons. Non-technical staff don't know what this means or that
logging out and back in fixes it, so it gets reported as "the app is broken." Confirmed live
via screenshot (Khushboo, 2026-08-20, punch buttons all live but a blue "Invalid or expired
session" strip sitting where the result of the tap should show).

**Root cause, traced through the actual code:**
1. `employee_sessions.expires_at` (`0001_baseline_schema.sql`/`0002_hrms_schema.sql`) defaults
   to `now() + 18 hours`, set once at login and never extended by activity. Anyone who logs in
   once and comes back roughly a day later (the normal daily-use pattern) already has a dead
   token.
2. `useAuth.js` restores `{token, empId}` from `localStorage` on app load and treats it as a
   valid login without ever checking the server — so the UI shows fully logged-in even when
   the token is already dead.
3. When the dead token is finally used (e.g. Punch In), `employee_punch` raises the Postgres
   exception `Invalid or expired session` (`is_valid_employee_token`, e.g.
   `0032_punch_gap_and_equal_leave_authority.sql:41`), and `useEmployeeAttendance.js`'s `punch()`
   dumps that raw message straight into the on-screen status line (`setLocationStatus(e.message
   || ...)`) with no recovery — the employee is left stuck on a dashboard that looks fine but
   silently can't do anything.

**Decisions locked in:**
- **Employee session lifetime: 18 hours → 30 days.** One-line change to the
  `employee_sessions.expires_at` column default (new logins only; already-issued tokens keep
  their original 18h expiry until they naturally lapse once, after which the graceful-recovery
  fix below takes over). This alone makes the bug rare to the point of practically not
  happening under normal day-to-day use.
- **Admin/HR sessions (`admin_sessions`, 12h) are explicitly out of scope for this fix** — same
  underlying mechanism, but not reported as an issue and left untouched, matching the
  "don't alter flows that aren't broken" constraint.
- **Graceful recovery for the rare case a session does expire** (e.g. an employee back from a
  week of leave): detect the exact employee-session-expired error centrally, at the one place
  every API call already funnels through (`supabase.rpc` in `lib/supabase.js`), rather than
  touching each of the ~30 call sites across `src/api/*.js`. On detection: clear the stale
  `localStorage` session, drop the app back to the login screen automatically, and show a
  plain banner — "Your session expired — please log in again" — instead of a raw Postgres
  message. No manual Logout-then-Login dance required.
  - Matched only on the exact employee-facing message `Invalid or expired session` — the admin
    equivalents are always phrased `Invalid admin session` / `Invalid or expired admin session`
    (distinct wording, confirmed in `0001_baseline_schema.sql`), so this can't accidentally
    fire for/affect the admin panel.
  - `useEmployeeAttendance.js`'s punch-error handler skips writing the raw message to
    `locationStatus` when it's this specific error, since the screen is about to be replaced by
    the login redirect anyway.
- **No other flow touched.** Login, logout, punch-in/out, geofencing, leave, and every other
  RPC call keep calling `supabase.rpc` exactly as before — the wrapper only observes the result
  and passes it through unchanged unless this one specific message is seen.

**Files touched:** new migration `supabase/migrations/0034_...sql` (session lifetime),
`src/lib/supabase.js` (central detection + event dispatch), `src/hooks/useAuth.js` (listen for
the event, clear session, expose the banner message), `src/features/auth/LoginScreen.jsx`
(render the banner), `src/App.jsx` (wire the message through), `src/hooks/useEmployeeAttendance.js`
(skip the redundant raw-message flash).

---

## 14. Monthly Attendance Register — HR readability update (added 2026-08-26)

**Reported ask:** HR opens `attendance_register_YYYY-MM.xlsx` (built by `exportMonthlyRegister` in
`src/features/admin/Reports.jsx`) and finds it hard to read: no visible separation between one
day's columns and the next, and no way to tell at a glance which columns are a Sunday or a
holiday (currently every day just shows a plain date header).

**Current layout (as of the file HR shared, `attendance_register_2026-08.xlsx`):** one row per
active employee; 4 columns per calendar day — `<Mon> <D> In`, `<Mon> <D> In Loc`, `<Mon> <D>
Out`, `<Mon> <D> Out Loc` — followed by summary columns (Present, Half Day, Leave, Absent, Total
Hours, Total Overtime). 31 days × 4 = 124 day-columns, ~134 columns total.

**Decisions locked in:**
1. **Drop the two location columns.** Each day becomes 2 columns instead of 4: `In`, `Out` only
   (no `In Loc` / `Out Loc`). Halves the day-columns from 124 to 62.
2. **Visible boundary between days.** A dark/thick border runs down the left edge of every day's
   2-column block (i.e. before its `In` column) and along the outer right edge of the last day,
   from the header row through the last employee row — so each day reads as one visually boxed
   unit, distinct from its neighbors.
3. **Sunday / Holiday columns get a header tag + a fill color**, applied to the day's whole
   2-column block (header + every data row below it):
   - Sunday (plain `getDay() === 0`, no DB lookup needed): header reads `"<Mon> <D> (Sun)"`,
     light gray fill.
   - Holiday (date found in the `holidays` table, already fetched app-wide via
     `fetchHolidays()`/`useAuth.js`/`useAdminData.js` but not currently passed into `Reports`):
     header reads `"<Mon> <D> (Holiday)"`, light amber fill — same color family
     `format.js` already uses for the `Holiday` status elsewhere (sky/amber), distinct from
     Sunday's gray so HR can tell the two apart at a glance.
   - If a date is both a Sunday and a listed holiday, Holiday styling wins (rarer, more specific,
     more useful to flag).
   - Date always stays visible in the header (append the tag, never replace the date) — locked
     via user confirmation.
4. **Reports.jsx needs the `holidays` list.** `Reports` is currently instantiated without it in
   `AdminPanel.jsx`; add `holidays={admin.holidays}` to that call site and accept `holidays` as a
   new prop on `Reports`.

**Technical constraint found + resolved:** the app's existing Excel writer is `xlsx` (SheetJS
Community Edition, pinned to the CDN tarball in `package.json`). Verified directly (wrote a cell
with `fill`/`border` in its `s` property, inspected the raw `xl/styles.xml` inside the output
file) that **CE silently drops all cell styling on write** — no fill or border ever reaches the
file, regardless of what's set. Styling is Pro-only in that library. Resolution: add `exceljs`
(MIT, free) as a second dependency, used only inside `exportMonthlyRegister`'s `xlsx` branch —
every other export in `Reports.jsx` (daily report, overtime, ledger, single-day/range) keeps
using the existing `xlsx` library unchanged, since none of them need styling.
- Confirmed `exceljs` bundles cleanly through this project's Vite setup: its `package.json`
  `"browser"` field points bundlers at a prebuilt `dist/exceljs.min.js`, so Vite's default
  browser-field resolution picks it up automatically — test build succeeded with no Node
  polyfill errors (`fs`/`stream`/etc. never enter the graph). Output is built with
  `workbook.xlsx.writeBuffer()` (no filesystem calls) and turned into a downloadable `Blob`, the
  same client-side download pattern the rest of the file already uses.
- `npm audit` after adding it: one new moderate advisory (`uuid`, a transitive dep) — everything
  high/critical in the audit output is pre-existing dev-tooling (vite/vitest/esbuild), unrelated
  to this change.
- The register's `csv` export path is untouched — CSV has no concept of cell styling, so it stays
  on the simple `downloadRows` path exactly as today (still gains the In-Loc/Out-Loc column
  removal, since that's a data change not a styling one).

**Not changed:** every other report/export in `Reports.jsx`; the underlying attendance data model;
`registerLocationCell` (deleted — no longer called once the two Loc columns are gone).

**Files touched:** `src/features/admin/Reports.jsx` (`exportMonthlyRegister` rewritten to build
the xlsx with `exceljs` styling; `registerLocationCell` removed; new `holidays` prop),
`src/features/admin/AdminPanel.jsx` (pass `holidays={admin.holidays}` to `<Reports>`),
`package.json`/`package-lock.json` (`exceljs` added).

---

## 15. Ongoing bug fixes — admin/staff reported (added 2026-09-03)

Small issues reported piecemeal by admin and staff, fixed one at a time. Each entry: what was
reported, root cause, decision, files touched.

### 15.1 Future-dated punch — Shashi showed "Present" on 2026-09-20 while actually absent on 2026-09-03

**Reported by:** Admin, via screenshot of the Attendance grid — a row dated `2026-09-20` for
employee Shashi showing status `Present`, `In: 09:39`, while the real date was 2026-09-03 (17
days earlier) and she had no punch at all that day.

**Root cause:** The attendance `date`, `in_time`, and `out_time` written on every punch are all
read from the **employee's own phone clock** (`todayIST()` / `new Date()` in
`useEmployeeAttendance.js`) and sent to the server as-is. `employee_punch`
(`0032_punch_gap_and_equal_leave_authority.sql`) inserts `(p_data->>'date')::date` and the
in/out times exactly as received — nothing on the server checks that the submitted date is
actually today, or even that it isn't in the future. A misconfigured device clock (common on
field-staff phones) silently files the punch under whatever wrong date the phone believes it is.
This is a systemic gap: any employee's punch can land on any past/future date if their phone's
clock is off, not just Shashi's case.

**Decision:** The server becomes the sole source of truth for punch date/time. `employee_punch`
computes `date`, `in_time`, and `out_time` itself from the database server's own clock (converted
to IST), and ignores whatever date/time value the phone sends in `p_data`. This matches the
"server decides, not the phone" principle already used for the duplicate-punch cooldown check in
the same function, and closes the entire bug class (past-dated and future-dated punches alike) in
one place rather than special-casing this one report.

**Cleanup:** Delete Shashi's stray `2026-09-20` attendance row — bad data from a misconfigured
clock, not a real punch.

**Files touched:** new migration (`employee_punch` redefined to use server clock for
date/in_time/out_time instead of `p_data`), one-off cleanup script to delete the bad row.

**Follow-up audit (same day, admin asked to confirm this class of error can't recur):**
queried the live database for every function that writes `attendance`, `location_logs`,
or `od_tracking_logs` and checked which ones derive a "today" date from the caller
instead of the server. Found the *same* unvalidated-client-date bug in two more
functions — `employee_log_location` and `employee_log_od_location` (the 2-hourly GPS
trail, plan.md §12 "silent GPS trail" and On Duty tracking) — both took `p_date`
straight from the phone with no server check. Confirmed this was already live, not
hypothetical: `location_logs` had one row (Rahul Das) dated 2 days off from its own
`captured_at`, and `od_tracking_logs` had one row (Ashish Singh) dated 1 day off from
its own `ts` — both tables' timestamp columns already default to server `now()`, only
the separate `date` column was client-trusted. Every other function that writes
`attendance` (`admin_upsert_attendance`, `admin_bulk_upsert_attendance`,
`admin_decide_regularization`, `manager_decide_regularization`,
`apply_leave_approval_effects`, `refresh_attendance_monthly_summary`) takes an
explicit, intentional date chosen by an admin/manager or from a leave application —
not an auto-detected "today" — so those are a different, non-buggy pattern and were
left alone.

**Decision:** same fix as 15.1 — both functions now derive `date` from the server's own
clock (`now() at time zone 'Asia/Kolkata'`) instead of the client-supplied `p_date`. The
parameter itself is kept (unused) so the client's existing call signature doesn't need
to change.

**Files touched:** `supabase/migrations/0035_location_logs_use_server_clock.sql`
(`employee_log_location`, `employee_log_od_location` redefined), one-off script to
correct the two existing mismatched rows' `date` to match their real capture time.

### 15.2 Staff reported "only 4 minutes short, even with the 15-min grace" but got Half Day

**Reported by:** Staff, via admin — worked their shift only a few minutes under target,
expected the 15-min grace period (plan.md §12 V3 decision 10) to cover it, but the app
showed Half Day anyway.

**Root cause:** `app_settings.std_hours` was **9** the entire time until admin changed it
to **8** on 2026-09-01 (`SETTINGS_UPDATE` in `audit_logs`). `useAuth.js` fetches
`std_hours` exactly once, in a `useEffect(..., [])` that only runs when the app first
loads — it never refreshes afterward. Employee sessions now last 30 days (§13), so
anyone who already had the app open (or a still-valid session) before the setting
changed kept computing their shift status against the *old* 9h target indefinitely. And
because a computed `status` is written once at punch time and never recalculated
(no server mirror, nothing re-derives it later), that wrong value then stays frozen in
the database forever. Confirmed against live data — e.g. Shalini Gupta worked 7h57m on
2026-09-02 (3 min short of the *current* 8h target, comfortably inside the 15-min grace
— should be Present), but her app had evidently not refetched settings since before
Sep 1, computed a 63-minute shortfall against 9h instead, and stored Half Day. The same
`useAuth.js`-loaded-once pattern also feeds `useAdminAttendance.js`'s manual-edit path
(`editCell`), so an admin session left open across a settings change carries the exact
same risk.

**Decision:**
1. **Root fix:** `useEmployeeAttendance.js`'s `punch()` and `useAdminAttendance.js`'s
   `editCell()` both now call `fetchAppSettings()` fresh, right before computing
   `calcStatus`, instead of trusting the `stdHours` value each hook was handed (which
   traces back to that one-time bootstrap fetch). A settings change now takes effect on
   the very next punch/edit for everyone, not only people who reload the tab.
2. **Backfill:** one-off script recomputes `status` for every completed punch recorded
   after the 2026-09-01 settings change, using the real `calcStatus` (imported directly,
   not reimplemented) against the current `std_hours` — dry run first, listing every
   row that would change, applied only after review. Found 15 affected rows: 13
   Half Day → Present (people who'd actually met the new 8h target), 2 Absent → Half Day
   (people who cleared the new, lower 4h half-day threshold but not the old 4.5h one).
   Nothing before 2026-09-01 is touched — those rows were correctly computed against the
   9h target that genuinely applied at the time.
3. **New transparency feature (staff/admin's actual ask):** a new pure function,
   `explainShortfall(rec, stdHours)` in `lib/datetime.js`, mirrors `calcStatus`'s exact
   branches to produce a one-line reason wherever a shortfall against `stdHours` was
   involved — e.g. *"10 min short — covered by the 15-min grace period"*, *"Partial Leave
   (Partial Leave - 1 Hour) covered a 60-min shortfall"*, or *"16 min short of the 9h
   target"* — and `null` when there's nothing to explain (no punch yet, a full leave day,
   or stdHours met outright). Shown under the status badge in three places: the
   employee's "Today's Status" tile (`EmployeeDashboard.jsx`), the employee's
   `AttendanceHistory.jsx` per-day rows, and the admin `AttendanceGrid.jsx` Daily Records
   table (next to the existing "incomplete hrs" flag).

**Files touched:** `src/lib/datetime.js` (`explainShortfall` added, exported),
`src/lib/datetime.test.js` (7 new tests), `src/hooks/useEmployeeAttendance.js` and
`src/hooks/useAdminAttendance.js` (fetch `std_hours` fresh before computing status),
`src/features/employee/EmployeeDashboard.jsx`, `src/features/employee/AttendanceHistory.jsx`,
`src/features/admin/AttendanceGrid.jsx` (render the explanation), one-off backfill script
`scripts/backfill-status-after-std-hours-change.mjs`.

**Correction, same day — the real policy is 9h, not 8h:** admin clarified the actual
shift policy: 9-hour shift, flexible 9:00-10:00 AM punch-in / 6:00-7:00 PM punch-out
(complete the 9h anywhere in that window), plus the 15-min grace, and a rare case —
e.g. punch-in 10:30, punch-out 19:30, both ends later than the ideal slot but still a
full 9h worked — should still count as complete rather than penalized. Cross-checked
against the code: `WORK_WINDOW_START`/`WORK_WINDOW_END` (`09:00`/`19:00` in
`constants.js`) already encode exactly this policy — 19:00 minus 9:00 is exactly the
9h shift, which is why the latest on-time punch-in lands at 10:00 and on-time punch-out
at 18:00-19:00. The rare late-both-ends case is also already handled: `calcStatus`
accepts it once actual hours worked meet or exceed the window still available at that
late a start. **None of that needed a code change — std_hours=8 (set 2026-09-01) was
the actual mistake**, since it breaks the 9:00-19:00 window's built-in alignment with a
9h shift. Admin corrected the live setting back to 9 directly in the app
(`SETTINGS_UPDATE`, 2026-09-03). Re-ran the same kind of recompute as the backfill
above — this time against 9 — for every completed punch dated 2026-09-01 onward,
superseding the earlier std=8 backfill: 15 rows changed (11 Present → Half Day, 2
Half Day → Absent, matching the restored 4.5h half-day threshold and 9h target).
**Files touched:** `scripts/revert-std-hours-to-9.mjs` (one-off, supersedes
`backfill-status-after-std-hours-change.mjs` for rows in this window). No app code
changed for this correction — only data.

**Polite punch-slot reminder (admin's other ask):** a non-blocking one-line note on
`PunchPanel.jsx`, shown whenever punching is still possible today (`phase !== 'done'`):
*"Please try to punch in between 09:00–10:00 and out between 18:00–19:00 to comfortably
complete your 9h shift."* Times are derived from `WORK_WINDOW_START`/`WORK_WINDOW_END`
and the current `stdHours` (`idealPunchSlots()`), not hardcoded, so it stays correct if
either ever changes again. Purely a nudge — punching outside the slot is still accepted
exactly as before as long as the shift gets completed (the rare late-both-ends case).
**Files touched:** `src/features/employee/PunchPanel.jsx`.

**Simplified, same day — admin caught an ambiguity and corrected the rule:** raised the
case of someone 8h45m in (only 15 min short) who *also* had a Partial Leave applied that
day — the first `explainShortfall` always credited whichever leave was applied, even
when the raw shortfall alone was already within the 15-min grace, so the message would
say "Partial Leave used" when really grace alone was enough (and the leave balance was
spent for nothing). Admin's fix, deliberately simple: check the **raw** shortfall
(before any leave deduction) against grace **first** — if it's within 15 min, say grace
was used, full stop, regardless of any leave applied that day. Only past grace does a
Partial Leave get named; if none was applied, no note at all (the Half Day/Absent badge
already says enough — no need to restate the exact minute count). `explainShortfall`
rewritten to this simpler priority order, and fixed to also skip Work From Home / On
Duty days outright (it wasn't mirroring calcStatus's early-return for those, so a punch
recorded alongside an approved WFH/On Duty leave could have produced a contradicting
message). **Files touched:** `src/lib/datetime.js`, `src/lib/datetime.test.js` (rewrote
the affected tests, added a WFH/On Duty regression test).

---

## 16. Per-employee 8-hour shift override (added 2026-09-04)

**Reported by:** Admin — only 2 people in the whole org are actually on an 8-hour shift;
everyone else is 9-hour. Today `std_hours` is a single global value
(`app_settings.std_hours`), so there was no way to special-case just these two without
changing it for everyone — which is exactly what caused the §15.2 incident (admin
changed the global setting from 9→8 to try to fix it for these people, broke Present/
Absent for the other ~98% of staff until it was reverted). This feature is the real fix:
make the target hours a **per-employee** value instead of one global number.

**The two employees:** Archana (emp #1113), Vivek Singh (emp #1154). To be looked up by
`emp_num` at build time and set to an 8-hour override; every other active employee keeps
`std_hours_override = null` and continues on the global 9h default, completely
unaffected.

### Decisions locked in

| # | Decision |
|---|---|
| 1 | New nullable column **`employees.std_hours_override`** (numeric). `null` = "uses the org default from `app_settings.std_hours`" — not reusing the existing `shift_type` column (day/night shift label, unrelated concept, already used for punch-window guessing) |
| 2 | One small pure resolver, `effectiveStdHours(employee, globalStdHours)` in `src/lib/datetime.js`, next to `calcStatus`. Every call site that currently reads the flat global `stdHours` switches to this resolved value instead — `calcStatus`, `calcOvertimeHours`, `hasIncompleteHoursFlag`, `explainShortfall`, and `idealPunchSlots` themselves are **untouched**; they still just take a plain number |
| 3 | **Everything hours-derived follows the override consistently** for these two — half-day threshold (stdHours ÷ 2 → 4h not 4.5h), overtime (counted only beyond 8h), the incomplete-hours late-punch flag, the shortfall explanation text, and the punch-slot reminder on `PunchPanel.jsx` (suggests an 8h-shift punch-out window for them, not the 9h one) |
| 4 | The **15-minute grace period stays a flat constant**, not scaled by stdHours — it already sits inside `calcStatus`'s shortfall check regardless of the number that comes in, so it applies to the 8h shortfall calc exactly the way it applies to the 9h one today. No code change needed for this, just confirming it isn't accidentally scaled |
| 5 | The **9:00–19:00 work window** (`WORK_WINDOW_START/END`) stays global and unchanged — that's office hours, not personal shift length |
| 6 | **Comp-off accrual** (`run_comp_off_accrual`, §11 decision 10) also respects the override — these two earn a comp-off credit for 8h worked on a Sunday/holiday instead of 9h. Server-side function joins `employees.std_hours_override` per row instead of reading one global `v_std_hours` |
| 7 | Amends §11 decision 13 ("Overtime = hours worked beyond stdHours ... no per-company override") — that "no override" applied to the Plant-vs-other-companies question, not to this. OT is now per-employee where an override is set, per-org-default otherwise |
| 8 | **Forward-only, not retroactive** — matches how §15.2's std_hours revert was handled. Only punches/admin edits made after this ships use the resolved per-employee value. Existing stored `status`/OT for past days is left exactly as-is |
| 9 | Admin UI: new **"Standard Hours"** number field on the employee Add/Edit form (`Employees.jsx`), next to Shift Type. Blank/empty = no override (org default) |
| 10 | `app_settings.std_hours` and `admin_update_settings` are **untouched** — still the org-wide default for the ~98% of staff with no override, and still safe for admin to edit without touching these two |

### Files touched (planned)

- `supabase/migrations/0036_per_employee_std_hours.sql` — `employees.std_hours_override`
  column; `run_comp_off_accrual` redefined to resolve per-employee; one-off `update` to
  set the override to 8 for emp_num 1113 and 1154 (looked up by `emp_num`, not a
  hardcoded UUID, so it's readable and re-runnable)
- `src/lib/datetime.js` — `effectiveStdHours(employee, globalStdHours)` helper
- `src/lib/datetime.test.js` — regression tests for the resolver and an 8h-shift
  `calcStatus`/OT scenario
- `src/hooks/useEmployeeAttendance.js` — punch flow resolves the current employee's
  override before calling `calcStatus`
- `src/hooks/useAdminAttendance.js` — admin manual edit resolves by `record.empId`
- `src/features/employee/AttendanceHistory.jsx`, `MonthlySummary.jsx` — fallback
  recompute path
- `src/features/admin/AttendanceGrid.jsx`, `Reports.jsx`, `Dashboard.jsx`,
  `src/features/employee/EmployeeDashboard.jsx`, `MyOvertime.jsx`, `PunchPanel.jsx` —
  display-only OT/flag/explain/punch-slot calcs, resolved per row using the `employees`
  list each of these already has in scope
- `src/features/admin/Employees.jsx`, `src/api/admin.js` — Standard Hours field +
  save path
## 17. Pre-existing bug — app_settings_public silently missing admin_email/birthday_message (found + fixed 2026-09-04)

**Found by:** not a user report — surfaced while regression-testing §16 (this was a
console-error check on the login screen, unrelated to the 8h-shift feature itself; §16's
own change never touches this view).

**What was wrong:** every single page load was throwing `column
app_settings_public.admin_email does not exist` in the console. `fetchAppSettings()`
swallows that into a fallback (`{ adminEmail: null, birthdayMessage: null }`), so the app
kept working but silently: the Apply Leave screen's "notify admin by email" link and any
custom birthday message set in Settings were both reverting to defaults in production.

**Root cause:** `app_settings_public` was live on production as 0002's original 1-column
view (`std_hours` only) — even though 0020 widened it to add `admin_email` and 0023
widened it again to add `birthday_message`, and PROGRESS.md's own P4/V2 write-up records
both as verified live at the time. 0002 carries a `drop view if exists` guard (added for
replay-safety); a later full `apply-migrations.mjs` replay attempt drops and recreates
the view back to that narrow shape when it re-runs 0002, then errors out at migration
0010 (the already-known broken-full-replay point, §13) — never reaching 0020/0023's
widening statements again in that same replay. Neither this bug nor its cause has
anything to do with §16.

**Fix:** `supabase/migrations/0037_fix_app_settings_public_view.sql` — re-applies the
exact same widening 0023 already defined (`select std_hours, admin_email,
birthday_message from app_settings where id = 1`). Purely additive, no drop needed.
Applied directly via `scripts/apply-0037-fix-app-settings-public-view.mjs` (same
one-off-script pattern every post-0010 migration uses). Verified via the real anon key
the app uses: `app_settings_public` now returns the actual configured admin email
(`recruitment@ecoste.in`) and birthday message with no error, where before both silently
came back null.

## 18. Punch device binding — HR-reported PIN sharing / buddy punching (2026-09-07)

**Reported by:** HR — staff are sharing their 4-digit PIN with a colleague, who then
punches attendance on the friend's behalf from the friend's own phone.

**Options discussed and why device binding was picked:**
- IP-address or Wi-Fi based locking — rejected. Mobile data IPs change per session and
  everyone on the same office Wi-Fi shares one IP, so this can't distinguish people.
- GPS/geofencing — already built (`sites`, `haversine_m`, plan.md §5/§7). Doesn't help
  here: the friend doing the punching is typically physically on-site too, so the
  existing geofence check passes either way.
- Selfie capture at punch — discussed as a stronger companion (device binding can be
  beaten by clearing browser storage / reinstalling; a photo gives HR evidence even
  then) but **not** in scope for this pass — user chose device binding only for now.
  Worth revisiting later if binding alone doesn't hold up in practice.

### Decisions locked in

| # | Decision |
|---|---|
| 1 | Binding applies to the **punch action only**, not login. Viewing attendance/leave/balances from a second device (e.g. home PC) stays unrestricted — the actual complaint is about marking attendance for someone else, not general account access, and locking login too would create help-desk load for zero extra benefit |
| 2 | Each browser install gets a random id (`crypto.randomUUID()`) generated once and kept in `localStorage`. First successful punch after this ships **auto-binds** that id to the employee — no separate "register your phone" step, so rollout is zero-effort for the ~131 people who aren't sharing PINs |
| 3 | Once bound, a punch from a **different** device id is rejected outright (`raise exception`, same pattern as the existing geofence rejection) — not silently allowed-and-flagged. The point is to stop the punch from being recorded under someone else's attendance, not just to log it after the fact |
| 4 | Every blocked attempt is written to `audit_logs` (`PUNCH_DEVICE_BLOCKED`) — this is the part that actually answers HR's question "who's doing this and how often," which a pure block alone wouldn't give them |
| 5 | Admin gets a **"Reset registered device"** action per employee (Employees tab) for real phone changes/replacements — mirrors the existing `admin_set_employment_status` pattern. Resetting nulls the binding so the next punch re-binds fresh, and is itself audit-logged (`PUNCH_DEVICE_RESET`) |
| 6 | Known limitation, accepted for this pass: clearing site data / a private window / reinstalling wipes the stored id, so a technically determined person can force a re-bind on their next punch. This raises the bar a lot over "just tell someone the PIN" without adding photo capture; revisit with selfie evidence (option above) if it turns out not to be enough |

### Files touched (planned)

- `supabase/migrations/0038_punch_device_binding.sql` — `employees.punch_device_id`
  (text, null = unbound) and `employees.punch_device_bound_at` (timestamptz) columns;
  `employee_punch` redefined with a new `p_device_id text` parameter that binds on
  first use and rejects a mismatch; new `admin_reset_punch_device(p_token, p_emp_id)`
  function
- `src/lib/deviceId.js` — new small pure-ish helper, `getDeviceId()`: reads/creates the
  `localStorage` id
- `src/api/attendance.js` — `employeePunch` passes `p_device_id`
- `src/hooks/useEmployeeAttendance.js` — punch call sites pass the device id; punch
  errors (mismatch included) surface through the existing catch/error-message path
  used for geofence rejections today, no new error-handling shape needed
- `src/hooks/useAdminData.js`, `src/api/admin.js` — `adminResetPunchDevice(id)`
- `src/features/admin/Employees.jsx` — "Reset registered device" button + a small
  bound/unbound indicator per employee row

## 19. Punch device binding — stale-client incident, and extending the block to login (2026-09-08)

**What happened the day after §18 shipped:** an employee (Shashank Soni) reported
being unable to punch at all, screenshot showing:
`Could not find the function public.employee_punch(p_data, p_emp_id, p_token) in the
schema cache`. That is the exact signature of the **old 3-argument** `employee_punch`
that migration 0038 deleted outright. Root cause: his phone was still running the
pre-0038 app (browser/tab left open from before the deploy), so it kept calling a
function that no longer exists — not a device-binding bug, a consequence of dropping
an RPC signature with no compatibility path for already-open sessions. Fix for
right-now is operational (ask staff to fully close/reopen the app once); the general
fix (a "new version, please reload" check for tabs left open across a deploy) is
flagged as a follow-up, not yet built. **This matters again below** — §19 is about to
change `employee_login`'s signature too, and login happens far more often than punch,
so the same mistake here would lock out *everyone*, not one employee, on the next
deploy.

**Also tested and confirmed working as designed, not a bug:** opening/viewing the
employee panel from a second device after already punching in elsewhere is currently
allowed — that was the explicit §18 decision #1 (binding applies to the punch action
only). Nothing was actually punched from the second device in this test; the screen
only *displayed* the Punch Out tile.

**Decision: extend the block to login itself.** HR's staff are not technical enough
to reliably notice "punch still works from my phone, so I'm fine" — the ask is
simpler and stricter: opening the panel at all from an unregistered device should
show **Access Denied**, full stop. Two ways to decide which device counts as "theirs"
were discussed:

- Bind on first **login** (chosen) — the very first login after this ships locks that
  device in for everything, login and punch both. Simpler mental model for
  non-technical staff, matches "access denied on open" literally.
- Bind on first **punch** — login stays open until the real punch action, lower
  rollout risk (see below) since a friend has to actually punch to trigger the lock,
  not just open the app. **Not chosen** — HR prioritized simplicity over this smaller
  window of risk.

### Decisions locked in

| # | Decision |
|---|---|
| 1 | `employee_login` gets a new `p_device_id` param, checked the same way `employee_punch` already does: if `employees.punch_device_id` is null, bind it here and let login through; if set and it doesn't match, **deny the login outright** (no dashboard, no data) rather than letting them in and only blocking the punch |
| 2 | Reuses the same `punch_device_id` / `punch_device_bound_at` columns from migration 0038 — no new columns needed. An employee who already bound a device via a punch under 0038 keeps that binding; login enforcement just starts reading the same value |
| 3 | Denial is a returned error result (`{ error: '...' }`), same shape `employee_login` already uses for the PIN-lockout case (0022) — not a raised exception — so the login screen's existing error-display path handles it with no new UI plumbing. Message: something like "This device is not registered for your account. Ask HR to reset your device." shown plainly on the login screen (non-dismissing, not a toast that fades — plan.md's plain-language/debuggable preference) |
| 4 | The existing "Reset registered device" admin action (§18 #5) needs no logic change — clearing `punch_device_id` already unlocks the *next* login the same way it unlocks the next punch today. Its label/help text should be updated to say "login and punch" instead of just "punch" so admins understand the wider effect |
| 5 | Known, accepted rollout risk (sharper version of §18 #6): whoever logs in **first** after this ships becomes the bound device for that PIN. If a colleague who's already been sharing someone's PIN opens the app before the real employee does — even just once — the colleague's phone binds, and the real employee is denied even at login until admin resets it. Mitigation: message all staff to log in once from their own phone as soon as this goes live, and watch Reset Device usage closely for the first couple of days |
| 6 | Rollout-safety lesson from the stale-client incident above: `employee_login`'s signature is changing, and login is used every single day by everyone (unlike punch, twice a day). If any employee's browser is already open when this deploys, their next login attempt will hit the same "function not found" class of error — but for login, not punch. Mitigated by shipping §20 (auto-refresh) first/together with this |
| 7 | The "Remember me on this device" 30-day session (0034) would otherwise let anyone who already has one — including a colleague already sharing a PIN — keep getting in with no device check until it naturally expires. HR chose to force this: the migration deletes all rows from `employee_sessions` the moment it's applied, so every employee (innocent ones included) has to enter their PIN once more that day, but the new check then covers 100% of staff immediately rather than phasing in over weeks. Admin sessions are untouched (out of scope, same as 0034) |

### Files touched (planned)

- `supabase/migrations/0039_login_device_binding.sql` — redefine `employee_login`
  with `p_device_id text` param, bind-if-null / deny-if-mismatched logic mirroring
  `employee_punch`'s (0038); drop the old 2-arg signature the same way 0038 dropped
  the old 3-arg `employee_punch`
- `src/api/auth.js` — `employeeLogin` passes `p_device_id` (via `getDeviceId()`,
  already built in `src/lib/deviceId.js`)
- `src/hooks/useAuth.js`, `src/features/auth/LoginScreen.jsx` — pass device id at
  login; render the "Access Denied" message plainly, distinct from a wrong-PIN error
- `src/features/admin/Employees.jsx` — update Reset Device button copy to mention
  login, not just punch

## 20. Auto-refresh on new deploy (2026-09-08)

**Why:** directly answers §19 decision #6 — most staff run this as a home-screen icon
("downloaded it as an app"), which tends to stay open/suspended in the background for
days rather than getting freshly loaded each time it's tapped. That's exactly what
caused the Shashank incident (§19) for punch; the same thing would break login the
day §19 ships, and login is used far more often. Fix it once, generally, before
changing login's signature.

**How it will work:** no service worker (none exists today, keep it that way — less
to debug). Instead:
- The build writes a tiny `version.json` (just a build timestamp) into the deployed
  static files as an ordinary, un-hashed file — unlike the JS bundle, it's cheap to
  re-fetch and never itself gets cached meaningfully.
- The running app remembers the build timestamp it was loaded with, and re-fetches
  `version.json` (cache-busted, `cache: 'no-store'`) at two moments: whenever the tab
  becomes visible again (covers reopening the home-screen icon after it was
  backgrounded — the case that actually matters for this staff) and every few minutes
  while the app is open.
- If the fetched timestamp differs from the one it loaded with, **auto-reload** —
  no dialog, no "click to update" button, matching decision #1 below. Staff aren't
  technical enough to act on a prompt reliably (same reasoning as §19's login
  decision), so this should just happen.
- Skips the reload if a punch is actually in flight (reuses the existing
  `isPunching`/`punchingRef` guard in `useEmployeeAttendance.js`) so a background
  version check can never cut off a GPS capture or an in-progress punch save; it
  checks again next interval instead.

### Decisions locked in

| # | Decision |
|---|---|
| 1 | Fully automatic — reload happens without asking, for the reason above. A brief, plain "Updating..." message shows for a second first so a staff member mid-tap isn't confused by the screen suddenly flashing, then it reloads |
| 2 | Version source is a plain timestamp file written at build time, not the JS bundle's own hash — keeps the check itself tiny and independent of whether the JS changed shape |
| 3 | Checked on tab-visible (the realistic "reopened the icon" moment for this staff) plus a periodic interval as a backup for a tab that's simply left open and never backgrounded |
| 4 | Never interrupts an in-flight punch — checked against the same in-flight guard already used to ignore double-taps |
| 5 | Ship this **before or together with** §19 (login device binding), not after — the whole point is to stop that change from repeating the stale-client incident |

### Files touched (planned)

- `scripts/write-version.mjs` — new tiny script, writes `public/version.json` with
  the current build timestamp; wired in as a `prebuild` step (`npm run build` runs it
  first)
- `src/lib/versionCheck.js` — new module: reads the build timestamp baked in via
  Vite's `define` at build time, polls `version.json`, triggers reload on mismatch
  (skipping while a punch is in flight)
- `src/App.jsx` (or `main.jsx`) — wires up the visibility-change listener + interval
  once at app startup
- `vite.config.js` — `define` to bake the build timestamp into the client bundle

## 21. Manager panel — Correction Requests missing employee name (HR-reported 2026-09-09)

**Reported by team:** a manager with 19 direct reports sees Leave Requests with the
employee's name, but Correction Requests (punch regularization requests) below it show
only date/time and reason — no name — so there's no way to tell which team member the
request belongs to. Screenshot showed "Mansi Verma" on a leave request card, but the
two correction requests underneath it (dated 2026-09-07 and 2026-09-03) were blank.

**Root cause:** `regularization_requests` never stores the employee's name — only
`emp_id`. That's different from `leave_applications`, which stores `emp_name` directly
on the row at apply time (why Leave Requests display fine). The manager's SQL function
`manager_get_team_regularizations` (migration 0003) just does
`select r.* from regularization_requests r ...`, so `emp_name` is never in the result,
and `TeamPanel.jsx` renders `{r.empName}` as blank.

The Admin panel has the exact same gap in `admin_get_regularizations`, but it doesn't
show up there — `LeaveApprovals.jsx` already falls back to a client-side lookup against
its full employee list (`r.empName || emp.name`, line ~56). `TeamPanel.jsx` never got
that same fallback, so the manager view is the only place the bug is visible.

### Decision locked in

Frontend-only fix, no migration needed: mirror the admin panel's existing fallback
pattern. The manager already has `myTeam` (his direct reports, each with `.name` and
`.empNum`) loaded in memory — look up the employee by `r.empId` there when `r.empName`
is missing.

### Files touched (planned)

- `src/features/manager/TeamPanel.jsx` — build a lookup from `myTeam` by `id`; apply
  `r.empName || lookup[r.empId]?.name` in both the pending Correction Requests list and
  the Previously Actioned list (the same array also holds actioned leave rows, which
  already have `empName` — only the regularization branch needs the fallback)

## 22. Casual Leave (full-day and half-day) must allow same-day application (HR-reported 2026-09-09)

**Reported by team:** Casual Leave — including first-half/second-half half-day — can
only be applied one day prior, never for today. HR wants same-day application allowed,
same as it already works for Partial Leave (§12/migration 0031).

**Root cause:** `employee_apply_leave` (currently defined in migration 0031) has a
generic rule: any leave type not in the exempt list
`{Sick Leave, Bereavement Leave, Work From Home, On Duty, LOP, Earned Leave,
Partial Leave - 1 Hour, Partial Leave - 2 Hours}` must have `date >= current_date + 1`,
else it's rejected with "% must be applied at least a day in advance". Casual Leave was
never added to that exempt list when Partial Leave was (0031) — so it's the only leave
type actually affected today. Half-day is only available for Sick/Casual/Earned Leave
(a separate check), but Sick Leave is already exempt outright and Earned Leave has its
own stricter 7-day-advance rule that runs first — so both full-day and half-day Casual
Leave are the only cases actually blocked. The frontend (`LeaveApply.jsx`) never stops
you from picking today's date for Casual Leave — the rejection only happens
server-side, so this reads as a bug, not a deliberate limit.

### Decision locked in

Mirror the exact same treatment Partial Leave got in 0031: add `'Casual Leave'` to the
exemption list, allow `date >= current_date` (today or any future date), reject only
genuinely past dates ("Casual Leave cannot be applied for a past date"). No schema
change, no frontend change needed (the date picker already allows today).

### Files touched (planned)

- `supabase/migrations/0040_casual_leave_same_day.sql` — new migration, redefines
  `employee_apply_leave`: adds `'Casual Leave'` to the same-day-allowed branch
  alongside Partial Leave, keeping every other rule (probation cap, half-day
  eligibility, 18-month service check, balance check, Plant restriction, duplicate
  check) exactly as-is
- `scripts/apply-0040-casual-leave-same-day.mjs` — one-off apply script (repo's
  established pattern since apply-migrations.mjs full-replay is broken at migration
  0010 on prod — plan.md §13)

## 23. Partial Leave (1hr/2hr) must not be capped by the Probation/Notice-Period "1 leave" rule (HR-reported 2026-09-10)

**Reported by team:** An employee on Probation/Notice Period tried to apply for
Partial Leave - 2 Hours and got "Only 1 leave is allowed during your Probation — apply
as LOP instead", even though she still had quota left on the Partial Leave Tracker.
Policy: the 1hr/2hr short leave types are available to **all** staff, Confirmed or
Probation/Notice Period alike — capped only by their own monthly limit (2×1hr, 1×2hr
per month, for everyone, unchanged by this fix), never by the yearly "1 leave" cap.

**Root cause:** `employee_apply_leave` has always (since migration 0016) capped
Probation/Notice-Period employees to 1 leave per financial year across every leave
type except `LOP`, `Work From Home`, `On Duty` — both in the trigger condition and in
the count query. Partial Leave - 1 Hour / 2 Hours was never added to that exemption
list (0031 and 0040 exempted it from the *same-day* and *advance-notice* rules, not
from this probation cap), so a Probation/Notice-Period employee who had already used
their 1 confirmed-type leave this year gets blocked from partial leave too — a gap
that's existed since the rule was introduced, only now surfaced because this employee
hit it.

### Decision locked in

Add `'Partial Leave - 1 Hour', 'Partial Leave - 2 Hours'` to both places in the
probation-cap block — the `v_leave_type not in (...)` guard and the
`leave_type not in (...)` count query — same treatment as `LOP`/`Work From
Home`/`On Duty`. Partial leave applications will (a) never themselves trigger the
cap, and (b) never count against the cap for other leave types either. The existing
monthly cap (2×1hr, 1×2hr, client-side in `useEmployeeLeave.js`/`LeaveApply.jsx`) is
untouched and still applies to everyone. Every other rule in the function (same-day
rules, half-day eligibility, 18-month service check, balance check, Plant
restriction, duplicate-application check) stays exactly as-is.

### Files touched (planned)

- `supabase/migrations/0041_partial_leave_probation_exempt.sql` — new migration,
  redefines `employee_apply_leave`: adds the two Partial Leave types to the
  probation-cap exemption list (both occurrences)
- `scripts/apply-0041-partial-leave-probation-exempt.mjs` — one-off apply script,
  same verify-before/after pattern as 0038/0039/0040 (repo's established pattern
  since apply-migrations.mjs full-replay is broken at migration 0010 on prod —
  plan.md §13)

## Appendix — Reference

**Old project:** `attendance_tracker` · ref `pwoilxkcyqvvnwdqspos` · founderoffice-ecoste's Org · Free · Nano · ap-south-1
**New project:** `HRMS` · paid

**Tables (15):** admin_sessions, app_settings, attendance, audit_logs, bio_sheet_cache, employee_sessions, employees, holidays, imported_sheet_cache, leave_applications, leave_balances, location_logs, monthly_sheet_cache, od_tracking_logs, regularization_requests

**Views (2):** app_settings_public, employees_directory

**Leave types (12):** Sick · Casual · Earned · Unpaid · Bereavement · Marriage · Maternity · Paternity · Partial 1hr (max 2/month) · Partial 2hr (max 1/month) · Work From Home · On Duty

**Extracted schema files** (temporary — move into the repo in Phase 0):
`schema.sql` · `schema-report.md` · `schema.json`
