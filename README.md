# HRMS — Attendance & Leave System

Attendance and leave management for **Ecoste group** (Asma Traexim Pvt Ltd, Metamask Design Solutions LLP, Lamora Buildtech Pvt Ltd). ~131 employees today, built for ~300.

- **What & why:** [`plan.md`](./plan.md)
- **Current status:** [`PROGRESS.md`](./PROGRESS.md)

## Stack

| Part | What it is |
|---|---|
| Frontend | React 18 + Vite + Tailwind CSS |
| Backend | Supabase (PostgreSQL) — all business logic lives in database functions |
| Login | Custom PIN → token, not Supabase Auth |
| Excel | [SheetJS](https://sheetjs.com) (`xlsx` npm package) |

## Setup

```bash
npm install
cp .env.example .env.local   # fill in the real Supabase URL + publishable key
npm run dev
```

`.env.local` is gitignored — never commit real credentials.

## Database

The schema lives in [`supabase/migrations/`](./supabase/migrations/), applied in order. `supabase/schema-report.md` is a human-readable reference of the extracted live schema (tables, functions, views) as of the date in the file — not authoritative once later migrations land.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview the production build locally |
