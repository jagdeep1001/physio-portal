import { createClient } from '@supabase/supabase-js';
import type { AppData, Clinic, HomeVisitDetails, Patient, PatientReport, Profile, TherapySession } from '../types';

const supabaseUrl      = import.meta.env.VITE_SUPABASE_URL      as string | undefined;
const supabaseAnonKey  = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!)
  : null;

// ── Row types (matching DB columns) ────────────────────────

type ClinicRow = {
  id: string;
  name: string;
  address: string;
  phone: string;
  active: boolean;
};

type ProfileRow = {
  id: string;
  name: string;
  email: string;
  password: string;
  phone: string;
  role: Profile['role'];
  title: string;
  clinic_id: string | null;
  status: Profile['status'];
};

type PatientRow = {
  id: string;
  clinic_id: string | null;
  name: string;
  phone: string;
  date_of_birth: string;
  gender: Patient['gender'];
  address: string;
  signs: string | null;
  symptoms: string | null;
  diagnosis: string;
  referral_source: string;
  emergency_contact: string;
  notes: string;
  complications: string | null;
  surgeries: string | null;
  active: boolean;
  reports: PatientReport[] | null;
  home_visit_details: HomeVisitDetails | null;
};

type TherapySessionRow = {
  id: string;
  patient_id: string;
  clinic_id: string | null;
  scheduled_at: string;
  therapy_type: string;
  session_type: TherapySession['sessionType'];
  therapy_level: TherapySession['therapyLevel'] | null;
  assigned_staff_id: string | null;   // nullable uuid in DB
  status: TherapySession['status'];
  completed_at: string | null;
  notes: string | null;
  treatment_notes: string | null;
  amount_collected: number | null;
};

// ── Mappers ────────────────────────────────────────────────

export function mapClinic(row: ClinicRow): Clinic {
  return row;
}

export function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    title: row.title,
    clinicId: row.clinic_id,
    status: row.status,
  };
}

export function mapPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    phone: row.phone,
    dateOfBirth: row.date_of_birth ?? '',
    gender: row.gender,
    address: row.address ?? '',
    signs:            row.signs    ?? '',
    symptoms:         row.symptoms ?? '',
    diagnosis: row.diagnosis ?? '',
    referralSource: row.referral_source ?? '',
    emergencyContact: row.emergency_contact ?? '',
    notes: row.notes ?? '',
    complications: row.complications ?? '',
    surgeries: row.surgeries ?? '',
    active: row.active,
    reports: row.reports ?? [],
    homeVisitDetails: row.home_visit_details
      ? {
          ...row.home_visit_details,
          caregiverPhone:   row.home_visit_details.caregiverPhone   ?? '',
          homeVisitStartDate: row.home_visit_details.homeVisitStartDate ?? '',
          homeSessionLog:   row.home_visit_details.homeSessionLog   ?? [],
          homeSessionNotes: row.home_visit_details.homeSessionNotes ?? {},
        }
      : undefined,
  };
}

export function mapTherapySession(row: TherapySessionRow): TherapySession {
  return {
    id: row.id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    scheduledAt: row.scheduled_at,
    therapyType: row.therapy_type,
    sessionType: row.session_type ?? 'clinic',
    therapyLevel: row.therapy_level ?? 'basic',
    assignedStaffId: row.assigned_staff_id ?? '',  // DB may store null; frontend uses ''
    status: row.status,
    completedAt: row.completed_at ?? null,
    notes: row.notes ?? '',
    treatmentNotes: row.treatment_notes ?? '',
    amountCollected: row.amount_collected ?? null,
  };
}

// ── Auth: login against profiles table (no Supabase Auth) ──
export async function loginWithProfiles(email: string, password: string): Promise<Profile | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('email', email.trim().toLowerCase())
    .eq('password', password)
    .single();
  if (error || !data) return null;
  return mapProfile(data as ProfileRow);
}

// ── Load all data ──────────────────────────────────────────

export async function loadRemoteData(): Promise<AppData> {
  if (!supabase) throw new Error('Supabase is not configured.');

  const [clinics, profiles, patients, therapySessions] = await Promise.all([
    supabase.from('clinics').select('*').order('name'),
    supabase.from('profiles').select('*').order('name'),
    supabase.from('patients').select('*').order('name'),
    supabase.from('therapy_sessions').select('*').order('scheduled_at'),
  ]);

  const error = clinics.error ?? profiles.error ?? patients.error ?? therapySessions.error;
  if (error) throw error;

  return {
    clinics:         (clinics.data         ?? []).map((row) => mapClinic(row as ClinicRow)),
    profiles:        (profiles.data        ?? []).map((row) => mapProfile(row as ProfileRow)),
    patients:        (patients.data        ?? []).map((row) => mapPatient(row as PatientRow)),
    therapySessions: (therapySessions.data ?? []).map((row) => mapTherapySession(row as TherapySessionRow)),
  };
}

// ── Write helpers ──────────────────────────────────────────

export const toPatientRow = (patient: Omit<Patient, 'id' | 'active'>) => ({
  clinic_id:          patient.clinicId,
  name:               patient.name,
  phone:              patient.phone,
  date_of_birth:      patient.dateOfBirth || null,
  gender:             patient.gender,
  address:            patient.address,
  signs:              patient.signs ?? '',
  symptoms:           patient.symptoms ?? '',
  diagnosis:          patient.diagnosis,
  referral_source:    patient.referralSource,
  emergency_contact:  patient.emergencyContact,
  notes:              patient.notes,
  complications:      patient.complications ?? '',
  surgeries:          patient.surgeries ?? '',
  reports:            patient.reports ?? [],
  home_visit_details: patient.homeVisitDetails ?? null,
});

export const toProfileRow = (profile: Omit<Profile, 'id'> & { password?: string }) => ({
  name:      profile.name,
  email:     profile.email,
  password:  profile.password ?? '',
  phone:     profile.phone,
  role:      profile.role,
  title:     profile.title,
  clinic_id: profile.clinicId,
  status:    profile.status,
});

export const toTherapySessionRow = (session: Omit<TherapySession, 'id'>) => ({
  patient_id:        session.patientId,
  clinic_id:         session.clinicId || null,
  scheduled_at:      session.scheduledAt,
  therapy_type:      session.therapyType,
  session_type:      session.sessionType,
  therapy_level:     session.therapyLevel,
  // Convert empty string to null — assigned_staff_id is a uuid column, '' is invalid
  assigned_staff_id: session.assignedStaffId || null,
  status:            session.status,
  completed_at:      session.completedAt || null,
  notes:             session.notes,
  treatment_notes:   session.treatmentNotes,
  amount_collected:  session.amountCollected,
});
