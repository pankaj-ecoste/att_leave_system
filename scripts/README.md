# Scripts

One-off and reusable Node scripts that talk directly to the production database via
the session-pooler `DATABASE_URL` (see the `supabase-db-access-method` note in
`plan.md`/project memory — no Supabase CLI on this machine). Organized by what each
script is *for*, not by when it was written:

- **`migrations/`** — one script per numbered migration in `supabase/migrations/`,
  applies that one file and verifies the result (`apply-00NN-description.mjs`), plus
  `apply-migrations.mjs`, the general batch-apply tool (its full-replay mode is known
  broken past migration 0010 — prefer the individual `apply-00NN-*.mjs` scripts).
- **`guardrails/`** — permanent, repeatedly-run checks, wired into `package.json`
  (`npm run check-schema`, `npm run smoke-test`). Not tied to any one migration.
- **`diagnostics/`** — one-off, read-only investigation scripts written to answer a
  specific question against live data (e.g. "is this function actually anon-callable
  right now?"). Safe to re-run; they don't write anything.
- **`data-fixes/`** — one-off scripts that corrected or backfilled data already live
  in production, kept as a historical record of what was done and why.
- **`setup/`** — reusable operational utilities not tied to a single migration or
  incident (resetting the admin PIN, seeding employees, setting the storage-signing
  key).

Every script prints exactly what env vars it needs (`DATABASE_URL`, sometimes a
second key) and exits with a clear message if one's missing — run any of them with no
arguments to see what it expects.
