import { createClient } from '@supabase/supabase-js';
import { fromDbScheduledAt, toDbScheduledAt } from './datetime';
import { normalizeMoney, withLegacyPayments } from './payments';
import type { AppData, Clinic, ClinicExpense, Equipment, HomeVisitDetails, Patient, PatientReport, PaymentAllocation, PaymentMethod, PaymentRecord, Profile, TherapySession } from '../types';

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
  patient_history: string | null;
  case_type: string | null;
  condition: string | null;
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

type PaymentRow = {
  id: string;
  patient_id: string;
  clinic_id: string | null;
  paid_at: string;
  amount: number;
  method: PaymentMethod;
  notes: string | null;
  allocations: PaymentAllocation[] | null;
  created_at: string;
};

type ClinicExpenseRow = {
  id: string;
  clinic_id: string;
  category: string;
  amount: number;
  date: string;
  recurrence: string;
  notes: string;
};

type EquipmentRow = {
  id: string;
  clinic_id: string;
  name: string;
  category: string;
  purchase_date: string | null;
  purchase_cost: number | null;
  quantity: number | null;
  unit_price: number | null;
  minimum_quantity: number | null;
  details: string | null;
  condition: string;
  serial_number: string;
  notes: string;
};

function isMissingTableError(error: unknown, tableName: string): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown };
  const haystack = [value.code, value.message, value.details].map(String).join(' ').toLowerCase();
  return haystack.includes(tableName.toLowerCase()) &&
    (haystack.includes('does not exist') || haystack.includes('could not find') || haystack.includes('pgrst205'));
}

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
    patientHistory:   row.patient_history ?? '',
    caseType:         row.case_type ?? '',
    condition:        row.condition ?? row.home_visit_details?.condition ?? '',
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
    scheduledAt: fromDbScheduledAt(row.scheduled_at),
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

export function mapPayment(row: PaymentRow): PaymentRecord {
  return {
    id: row.id,
    patientId: row.patient_id,
    clinicId: row.clinic_id,
    paidAt: row.paid_at,
    amount: normalizeMoney(Number(row.amount)),
    method: row.method ?? 'Cash',
    notes: row.notes ?? '',
    allocations: (row.allocations ?? []).map((allocation) => ({
      ...allocation,
      amount: normalizeMoney(allocation.amount),
    })),
    createdAt: row.created_at,
  };
}

export function mapClinicExpense(row: ClinicExpenseRow): ClinicExpense {
  return {
    id: row.id,
    clinicId: row.clinic_id,
    category: row.category as ClinicExpense['category'],
    amount: Number(row.amount),
    date: row.date,
    recurrence: row.recurrence as ClinicExpense['recurrence'],
    notes: row.notes ?? '',
  };
}

export function mapEquipment(row: EquipmentRow): Equipment {
  const legacyCost = row.purchase_cost != null ? Number(row.purchase_cost) : null;
  const quantity = row.quantity != null ? Number(row.quantity) : 1;
  const unitPrice = row.unit_price != null ? Number(row.unit_price) : legacyCost;
  return {
    id: row.id,
    clinicId: row.clinic_id,
    name: row.name,
    category: row.category as Equipment['category'],
    purchaseDate: row.purchase_date ?? '',
    purchaseCost: legacyCost,
    quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 1,
    unitPrice: unitPrice != null && Number.isFinite(unitPrice) ? unitPrice : null,
    minimumQuantity: row.minimum_quantity != null && Number.isFinite(Number(row.minimum_quantity)) ? Math.max(0, Number(row.minimum_quantity)) : 0,
    details: row.details ?? '',
    condition: row.condition as Equipment['condition'],
    serialNumber: row.serial_number ?? '',
    notes: row.notes ?? '',
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

  const [clinics, profiles, patients, therapySessions, payments, expenses, equipment] = await Promise.all([
    supabase.from('clinics').select('*').order('name'),
    supabase.from('profiles').select('*').order('name'),
    supabase.from('patients').select('*').order('name'),
    supabase.from('therapy_sessions').select('*').order('scheduled_at'),
    supabase.from('patient_payments').select('*').order('paid_at'),
    supabase.from('clinic_expenses').select('*').order('date', { ascending: false }),
    supabase.from('equipment').select('*').order('name'),
  ]);

  const paymentsTableMissing = isMissingTableError(payments.error, 'patient_payments');
  const error = clinics.error ?? profiles.error ?? patients.error ?? therapySessions.error
    ?? (paymentsTableMissing ? null : payments.error)
    ?? expenses.error ?? equipment.error;
  if (error) throw error;

  const mappedSessions = (therapySessions.data ?? []).map((row) => mapTherapySession(row as TherapySessionRow));
  const mappedPayments = paymentsTableMissing
    ? []
    : (payments.data ?? []).map((row) => mapPayment(row as PaymentRow));

  return {
    clinics:         (clinics.data         ?? []).map((row) => mapClinic(row as ClinicRow)),
    profiles:        (profiles.data        ?? []).map((row) => mapProfile(row as ProfileRow)),
    patients:        (patients.data        ?? []).map((row) => mapPatient(row as PatientRow)),
    therapySessions: mappedSessions,
    payments:        withLegacyPayments(mappedSessions, mappedPayments),
    expenses:        (expenses.data        ?? []).map((row) => mapClinicExpense(row as ClinicExpenseRow)),
    equipment:       (equipment.data       ?? []).map((row) => mapEquipment(row as EquipmentRow)),
  };
}

// ── Write helpers ──────────────────────────────────────────

export const toPatientRow = (patient: Omit<Patient, 'id' | 'active'>) => ({
  clinic_id:          patient.clinicId || null,
  name:               patient.name,
  phone:              patient.phone,
  date_of_birth:      patient.dateOfBirth || null,
  gender:             patient.gender,
  address:            patient.address,
  signs:              patient.signs ?? '',
  symptoms:           patient.symptoms ?? '',
  patient_history:    patient.patientHistory ?? '',
  case_type:          patient.caseType ?? '',
  condition:          patient.condition ?? '',
  diagnosis:          patient.diagnosis,
  referral_source:    patient.referralSource,
  emergency_contact:  patient.emergencyContact,
  notes:              patient.notes,
  complications:      patient.complications ?? '',
  surgeries:          patient.surgeries ?? '',
  reports:            (patient.reports ?? []).map(({ id, title, date, notes, fileUrl, fileName }) => ({
    id,
    title,
    date,
    notes,
    ...(fileUrl ? { fileUrl } : {}),
    ...(fileName ? { fileName } : {}),
  })),
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
  scheduled_at:      toDbScheduledAt(session.scheduledAt),
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

export const toPaymentRow = (payment: Omit<PaymentRecord, 'id'>) => ({
  patient_id:  payment.patientId,
  clinic_id:   payment.clinicId || null,
  paid_at:     payment.paidAt,
  amount:      normalizeMoney(payment.amount),
  method:      payment.method,
  notes:       payment.notes,
  allocations: payment.allocations.map((allocation) => ({
    ...allocation,
    amount: normalizeMoney(allocation.amount),
  })),
  created_at:  payment.createdAt,
});

export const toClinicExpenseRow = (expense: Omit<ClinicExpense, 'id'>) => ({
  clinic_id:  expense.clinicId,
  category:   expense.category,
  amount:     Number(expense.amount),
  date:       expense.date,
  recurrence: expense.recurrence,
  notes:      expense.notes ?? '',
});

export const toEquipmentRow = (item: Omit<Equipment, 'id'>) => ({
  clinic_id:      item.clinicId,
  name:           item.name,
  category:       item.category,
  purchase_date:  item.purchaseDate || null,
  purchase_cost:  item.purchaseCost,
  quantity:       Number(item.quantity) || 0,
  unit_price:     item.unitPrice,
  minimum_quantity: Number(item.minimumQuantity) || 0,
  details:        item.details ?? '',
  condition:      item.condition,
  serial_number:  item.serialNumber ?? '',
  notes:          item.notes ?? '',
});

// ── Expense & equipment mutations (verify rows affected) ─────────────────────

export async function insertClinicExpense(expense: Omit<ClinicExpense, 'id'>, id: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('clinic_expenses')
    .insert({ ...toClinicExpenseRow(expense), id })
    .select('id')
    .single();
  if (error) throw error;
  if (!data) throw new Error('Expense could not be saved.');
  return data.id as string;
}

export async function updateClinicExpenseRecord(expense: ClinicExpense) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { id, ...rest } = expense;
  const { data, error } = await supabase
    .from('clinic_expenses')
    .update(toClinicExpenseRow(rest))
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Expense not found or could not be updated.');
}

export async function deleteClinicExpenseRecord(id: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error, count } = await supabase
    .from('clinic_expenses')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) throw error;
  if (!count) throw new Error('Expense not found or could not be deleted.');
}

export async function insertEquipmentRecord(item: Omit<Equipment, 'id'>, id: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('equipment')
    .insert({ ...toEquipmentRow(item), id })
    .select('id')
    .single();
  if (error) throw error;
  if (!data) throw new Error('Equipment could not be saved.');
  return data.id as string;
}

export async function updateEquipmentRecord(item: Equipment) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { id, ...rest } = item;
  const { data, error } = await supabase
    .from('equipment')
    .update(toEquipmentRow(rest))
    .eq('id', id)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Equipment not found or could not be updated.');
}

export async function deleteEquipmentRecord(id: string) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { error, count } = await supabase
    .from('equipment')
    .delete({ count: 'exact' })
    .eq('id', id);
  if (error) throw error;
  if (!count) throw new Error('Equipment not found or could not be deleted.');
}
