create extension if not exists "pgcrypto";

create table if not exists public.clinics (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text not null default '',
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  phone text not null default '',
  role text not null check (role in ('admin', 'staff')) default 'staff',
  title text not null default 'Physiotherapist',
  clinic_id uuid references public.clinics(id),
  status text not null check (status in ('pending', 'active', 'inactive')) default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists public.patients (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id),
  salutation text not null default '',
  primary_doctor_id uuid references public.profiles(id) on delete set null,
  created_by_staff_id uuid references public.profiles(id) on delete set null,
  name text not null,
  phone text not null default '',
  date_of_birth date,
  age integer,
  occupation text not null default '',
  gender text check (gender in ('Female', 'Male', 'Other')),
  address text not null default '',
  patient_history text not null default '',
  case_type text not null default '',
  condition text not null default '',
  diagnosis text not null default '',
  referral_source text not null default '',
  emergency_contact text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.patients add column if not exists salutation text not null default '';
alter table public.patients add column if not exists primary_doctor_id uuid references public.profiles(id) on delete set null;
alter table public.patients add column if not exists created_by_staff_id uuid references public.profiles(id) on delete set null;
alter table public.patients add column if not exists age integer;
alter table public.patients add column if not exists occupation text not null default '';

create table if not exists public.visits (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  visit_at timestamptz not null,
  therapist_id uuid references public.profiles(id),
  reason text not null default '',
  assessment_notes text not null default '',
  treatment_notes text not null default '',
  follow_up_notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.therapy_sessions (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id),
  scheduled_at timestamptz not null,
  therapy_type text not null,
  assigned_staff_id uuid references public.profiles(id),
  status text not null check (status in ('scheduled', 'completed', 'cancelled', 'no_show')) default 'scheduled',
  completed_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.patient_payments (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references public.patients(id) on delete cascade,
  clinic_id uuid references public.clinics(id) on delete set null,
  paid_at timestamptz not null,
  amount numeric(12,2) not null default 0,
  method text not null default 'Cash',
  notes text not null default '',
  allocations jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.equipment (
  id uuid primary key default gen_random_uuid(),
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  name text not null,
  category text not null,
  purchase_date date,
  purchase_cost numeric(12,2),
  quantity numeric(12,2) not null default 1,
  unit_price numeric(12,2),
  minimum_quantity numeric(12,2) not null default 0,
  details text not null default '',
  condition text not null default 'Good',
  serial_number text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.staff_attendance (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.profiles(id) on delete cascade,
  clinic_id uuid references public.clinics(id) on delete set null,
  attendance_date date not null,
  slot text not null check (slot in ('morning', 'evening')),
  status text not null check (status in ('present', 'absent')) default 'absent',
  notes text not null default '',
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (staff_id, attendance_date, slot)
);

create index if not exists idx_staff_attendance_date on public.staff_attendance(attendance_date);
create index if not exists idx_staff_attendance_staff on public.staff_attendance(staff_id);
create index if not exists idx_staff_attendance_clinic on public.staff_attendance(clinic_id);

alter table public.equipment add column if not exists quantity numeric(12,2) not null default 1;
alter table public.equipment add column if not exists unit_price numeric(12,2);
alter table public.equipment add column if not exists minimum_quantity numeric(12,2) not null default 0;
alter table public.equipment add column if not exists details text not null default '';

create or replace function public.current_profile_role()
returns text
language sql
security definer
stable
as $$
  select role from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.current_profile_clinic_id()
returns uuid
language sql
security definer
stable
as $$
  select clinic_id from public.profiles where id = auth.uid() and status = 'active'
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select coalesce(public.current_profile_role() = 'admin', false)
$$;

create or replace function public.can_access_clinic(target_clinic_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select public.is_admin() or public.current_profile_clinic_id() = target_clinic_id
$$;

alter table public.clinics enable row level security;
alter table public.profiles enable row level security;
alter table public.patients enable row level security;
alter table public.visits enable row level security;
alter table public.therapy_sessions enable row level security;
alter table public.equipment enable row level security;
alter table public.staff_attendance enable row level security;

create policy "Active users can view clinics in scope"
on public.clinics for select
using (public.is_admin() or id = public.current_profile_clinic_id());

create policy "Public can view active clinics for signup"
on public.clinics for select
using (active = true);

create policy "Admins manage clinics"
on public.clinics for all
using (public.is_admin())
with check (public.is_admin());

create policy "Users view own profile and admins view all"
on public.profiles for select
using (id = auth.uid() or public.is_admin());

create policy "Admins update staff profiles"
on public.profiles for update
using (public.is_admin())
with check (public.is_admin());

create policy "Staff can create pending own profile"
on public.profiles for insert
with check (id = auth.uid() and role = 'staff' and status = 'pending');

create policy "Patients visible by clinic"
on public.patients for select
using (public.can_access_clinic(clinic_id));

create policy "Patients managed by clinic"
on public.patients for all
using (public.can_access_clinic(clinic_id))
with check (public.can_access_clinic(clinic_id));

create policy "Visits visible by clinic"
on public.visits for select
using (public.can_access_clinic(clinic_id));

create policy "Visits managed by clinic"
on public.visits for all
using (public.can_access_clinic(clinic_id))
with check (public.can_access_clinic(clinic_id));

create policy "Therapies visible by clinic"
on public.therapy_sessions for select
using (public.can_access_clinic(clinic_id));

create policy "Therapies managed by clinic"
on public.therapy_sessions for all
using (public.can_access_clinic(clinic_id))
with check (public.can_access_clinic(clinic_id));

create policy "Equipment visible by clinic"
on public.equipment for select
using (public.can_access_clinic(clinic_id));

create policy "Equipment managed by clinic"
on public.equipment for all
using (public.can_access_clinic(clinic_id))
with check (public.can_access_clinic(clinic_id));

drop policy if exists "Admins manage staff attendance" on public.staff_attendance;
drop policy if exists "allow_all_staff_attendance" on public.staff_attendance;

create policy "allow_all_staff_attendance"
on public.staff_attendance for all
using (true)
with check (true);

grant all on public.staff_attendance to anon, authenticated, service_role;

insert into public.clinics (name, address, phone)
values
  ('North Spine & Rehab', '12 Sunrise Avenue, North District', '+1 555 0101'),
  ('Central Physio Studio', '45 Wellness Street, City Center', '+1 555 0115'),
  ('South Mobility Clinic', '88 Lake Road, South Point', '+1 555 0188')
on conflict do nothing;
