-- `sites` table (plan.md Phase 3, Decision 2, §6B) — the 3 office locations, stored in
-- the database rather than hardcoded, so radius/coordinates can change later from
-- Admin (once the admin screen is built) without a code deploy. Rows are being filled
-- in directly via the Supabase dashboard for now — no seed data here.

create table if not exists "public"."sites" (
  "id" uuid default gen_random_uuid() not null primary key,
  "name" text not null,
  "latitude" numeric(9,6) not null,
  "longitude" numeric(9,6) not null,
  "radius_m" integer not null default 100,
  "active" boolean not null default true,
  "created_at" timestamp with time zone default now() not null,
  "updated_at" timestamp with time zone default now() not null
);

-- Same posture as every other table (plan.md §4.3 — "all 15 tables locked down with
-- row-level security"): RLS on, with a plain anon-read policy like `holidays` gets,
-- because the punch screen (P3-3) needs every employee to read office coordinates and
-- compute live distance client-side before a punch — this isn't sensitive data, it's
-- effectively the office address. Writes stay admin-only once the admin screen (P3-1)
-- lands; there is no anon write policy here.
alter table sites enable row level security;

grant select on public.sites to anon;

drop policy if exists "anon can read sites" on sites;
create policy "anon can read sites" on sites for select to anon using (true);
