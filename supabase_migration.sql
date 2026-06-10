-- ═══════════════════════════════════════════════════════════
--  PhysioCare Portal — Supabase Database Migration
--  Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════════════

-- ── Enums (safe create) ────────────────────────────────────
do $$ begin
  create type user_role as enum ('admin', 'staff');
exception when duplicate_object then null; end $$;

do $$ begin
  create type staff_status as enum ('pending', 'active', 'inactive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_status as enum ('scheduled', 'completed', 'cancelled', 'no_show');
exception when duplicate_object then null; end $$;

do $$ begin
  create type session_type as enum ('clinic', 'home');
exception when duplicate_object then null; end $$;

do $$ begin
  create type therapy_level as enum ('basic', 'rehab', 'advance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type gender_type as enum ('Female', 'Male', 'Other');
exception when duplicate_object then null; end $$;

-- ── clinics ────────────────────────────────────────────────
create table if not exists clinics (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  address text not null default '',
  phone   text not null default '',
  active  boolean not null default true
);

-- ── profiles (staff / admins) ──────────────────────────────
-- NOTE: password is stored as plain text here for simplicity.
-- Replace with pgcrypto hashing for production.
create table if not exists profiles (
  id        uuid primary key default gen_random_uuid(),
  name      text not null,
  email     text not null unique,
  password  text not null default '',
  phone     text not null default '',
  role      user_role not null default 'staff',
  title     text not null default '',
  clinic_id uuid references clinics(id) on delete set null,
  status    staff_status not null default 'pending'
);

-- ── patients ───────────────────────────────────────────────
create table if not exists patients (
  id                 uuid primary key default gen_random_uuid(),
  clinic_id          uuid references clinics(id) on delete set null,
  name               text not null,
  phone              text not null default '',
  date_of_birth      date,
  gender             gender_type not null default 'Female',
  address            text not null default '',
  diagnosis          text not null default '',
  referral_source    text not null default '',
  emergency_contact  text not null default '',
  notes              text not null default '',
  signs              text not null default '',
  symptoms           text not null default '',
  complications      text not null default '',
  surgeries          text not null default '',
  active             boolean not null default true,
  reports            jsonb not null default '[]',
  home_visit_details jsonb
);

-- ── therapy_sessions ───────────────────────────────────────
create table if not exists therapy_sessions (
  id                uuid primary key default gen_random_uuid(),
  patient_id        uuid not null references patients(id) on delete cascade,
  clinic_id         uuid references clinics(id) on delete set null,
  scheduled_at      timestamptz not null,
  therapy_type      text not null default '',
  session_type      session_type not null default 'clinic',
  therapy_level     therapy_level not null default 'basic',
  assigned_staff_id uuid references profiles(id) on delete set null,
  status            session_status not null default 'scheduled',
  completed_at      timestamptz,
  notes             text not null default '',
  treatment_notes   text not null default '',
  amount_collected  numeric(10,2)
);

-- ── Row-Level Security ─────────────────────────────────────
alter table clinics          enable row level security;
alter table profiles         enable row level security;
alter table patients         enable row level security;
alter table therapy_sessions enable row level security;

-- Drop & recreate policies (safe re-run)
do $$ declare r record;
begin
  for r in select policyname, tablename from pg_policies
           where tablename in ('clinics','profiles','patients','therapy_sessions')
  loop
    execute format('drop policy if exists %I on %I', r.policyname, r.tablename);
  end loop;
end $$;

create policy "allow_all_clinics"          on clinics          for all using (true) with check (true);
create policy "allow_all_profiles"         on profiles         for all using (true) with check (true);
create policy "allow_all_patients"         on patients         for all using (true) with check (true);
create policy "allow_all_therapy_sessions" on therapy_sessions for all using (true) with check (true);

-- ── Indexes ────────────────────────────────────────────────
create index if not exists idx_patients_clinic    on patients(clinic_id);
create index if not exists idx_sessions_patient   on therapy_sessions(patient_id);
create index if not exists idx_sessions_clinic    on therapy_sessions(clinic_id);
create index if not exists idx_sessions_scheduled on therapy_sessions(scheduled_at);
create index if not exists idx_profiles_clinic    on profiles(clinic_id);

-- ── Seed: initial admin account ────────────────────────────
-- Login:  admin@physiocare.local  /  admin123
-- Change this password after first login via the Staff page.
insert into profiles (name, email, password, phone, role, title, clinic_id, status)
values (
  'Admin',
  'admin@physiocare.local',
  'admin123',
  '',
  'admin',
  'Clinic Administrator',
  null,
  'active'
)
on conflict (email) do nothing;

-- ── Add signs/symptoms columns to existing DB (safe, idempotent) ────────────
alter table patients add column if not exists signs     text not null default '';
alter table patients add column if not exists symptoms  text not null default '';

-- ── Allow home-visit patients/sessions without clinic assignment ────────────
alter table patients alter column clinic_id drop not null;
alter table therapy_sessions alter column clinic_id drop not null;

-- ── Clinic expenses ──────────────────────────────────────────────────────────
create table if not exists clinic_expenses (
  id            uuid primary key default gen_random_uuid(),
  clinic_id     uuid not null references clinics(id) on delete cascade,
  category      text not null,
  amount        numeric(12, 2) not null default 0,
  date          date not null,
  recurrence    text not null default 'one-time',
  notes         text not null default '',
  created_at    timestamptz not null default now()
);

-- ── Equipment & tools ────────────────────────────────────────────────────────
create table if not exists equipment (
  id             uuid primary key default gen_random_uuid(),
  clinic_id      uuid not null references clinics(id) on delete cascade,
  name           text not null,
  category       text not null,
  purchase_date  date,
  purchase_cost  numeric(12, 2),
  condition      text not null default 'Good',
  serial_number  text not null default '',
  notes          text not null default '',
  created_at     timestamptz not null default now()
);
