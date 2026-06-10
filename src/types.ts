export type Role = 'admin' | 'staff';
export type StaffStatus = 'pending' | 'active' | 'inactive';
export type SessionStatus = 'scheduled' | 'completed' | 'cancelled' | 'no_show';
export type SessionType = 'clinic' | 'home';
export type TherapyLevel = 'basic' | 'rehab' | 'advance';
export type Gender = 'Female' | 'Male' | 'Other';

export interface Clinic {
  id: string;
  name: string;
  address: string;
  phone: string;
  active: boolean;
}

export interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: Role;
  title: string;
  clinicId: string | null;
  status: StaffStatus;
}

export interface PatientReport {
  id: string;
  title: string;
  date: string;
  notes: string;
  /** R2 object key (patients/...) or legacy external URL */
  fileUrl?: string;
  fileName?: string;
}

export interface HomeSessionRecord {
  notes: string;
  amount: number | null;
}

export interface HomeVisitDetails {
  caregiverName: string;
  caregiverRelation: string;
  caregiverPhone: string;
  condition: string;
  homeVisitStartDate: string;
  dischargeDate: string;
  homeSessionLog: string[]; // ISO date strings of sessions marked done
  homeSessionNotes: Record<string, HomeSessionRecord>; // per-day notes + amount
}

export interface Patient {
  id: string;
  clinicId: string | null;
  name: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender;
  address: string;
  signs: string;
  symptoms: string;
  diagnosis: string;
  referralSource: string;
  emergencyContact: string;
  notes: string;
  complications: string;
  surgeries: string;
  active: boolean;
  reports: PatientReport[];
  homeVisitDetails?: HomeVisitDetails;
}

export interface TherapySession {
  id: string;
  patientId: string;
  clinicId: string | null;
  scheduledAt: string;
  therapyType: string;
  sessionType: SessionType;
  therapyLevel: TherapyLevel;
  assignedStaffId: string;
  status: SessionStatus;
  completedAt: string | null;
  notes: string;
  treatmentNotes: string;
  amountCollected: number | null;
}

export type ExpenseCategory = 'Rent' | 'Utilities' | 'Salaries' | 'Supplies' | 'Maintenance' | 'Other';
export type ExpenseRecurrence = 'one-time' | 'monthly' | 'annual';

export interface ClinicExpense {
  id: string;
  clinicId: string;
  category: ExpenseCategory;
  amount: number;
  date: string;
  recurrence: ExpenseRecurrence;
  notes: string;
}

export type EquipmentCondition = 'Good' | 'Fair' | 'Needs service' | 'Retired';
export type EquipmentCategory = 'Machine' | 'Hand tool' | 'Consumable' | 'Furniture' | 'Other';

export interface Equipment {
  id: string;
  clinicId: string;
  name: string;
  category: EquipmentCategory;
  purchaseDate: string;
  purchaseCost: number | null;
  condition: EquipmentCondition;
  serialNumber: string;
  notes: string;
}

export interface Credentials {
  email: string;
  password: string;
}

export interface SignupForm {
  name: string;
  email: string;
  password: string;
  phone: string;
  title: string;
  clinicId: string;
}

export interface AppData {
  clinics: Clinic[];
  profiles: Profile[];
  patients: Patient[];
  therapySessions: TherapySession[];
  expenses: ClinicExpense[];
  equipment: Equipment[];
}
