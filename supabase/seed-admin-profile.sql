-- Create the auth user in Supabase Auth first, then replace the UUID below
-- with that user's auth.users.id value.
insert into public.profiles (
  id,
  name,
  email,
  phone,
  role,
  title,
  clinic_id,
  status
) values (
  '00000000-0000-0000-0000-000000000000',
  'Clinic Administrator',
  'admin@physiocare.local',
  '+1 555 1000',
  'admin',
  'Clinic Administrator',
  null,
  'active'
)
on conflict (id) do update set
  name = excluded.name,
  email = excluded.email,
  phone = excluded.phone,
  role = excluded.role,
  title = excluded.title,
  clinic_id = excluded.clinic_id,
  status = excluded.status;
