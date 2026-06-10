# PhysioCare Portal

An internal physiotherapy clinic management portal for admins and clinic staff.

## What is included

- React + TypeScript + Vite frontend.
- Supabase client configuration.
- Demo-mode data so the portal can be reviewed before connecting Supabase.
- Supabase SQL schema with row-level security for admin/global access and staff clinic-scoped access.
- Patient records, visits, therapy scheduling, session status tracking, clinics admin, and staff approval.

## Demo access

The UI starts in local demo mode until Supabase environment variables are added.

- Admin: `admin@physiocare.local` / `admin123`
- Staff: `staff@physiocare.local` / `staff123`

## Run locally

Install dependencies and start the dev server:

```bash
npm install
npm run dev
```

This workspace currently did not expose `npm` in PATH during implementation, so dependency installation could not be completed here. Once Node/npm are available, the commands above should run the app.

## Connect Supabase

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Create the admin auth user with `admin@physiocare.local`.
4. Update the UUID in `supabase/seed-admin-profile.sql` to match that auth user and run it.
5. Copy `.env.example` to `.env.local` and fill in your project URL and anon key.
6. Restart the dev server.

The shipped UI is intentionally demo-first; the schema and access policy are ready for wiring the live persistence layer fully in the next implementation pass.

## Connect Cloudflare R2 (patient report uploads)

See [workers/r2-reports/README.md](workers/r2-reports/README.md) for bucket, Worker deploy, and frontend env setup.
