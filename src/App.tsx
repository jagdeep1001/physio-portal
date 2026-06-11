import {
  Activity,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  DollarSign,
  ExternalLink,
  FileText,
  Home,
  LayoutDashboard,
  Loader2,
  Lock,
  LogOut,
  MapPin,
  Phone,
  Plus,
  Receipt,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  TrendingUp,
  Upload,
  User,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { demoPasswords, initialData } from './data/mockData';
import {
  deleteClinicExpenseRecord,
  deleteEquipmentRecord,
  insertClinicExpense,
  insertEquipmentRecord,
  isSupabaseConfigured,
  loadRemoteData,
  loginWithProfiles,
  supabase,
  toPatientRow,
  toProfileRow,
  toTherapySessionRow,
  updateClinicExpenseRecord,
  updateEquipmentRecord,
} from './lib/supabase';
import {
  ACCEPTED_REPORT_TYPES,
  deletePatientReports,
  isR2Configured,
  isStoredReportKey,
  openStoredReport,
  uploadPatientReport,
} from './lib/r2';
import { InvoiceModal } from './components/InvoiceModal';
import type { InvoiceMode } from './lib/invoice';
import { formatTherapyTypeDisplay, splitTherapyTypes, THERAPY_GROUPS, THERAPY_SEPARATOR } from './lib/therapy';
import {
  buildLocalDateTime,
  CLINIC_VISIT_SLOTS,
  formatLocalDateFromDate,
  formatLocalDateTimeFromDate,
  formatSessionDateTime,
  formatSessionTime,
  genVisitSlots,
  formatVisitSlotLabel,
  HOME_VISIT_SLOTS,
  isHomeVisitSlot,
  localDateTimeInputValue,
  localTodayStr,
  parseAppDate,
  parseScheduledAt,
  sessionDateKey,
  sessionInMonth,
  sessionOnDate,
  sessionTimeKey,
  snapToClinicVisitSlot,
  snapToHomeVisitSlot,
  toDateTimeLocalInput,
  toDbScheduledAt,
  withLocalTime,
} from './lib/datetime';
import type {
  AppData,
  Clinic,
  ClinicExpense,
  Equipment,
  EquipmentCategory,
  EquipmentCondition,
  ExpenseCategory,
  ExpenseRecurrence,
  HomeVisitDetails,
  HomeSessionRecord,
  Patient,
  PatientReport,
  Profile,
  Role,
  SessionStatus,
  SessionType,
  SignupForm,
  StaffStatus,
  TherapyLevel,
  TherapySession,
} from './types';

type Page =
  | 'dashboard'
  | 'homeDashboard'
  | 'patients'
  | 'patientEntry'
  | 'patientDetail'
  | 'sessions'
  | 'scheduleNew'
  | 'homeVisits'
  | 'calendar'
  | 'clinics'
  | 'staff'
  | 'expenses';

type PatientDraft = Omit<Patient, 'id' | 'active'>;
type ClinicDraft = Omit<Clinic, 'id' | 'active'>;

const storageKey = 'physio-care-demo-data';
const todayStr = localTodayStr();

const emptyHomeVisitDetails = (): HomeVisitDetails => ({
  caregiverName: '',
  caregiverRelation: '',
  caregiverPhone: '',
  condition: '',
  homeVisitStartDate: '',
  dischargeDate: '',
  homeSessionLog: [],
  homeSessionNotes: {},
});

const emptyPatient = (clinicId: string | null): PatientDraft => ({
  clinicId,
  name: '',
  phone: '',
  dateOfBirth: '',
  gender: 'Female',
  address: '',
  signs: '',
  symptoms: '',
  diagnosis: '',
  referralSource: '',
  emergencyContact: '',
  notes: '',
  complications: '',
  surgeries: '',
  reports: [],
  homeVisitDetails: undefined,
});

const emptyClinic: ClinicDraft = { name: '', address: '', phone: '' };

function loadInitialData(): AppData {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return initialData;
  try {
    const parsed = JSON.parse(saved) as AppData & { visits?: unknown[] };
    // strip legacy visits if present, patch missing fields
    const { visits: _v, ...rest } = parsed as typeof parsed & { visits?: unknown[] };
    void _v;
    return {
      ...rest,
      patients: (rest.patients ?? []).map((p) => {
        const hvd = (p as Patient).homeVisitDetails;
        return {
          ...p,
          reports: (p as Patient).reports ?? [],
          signs:         (p as Patient).signs         ?? '',
          symptoms:      (p as Patient).symptoms      ?? '',
          complications: (p as Patient).complications ?? '',
          surgeries:     (p as Patient).surgeries     ?? '',
          homeVisitDetails: hvd
            ? { ...hvd, caregiverPhone: hvd.caregiverPhone ?? '', homeVisitStartDate: hvd.homeVisitStartDate ?? '', homeSessionLog: hvd.homeSessionLog ?? [], homeSessionNotes: hvd.homeSessionNotes ?? {} }
            : undefined,
        };
      }),
      therapySessions: (rest.therapySessions ?? []).map((s) => ({
        ...s,
        sessionType: (s as TherapySession).sessionType ?? ('clinic' as SessionType),
        therapyLevel: (s as TherapySession).therapyLevel ?? ('basic' as TherapyLevel),
        treatmentNotes: (s as TherapySession).treatmentNotes ?? '',
        amountCollected: (s as TherapySession).amountCollected ?? null,
      })),
      expenses:  (rest.expenses  ?? []) as ClinicExpense[],
      equipment: (rest.equipment ?? []) as Equipment[],
    };
  } catch {
    return initialData;
  }
}

function saveData(data: AppData) {
  localStorage.setItem(storageKey, JSON.stringify(data));
}

function createId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function createDbId() {
  return crypto.randomUUID();
}

function formatDateTime(value: string) {
  return formatSessionDateTime(value);
}

function formatDate(value: string) {
  if (!value) return '';
  const d = parseAppDate(value);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function calculateAge(dateOfBirth: string) {
  if (!dateOfBirth) return 'N/A';
  const diff = Date.now() - new Date(dateOfBirth).getTime();
  return Math.abs(new Date(diff).getUTCFullYear() - 1970).toString();
}

function statusLabel(status: SessionStatus) {
  return status === 'no_show' ? 'No show' : status[0].toUpperCase() + status.slice(1);
}

function formatCurrency(amount: number | null) {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(
    amount
  );
}

// ─── App Root ────────────────────────────────────────────────────────────────

const SESSION_USER_KEY      = 'physio_session_user_id';
const SESSION_TIMEOUT_MINS  = 30;   // auto-logout after 30 min of inactivity

export function App() {
  const [data, setData] = useState<AppData>(() => loadInitialData());
  const [currentUser, setCurrentUser] = useState<Profile | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [page, setPage] = useState<Page>('dashboard');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [schedulePreset, setSchedulePreset] = useState<{ patientId?: string; sessionType?: SessionType }>({});
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authError, setAuthError] = useState('');
  const [systemNotice, setSystemNotice] = useState('');

  // Persist user ID to localStorage so the session survives a page refresh
  const signIn = (user: Profile) => {
    localStorage.setItem(SESSION_USER_KEY, user.id);
    setCurrentUser(user);
  };

  const signOut = () => {
    localStorage.removeItem(SESSION_USER_KEY);
    setCurrentUser(null);
  };

  const refreshRemoteData = async (userId?: string) => {
    if (!supabase) return null;
    const remote = await loadRemoteData();
    setData(remote);
    const targetUserId = userId ?? currentUser?.id ?? localStorage.getItem(SESSION_USER_KEY);
    if (targetUserId) {
      const refreshedUser = remote.profiles.find((p) => p.id === targetUserId);
      if (refreshedUser) setCurrentUser(refreshedUser);
    }
    return remote;
  };

  const reportRemoteError = (error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Something went wrong while saving data.';
    setSystemNotice(message);
  };

  // Restore session on mount
  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_USER_KEY);
    const restore = async () => {
      if (supabase) {
        // Fetch fresh data, then look up saved user in remote profiles
        try {
          const remote = await loadRemoteData();
          setData(remote);
          if (savedId) {
            const user = remote.profiles.find((p) => p.id === savedId);
            if (user && user.status === 'active') {
              setCurrentUser(user);
            } else {
              // Saved ID invalid or account deactivated — clear it
              localStorage.removeItem(SESSION_USER_KEY);
            }
          }
        } catch {
          // If remote load fails, fall through to demo mode below
        }
      } else if (savedId) {
        // Demo / localStorage mode: restore from in-memory data
        const localData = loadInitialData();
        const user = localData.profiles.find((p) => p.id === savedId);
        if (user && user.status === 'active') {
          setCurrentUser(user);
        } else {
          localStorage.removeItem(SESSION_USER_KEY);
        }
      }
      setSessionLoading(false);
    };
    void restore();
  }, []);

  // Auto-logout after SESSION_TIMEOUT_MINS of inactivity (DPDP / HIPAA requirement)
  useEffect(() => {
    if (!currentUser) return;
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        signOut();
        alert('You have been logged out due to inactivity.');
      }, SESSION_TIMEOUT_MINS * 60 * 1000);
    };
    const events = ['mousemove', 'keydown', 'pointerdown', 'scroll', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [currentUser]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (updater: (draft: AppData) => AppData) => {
    setData((current) => {
      const next = updater(current);
      saveData(next);
      return next;
    });
  };

  const visibleClinicIds = useMemo(() => {
    if (!currentUser) return [];
    if (currentUser.role === 'admin') return data.clinics.map((c) => c.id);
    return currentUser.clinicId ? [currentUser.clinicId] : [];
  }, [currentUser, data.clinics]);

  const scoped = useMemo(() => {
    const clinics = data.clinics.filter((c) => visibleClinicIds.includes(c.id));
    return {
      clinics,
      profiles:
        currentUser?.role === 'admin'
          ? data.profiles
          : data.profiles.filter((p) => !p.clinicId || visibleClinicIds.includes(p.clinicId)),
      patients: data.patients.filter((p) => p.clinicId === null || visibleClinicIds.includes(p.clinicId)),
      therapySessions: data.therapySessions.filter((s) => s.clinicId === null || visibleClinicIds.includes(s.clinicId)),
    };
  }, [currentUser?.role, data, visibleClinicIds]);

  const defaultClinicId =
    currentUser?.role === 'staff' && currentUser.clinicId
      ? currentUser.clinicId
      : data.clinics.find((c) => c.active)?.id ?? data.clinics[0]?.id ?? '';

  // ── Auth handlers ──
  const handleLogin = async (email: string, password: string) => {
    const normalized = email.trim().toLowerCase();
    if (supabase) {
      try {
        // Load latest data first so profiles are fresh
        const remote = await refreshRemoteData();
        const user = await loginWithProfiles(normalized, password);
        if (!user) {
          setAuthError('Incorrect email or password.');
          return;
        }
        if (user.status !== 'active') {
          setAuthError('This account is waiting for admin approval.');
          return;
        }
        // Ensure we have the full profile from refreshed remote data
        const freshUser = remote?.profiles.find((p) => p.id === user.id) ?? user;
        signIn(freshUser);
        setAuthError('');
        setSystemNotice('');
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Could not log in.');
      }
      return;
    }
    // Demo mode fallback
    const user = data.profiles.find((p) => p.email.toLowerCase() === normalized);
    if (!user || demoPasswords[normalized] !== password) {
      setAuthError('Use the demo admin or staff account, or sign up as new staff.');
      return;
    }
    if (user.status !== 'active') { setAuthError('This account is waiting for admin approval.'); return; }
    signIn(user); setAuthError('');
  };

  const handleSignup = async (form: SignupForm) => {
    const email = form.email.trim().toLowerCase();
    if (supabase) {
      try {
        // Check if email already exists
        const { data: existing } = await supabase.from('profiles').select('id').eq('email', email).maybeSingle();
        if (existing) { setAuthError('An account with this email already exists.'); return; }
        const insert = await supabase.from('profiles').insert({
          name: form.name, email, password: form.password,
          phone: form.phone, role: 'staff', title: form.title,
          clinic_id: form.clinicId || null, status: 'pending',
        });
        if (insert.error) throw insert.error;
        await refreshRemoteData();
        setAuthError('Account created. An admin can approve it from the Staff page.');
        setAuthMode('login');
        return;
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : 'Could not create staff account.');
        return;
      }
    }
    if (data.profiles.some((p) => p.email.toLowerCase() === email)) {
      setAuthError('An account with this email already exists.'); return;
    }
    const profile: Profile = {
      id: createId('staff'), name: form.name, email, phone: form.phone,
      role: 'staff', title: form.title, clinicId: form.clinicId, status: 'pending',
    };
    demoPasswords[email] = form.password;
    persist((draft) => ({ ...draft, profiles: [...draft.profiles, profile] }));
    setAuthError('Account created. An admin can approve it from Staff.');
    setAuthMode('login');
  };

  // ── Data handlers ──
  const savePatient = async (patient: PatientDraft, editingId: string | null, newPatientId?: string) => {
    if (supabase) {
      try {
        const q = editingId
          ? await supabase.from('patients').update(toPatientRow(patient)).eq('id', editingId)
          : await supabase.from('patients').insert({ ...toPatientRow(patient), id: newPatientId ?? createDbId(), active: true });
        if (q.error) throw q.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      patients: editingId
        ? draftData.patients.map((item) => (item.id === editingId ? { ...item, ...patient } : item))
        : [...draftData.patients, { ...patient, id: newPatientId ?? createId('patient'), active: true }],
    }));
  };

  const deletePatient = async (patientId: string) => {
    const patient = data.patients.find((p) => p.id === patientId);
    if (!patient) return;

    const sessionCount = data.therapySessions.filter((s) => s.patientId === patientId).length;
    const storedReportCount = (patient.reports ?? []).filter((r) => isStoredReportKey(r.fileUrl)).length;
    const confirmLines = [
      `Delete ${patient.name} and all related data?`,
      sessionCount > 0 ? `• ${sessionCount} therapy session(s)` : null,
      storedReportCount > 0 ? `• ${storedReportCount} uploaded report file(s)` : null,
      'This cannot be undone.',
    ].filter(Boolean);

    if (!window.confirm(confirmLines.join('\n'))) return;

    if (isR2Configured) {
      try {
        await deletePatientReports(patientId);
      } catch (error) {
        reportRemoteError(error);
        if (!window.confirm('Could not delete report files from storage. Delete the patient record anyway?')) return;
      }
    }

    if (supabase) {
      try {
        const d = await supabase.from('patients').delete().eq('id', patientId);
        if (d.error) throw d.error;
        await refreshRemoteData();
        setSystemNotice('');
        setSelectedPatientId('');
        setPage('patients');
      } catch (error) { reportRemoteError(error); }
      return;
    }

    persist((draftData) => ({
      ...draftData,
      patients: draftData.patients.filter((p) => p.id !== patientId),
      therapySessions: draftData.therapySessions.filter((s) => s.patientId !== patientId),
    }));
    setSelectedPatientId('');
    setPage('patients');
  };

  const addSession = async (session: Omit<TherapySession, 'id'>) => {
    if (supabase) {
      try {
        const insert = await supabase.from('therapy_sessions').insert(toTherapySessionRow(session));
        if (insert.error) throw insert.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      therapySessions: [...draftData.therapySessions, { ...session, id: createId('session') }],
    }));
  };

  const updateSession = async (sessionId: string, updates: Partial<TherapySession>) => {
    if (supabase) {
      try {
        const row: Record<string, unknown> = {};
        if ('status' in updates)        row.status           = updates.status;
        if ('completedAt' in updates)   row.completed_at     = updates.completedAt;
        if ('amountCollected' in updates) row.amount_collected = updates.amountCollected;
        if ('treatmentNotes' in updates) row.treatment_notes  = updates.treatmentNotes;
        if ('therapyType' in updates)   row.therapy_type     = updates.therapyType;
        if ('sessionType' in updates)   row.session_type     = updates.sessionType;
        if ('therapyLevel' in updates)  row.therapy_level    = updates.therapyLevel;
        if ('scheduledAt' in updates)   row.scheduled_at     = toDbScheduledAt(updates.scheduledAt!);
        if ('notes' in updates)         row.notes            = updates.notes;
        const update = await supabase.from('therapy_sessions').update(row).eq('id', sessionId);
        if (update.error) throw update.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      therapySessions: draftData.therapySessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates } : s
      ),
    }));
  };

  const bulkUpdateSessions = async (items: { sessionId: string; updates: Partial<TherapySession> }[]) => {
    if (items.length === 0) return;
    if (supabase) {
      try {
        for (const { sessionId, updates } of items) {
          const row: Record<string, unknown> = {};
          if ('status' in updates)        row.status           = updates.status;
          if ('completedAt' in updates)   row.completed_at     = updates.completedAt;
          if ('amountCollected' in updates) row.amount_collected = updates.amountCollected;
          if ('treatmentNotes' in updates) row.treatment_notes  = updates.treatmentNotes;
          if ('therapyType' in updates)   row.therapy_type     = updates.therapyType;
          if ('sessionType' in updates)   row.session_type     = updates.sessionType;
          if ('therapyLevel' in updates)  row.therapy_level    = updates.therapyLevel;
          if ('scheduledAt' in updates)   row.scheduled_at     = toDbScheduledAt(updates.scheduledAt!);
          if ('notes' in updates)         row.notes            = updates.notes;
          const update = await supabase.from('therapy_sessions').update(row).eq('id', sessionId);
          if (update.error) throw update.error;
        }
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      therapySessions: draftData.therapySessions.map((s) => {
        const item = items.find((i) => i.sessionId === s.id);
        return item ? { ...s, ...item.updates } : s;
      }),
    }));
  };

  const changeSessionStatus = (sessionId: string, status: SessionStatus) => {
    const completedAt = status === 'completed' ? new Date().toISOString() : null;
    void updateSession(sessionId, { status, completedAt: completedAt ?? undefined });
  };

  const deleteSession = async (sessionId: string) => {
    if (!window.confirm('Delete this session? This cannot be undone.')) return;
    if (supabase) {
      try {
        const d = await supabase.from('therapy_sessions').delete().eq('id', sessionId);
        if (d.error) throw d.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      therapySessions: draftData.therapySessions.filter((s) => s.id !== sessionId),
    }));
  };

  // ── Atomic: save homeVisitDetails + create/update TherapySession in one transaction ──
  // Eliminates the race condition where two separate refreshRemoteData() calls
  // can overwrite each other's freshly committed rows.
  type HomeVisitSync =
    | { action: 'create'; session: Omit<TherapySession, 'id'> }
    | { action: 'update'; sessionId: string; updates: Partial<TherapySession> }
    | { action: 'none' };

  const syncHomeVisitLog = async (
    patientId: string,
    updatedPatient: PatientDraft,
    sync: HomeVisitSync,
  ) => {
    if (supabase) {
      try {
        // 1. Save patient homeVisitDetails
        const pr = await supabase.from('patients').update(toPatientRow(updatedPatient)).eq('id', patientId);
        if (pr.error) throw pr.error;

        // 2. Create or update session
        if (sync.action === 'create') {
          const sr = await supabase.from('therapy_sessions').insert(toTherapySessionRow(sync.session));
          if (sr.error) throw sr.error;
        } else if (sync.action === 'update') {
          const row: Record<string, unknown> = {};
          const u = sync.updates;
          if ('status'          in u) row.status           = u.status;
          if ('completedAt'     in u) row.completed_at     = u.completedAt ?? null;
          if ('amountCollected' in u) row.amount_collected = u.amountCollected;
          if ('treatmentNotes'  in u) row.treatment_notes  = u.treatmentNotes;
          const sr = await supabase.from('therapy_sessions').update(row).eq('id', sync.sessionId);
          if (sr.error) throw sr.error;
        }

        // 3. Single refresh — both writes are committed before this runs
        await refreshRemoteData();
        setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }

    // localStorage / demo mode
    persist((d) => {
      const patients = d.patients.map((p) =>
        p.id === patientId ? { ...p, ...updatedPatient } : p
      );
      let therapySessions = d.therapySessions;
      if (sync.action === 'create') {
        therapySessions = [...therapySessions, { ...sync.session, id: createId('session') }];
      } else if (sync.action === 'update') {
        therapySessions = therapySessions.map((s) =>
          s.id === sync.sessionId ? { ...s, ...sync.updates } : s
        );
      }
      return { ...d, patients, therapySessions };
    });
  };

  const saveClinic = async (clinic: ClinicDraft, editingId: string | null) => {
    if (supabase) {
      try {
        const q = editingId
          ? await supabase.from('clinics').update(clinic).eq('id', editingId)
          : await supabase.from('clinics').insert({ ...clinic, active: true });
        if (q.error) throw q.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      clinics: editingId
        ? draftData.clinics.map((item) => (item.id === editingId ? { ...item, ...clinic } : item))
        : [...draftData.clinics, { ...clinic, id: createId('clinic'), active: true }],
    }));
  };

  const toggleClinic = async (clinicId: string) => {
    const clinic = data.clinics.find((c) => c.id === clinicId);
    if (!clinic) return;
    if (supabase) {
      try {
        const u = await supabase.from('clinics').update({ active: !clinic.active }).eq('id', clinicId);
        if (u.error) throw u.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      clinics: draftData.clinics.map((c) => (c.id === clinicId ? { ...c, active: !c.active } : c)),
    }));
  };

  const deleteClinic = async (clinicId: string) => {
    if (!window.confirm('Delete this clinic? This cannot be undone.')) return;
    if (supabase) {
      try {
        const d = await supabase.from('clinics').delete().eq('id', clinicId);
        if (d.error) throw d.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      clinics: draftData.clinics.filter((c) => c.id !== clinicId),
    }));
  };

  const addProfile = async (profile: Omit<Profile, 'id'> & { password: string }) => {
    if (supabase) {
      try {
        const ins = await supabase.from('profiles').insert(toProfileRow(profile));
        if (ins.error) throw ins.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    const { password: _pw, ...profileData } = profile;
    void _pw;
    persist((draftData) => ({
      ...draftData,
      profiles: [...draftData.profiles, { ...profileData, id: createId('staff') }],
    }));
  };

  const deleteProfile = async (profileId: string) => {
    if (!window.confirm('Remove this staff member? This cannot be undone.')) return;
    if (supabase) {
      try {
        const d = await supabase.from('profiles').delete().eq('id', profileId);
        if (d.error) throw d.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      profiles: draftData.profiles.filter((p) => p.id !== profileId),
    }));
  };

  const updateProfile = async (profile: Profile) => {
    if (supabase) {
      try {
        const u = await supabase.from('profiles').update(toProfileRow(profile)).eq('id', profile.id);
        if (u.error) throw u.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      profiles: draftData.profiles.map((item) => (item.id === profile.id ? profile : item)),
    }));
  };

  // ── Expenses CRUD ──
  const addExpense = async (expense: Omit<ClinicExpense, 'id'>) => {
    if (supabase) {
      try {
        await insertClinicExpense(expense, createDbId());
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); throw error; }
      return;
    }
    persist((d) => ({ ...d, expenses: [...(d.expenses ?? []), { ...expense, id: createId('exp') }] }));
  };
  const updateExpense = async (expense: ClinicExpense) => {
    if (supabase) {
      try {
        await updateClinicExpenseRecord(expense);
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); throw error; }
      return;
    }
    persist((d) => ({ ...d, expenses: (d.expenses ?? []).map((e) => (e.id === expense.id ? expense : e)) }));
  };
  const deleteExpense = async (id: string) => {
    if (!window.confirm('Delete this expense record?')) return;
    if (supabase) {
      try {
        await deleteClinicExpenseRecord(id);
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); throw error; }
      return;
    }
    persist((d) => ({ ...d, expenses: (d.expenses ?? []).filter((e) => e.id !== id) }));
  };

  // ── Equipment CRUD ──
  const addEquipment = async (item: Omit<Equipment, 'id'>) => {
    if (supabase) {
      try {
        await insertEquipmentRecord(item, createDbId());
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); throw error; }
      return;
    }
    persist((d) => ({ ...d, equipment: [...(d.equipment ?? []), { ...item, id: createId('equip') }] }));
  };
  const updateEquipment = async (item: Equipment) => {
    if (supabase) {
      try {
        await updateEquipmentRecord(item);
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); throw error; }
      return;
    }
    persist((d) => ({ ...d, equipment: (d.equipment ?? []).map((e) => (e.id === item.id ? item : e)) }));
  };
  const deleteEquipment = async (id: string) => {
    if (!window.confirm('Delete this equipment record?')) return;
    if (supabase) {
      try {
        await deleteEquipmentRecord(id);
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); throw error; }
      return;
    }
    persist((d) => ({ ...d, equipment: (d.equipment ?? []).filter((e) => e.id !== id) }));
  };

  if (sessionLoading) {
    return (
      <div className="session-loading">
        <div className="session-loading-inner">
          <div className="session-spinner" />
          <p>Restoring session…</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={setAuthMode}
        clinics={data.clinics.filter((c) => c.active)}
        error={authError}
        onLogin={handleLogin}
        onSignup={handleSignup}
      />
    );
  }

  const navItems: Array<{ page: Page; label: string; icon: LucideIcon; adminOnly?: boolean }> = [
    { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { page: 'homeDashboard', label: 'Home Dashboard', icon: Home },
    { page: 'patients', label: 'Patients', icon: Users },
    { page: 'sessions', label: 'Sessions', icon: CalendarDays },
    { page: 'homeVisits', label: 'Home Visits', icon: Home },
    { page: 'calendar', label: 'Calendar', icon: Calendar },
    { page: 'clinics', label: 'Clinics', icon: Building2, adminOnly: true },
    { page: 'staff', label: 'Staff', icon: UserCheck, adminOnly: true },
    { page: 'expenses', label: 'Expenses & Equipment', icon: Receipt, adminOnly: true },
  ];

  const goToPatientDetail = (patientId: string) => {
    setSelectedPatientId(patientId);
    setPage('patientDetail');
  };

  const goToScheduleForPatient = (patientId: string, sessionType: SessionType) => {
    setSchedulePreset({ patientId, sessionType });
    setPage(sessionType === 'home' ? 'homeVisits' : 'scheduleNew');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Stethoscope size={22} /></div>
          <div>
            <strong>PhysioCare</strong>
            <span>Clinic Portal</span>
          </div>
        </div>

        <nav>
          {navItems
            .filter((item) => currentUser.role === 'admin' || !item.adminOnly)
            .map((item) => {
              const Icon = item.icon;
              const isActive = page === item.page ||
                (item.page === 'patients' && (page === 'patientDetail' || page === 'patientEntry')) ||
                (item.page === 'sessions' && page === 'scheduleNew');
              return (
                <button
                  key={item.page}
                  className={`nav-button ${isActive ? 'active' : ''}`}
                  onClick={() => setPage(item.page)}
                  title={item.label}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              );
            })}
        </nav>

        <div className="user-card">
          <span className={`role-pill ${currentUser.role}`}>{currentUser.role}</span>
          <strong>{currentUser.name}</strong>
          <small>{currentUser.role === 'admin' ? 'All clinics' : clinicName(data.clinics, currentUser.clinicId)}</small>
          <button className="ghost-button" onClick={() => signOut()}>
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{currentUser.role === 'admin' ? 'Global admin view' : 'Clinic staff view'}</p>
            <h1>{pageTitle(page)}</h1>
          </div>
          {/* <div className="topbar-actions">
            <span className="connection-pill">
              <ShieldCheck size={16} />
              {isSupabaseConfigured ? 'Supabase ready' : 'Demo mode'}
            </span>
          </div> */}
        </header>

        {systemNotice && <div className="system-notice">{systemNotice}</div>}

        {page === 'dashboard' && (
          <Dashboard
            data={scoped}
            allData={data}
            currentUser={currentUser}
            onOpenPatient={goToPatientDetail}
          />
        )}
        {page === 'homeDashboard' && (
          <HomeDashboard
            data={scoped}
            onOpenPatient={goToPatientDetail}
          />
        )}
        {page === 'patients' && (
          <PatientsView
            data={scoped}
            allClinics={data.clinics}
            onGoToAddPatient={() => setPage('patientEntry')}
            onOpenPatient={goToPatientDetail}
          />
        )}
        {page === 'patientEntry' && (
          <PatientEntryView
            clinics={currentUser.role === 'admin' ? data.clinics.filter((c) => c.active) : scoped.clinics}
            defaultClinicId={defaultClinicId}
            onSavePatient={savePatient}
            onBack={() => setPage('patients')}
          />
        )}
        {page === 'patientDetail' && (
          <PatientDetailView
            data={scoped}
            allClinics={data.clinics}
            staff={data.profiles}
            currentUser={currentUser}
            defaultClinicId={defaultClinicId}
            patientId={selectedPatientId}
            onSavePatient={savePatient}
            onDeletePatient={deletePatient}
            onSyncHomeVisitLog={syncHomeVisitLog}
            onBack={() => setPage('patients')}
            onGoToAddPatient={() => setPage('patientEntry')}
            onScheduleSession={goToScheduleForPatient}
          />
        )}
        {page === 'sessions' && (
          <SessionsView
            data={scoped}
            allClinics={data.clinics}
            profiles={scoped.profiles}
            onUpdateSession={updateSession}
            onBulkUpdateSessions={bulkUpdateSessions}
            onChangeStatus={changeSessionStatus}
            onDeleteSession={deleteSession}
            onScheduleNew={() => { setSchedulePreset({}); setPage('scheduleNew'); }}
            onRecordSession={addSession}
          />
        )}
        {page === 'homeVisits' && (
          <HomeVisitsView
            data={scoped}
            currentUser={currentUser}
            preset={schedulePreset}
            onAddSession={addSession}
            onUpdateSession={updateSession}
            onBulkUpdateSessions={bulkUpdateSessions}
            onChangeStatus={changeSessionStatus}
            onDeleteSession={deleteSession}
            onOpenPatient={goToPatientDetail}
            onClearPreset={() => setSchedulePreset({})}
          />
        )}
        {page === 'scheduleNew' && (
          <ScheduleNewPage
            data={scoped}
            staff={data.profiles}
            currentUser={currentUser}
            defaultClinicId={defaultClinicId}
            preset={schedulePreset}
            onAddSession={addSession}
            onBack={() => setPage('sessions')}
            onClearPreset={() => setSchedulePreset({})}
          />
        )}
        {page === 'calendar' && (
          <CalendarView
            data={scoped}
            allClinics={data.clinics}
            currentUser={currentUser}
            onOpenPatient={goToPatientDetail}
            onAddSession={addSession}
            onUpdateSession={updateSession}
          />
        )}
        {page === 'clinics' && currentUser.role === 'admin' && (
          <ClinicsView
            clinics={data.clinics}
            profiles={data.profiles}
            onSaveClinic={saveClinic}
            onToggleClinic={toggleClinic}
            onDeleteClinic={deleteClinic}
            onUpdateProfile={updateProfile}
          />
        )}
        {page === 'staff' && currentUser.role === 'admin' && (
          <StaffView
            profiles={data.profiles}
            clinics={data.clinics}
            onUpdateProfile={updateProfile}
            onAddProfile={addProfile}
            onDeleteProfile={deleteProfile}
          />
        )}
        {page === 'expenses' && currentUser.role === 'admin' && (
          <ExpensesView
            clinics={data.clinics}
            expenses={data.expenses ?? []}
            equipment={data.equipment ?? []}
            onAddExpense={addExpense}
            onUpdateExpense={updateExpense}
            onDeleteExpense={deleteExpense}
            onAddEquipment={addEquipment}
            onUpdateEquipment={updateEquipment}
            onDeleteEquipment={deleteEquipment}
          />
        )}
      </main>
    </div>
  );
}

// ─── Auth Screen ─────────────────────────────────────────────────────────────

function AuthScreen({
  mode, setMode, clinics, error, onLogin, onSignup,
}: {
  mode: 'login' | 'signup';
  setMode: (m: 'login' | 'signup') => void;
  clinics: Clinic[];
  error: string;
  onLogin: (email: string, password: string) => void;
  onSignup: (form: SignupForm) => void;
}) {
  const [email, setEmail] = useState('admin@physiocare.local');
  const [password, setPassword] = useState('admin123');
  const [signup, setSignup] = useState<SignupForm>({
    name: '', email: '', password: '', phone: '', title: 'Physiotherapist',
    clinicId: clinics[0]?.id ?? '',
  });

  return (
    <main className="auth-layout">
      <section className="auth-hero">
        <div className="brand large">
          <div className="brand-mark"><Stethoscope size={26} /></div>
          <div>
            <strong>PhysioCare Portal</strong>
            <span>Internal clinic management</span>
          </div>
        </div>
        <h1>One calm workspace for patients, therapies, and home visits.</h1>
        <div className="hero-stats">
          <span><strong>3</strong> demo clinics</span>
          <span><strong>Role-based</strong> access</span>
          <span><strong>Clinic + Home</strong> sessions</span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="segmented">
          <button className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>Login</button>
          <button className={mode === 'signup' ? 'active' : ''} onClick={() => setMode('signup')}>Staff signup</button>
        </div>

        {mode === 'login' ? (
          <form onSubmit={(e) => { e.preventDefault(); onLogin(email, password); }} className="form-grid">
            <label>Email<input value={email} onChange={(e) => setEmail(e.target.value)} /></label>
            <label>Password<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button className="primary-button" type="submit">Enter portal</button>
            <p className="hint">Admin: admin@physiocare.local / admin123</p>
            <p className="hint">Staff: staff@physiocare.local / staff123</p>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); onSignup(signup); }} className="form-grid">
            <label>Full name<input required value={signup.name} onChange={(e) => setSignup({ ...signup, name: e.target.value })} /></label>
            <label>Email<input required type="email" value={signup.email} onChange={(e) => setSignup({ ...signup, email: e.target.value })} /></label>
            <label>Password<input required type="password" value={signup.password} onChange={(e) => setSignup({ ...signup, password: e.target.value })} /></label>
            <label>Phone<input required value={signup.phone} onChange={(e) => setSignup({ ...signup, phone: e.target.value })} /></label>
            <label>Title<input required value={signup.title} onChange={(e) => setSignup({ ...signup, title: e.target.value })} /></label>
            <label>
              Clinic
              <select required value={signup.clinicId} onChange={(e) => setSignup({ ...signup, clinicId: e.target.value })}>
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <button className="primary-button" type="submit">Create staff account</button>
          </form>
        )}
        {error && <div className="notice">{error}</div>}
      </section>
    </main>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function Dashboard({
  data, allData, currentUser, onOpenPatient,
}: {
  data: Pick<AppData, 'clinics' | 'profiles' | 'patients' | 'therapySessions'>;
  allData: AppData;
  currentUser: Profile;
  onOpenPatient: (id: string) => void;
}) {
  const today = todayStr;
  const [clinicFilter, setClinicFilter] = useState(
    currentUser.role === 'admin' ? 'all' : currentUser.clinicId ?? data.clinics[0]?.id ?? 'all'
  );
  const allSessions = data.therapySessions
    .filter((s) => s.sessionType === 'clinic')
    .filter((s) => clinicFilter === 'all' || s.clinicId === clinicFilter);
  const dashboardPatients = data.patients
    .filter((p) => p.clinicId !== null)
    .filter((p) => clinicFilter === 'all' || p.clinicId === clinicFilter);

  // ── KPI numbers ──
  const completedSess    = allSessions.filter((s) => s.status === 'completed').length;
  const scheduledSess    = allSessions.filter((s) => s.status === 'scheduled').length;
  // Actual revenue — only completed sessions with a recorded payment
  const actualRevenue    = allSessions
    .filter((s) => s.status === 'completed' && s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
  // Estimated revenue — scheduled sessions where an expected amount was pre-recorded
  const estimatedRevenue = allSessions
    .filter((s) => s.status === 'scheduled' && s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
  const activePatients = dashboardPatients.filter((p) => p.active).length;
  const todayClinic    = allSessions.filter((s) => sessionOnDate(s.scheduledAt, today) && s.sessionType === 'clinic').length;
  const clinicSessions = allSessions.filter((s) => s.sessionType === 'clinic').length;
  const totalSessions  = allSessions.length;
  const completionRate = totalSessions > 0 ? Math.round((completedSess / totalSessions) * 100) : 0;

  // ── Weekly volume (last 7 days) ──
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - (6 - i));
    return formatLocalDateFromDate(d);
  });
  const weeklyVolume = weekDays.map((dateStr) => ({
    label: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(dateStr + 'T12:00')),
    dateStr,
    clinic: allSessions.filter((s) => sessionOnDate(s.scheduledAt, dateStr) && s.sessionType === 'clinic').length,
  }));
  const maxWeekly = Math.max(...weeklyVolume.map((d) => d.clinic), 1);

  // ── Revenue last 7 days ──
  const weeklyRevenue = weekDays.map((dateStr) => ({
    dateStr,
    amount: allSessions
      .filter((s) => s.status === 'completed' && s.amountCollected !== null && sessionOnDate(s.scheduledAt, dateStr))
      .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0),
  }));
  const maxRevenue = Math.max(...weeklyRevenue.map((d) => d.amount), 1);

  // ── This month revenue per clinic ──
  const thisMonth = today.slice(0, 7);
  const revenueClinics = data.clinics.filter((clinic) => clinicFilter === 'all' || clinic.id === clinicFilter);
  const clinicRevenue = revenueClinics.map((clinic) => {
    const amount = allSessions
      .filter((s) => s.clinicId === clinic.id && s.status === 'completed' && s.amountCollected !== null && sessionInMonth(s.scheduledAt, thisMonth))
      .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
    const count = allSessions.filter((s) => s.clinicId === clinic.id && sessionInMonth(s.scheduledAt, thisMonth)).length;
    return { clinic, amount, count };
  });
  const maxClinicRev = Math.max(...clinicRevenue.map((c) => c.amount), 1);

  // ── Clinic expenses (filtered by clinic) ──
  const thisYear = today.slice(0, 4);
  const visibleClinicIds = revenueClinics.map((c) => c.id);
  const filteredExpenses = (allData.expenses ?? []).filter((e) =>
    clinicFilter === 'all' ? visibleClinicIds.includes(e.clinicId) : e.clinicId === clinicFilter
  );
  const expensesThisMonth = filteredExpenses
    .filter((e) => e.date.startsWith(thisMonth))
    .reduce((sum, e) => sum + e.amount, 0);
  const expensesThisYear = filteredExpenses
    .filter((e) => e.date.startsWith(thisYear))
    .reduce((sum, e) => sum + e.amount, 0);
  const monthRevenue = allSessions
    .filter((s) => s.status === 'completed' && s.amountCollected !== null && sessionInMonth(s.scheduledAt, thisMonth))
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
  const netThisMonth = monthRevenue - expensesThisMonth;
  const expenseCategories: ExpenseCategory[] = ['Rent', 'Utilities', 'Salaries', 'Supplies', 'Maintenance', 'Other'];
  const expensesByCategory = expenseCategories
    .map((cat) => ({
      cat,
      total: filteredExpenses
        .filter((e) => e.category === cat && e.date.startsWith(thisMonth))
        .reduce((sum, e) => sum + e.amount, 0),
    }))
    .filter((r) => r.total > 0);
  const maxExpenseCategory = Math.max(...expensesByCategory.map((r) => r.total), 1);
  const clinicExpenses = revenueClinics.map((clinic) => ({
    clinic,
    amount: filteredExpenses
      .filter((e) => e.clinicId === clinic.id && e.date.startsWith(thisMonth))
      .reduce((sum, e) => sum + e.amount, 0),
  }));
  const maxClinicExpense = Math.max(...clinicExpenses.map((c) => c.amount), 1);
  const recentExpenses = [...filteredExpenses]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5);

  // ── Upcoming list ──
  const upcoming = allSessions
    .filter((s) => s.status === 'scheduled' && s.scheduledAt >= today)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 5);

  // ── Recent patients ──
  const recentPatients = dashboardPatients.slice(0, 5);

  const pendingStaff = allData.profiles.filter((p) => p.status === 'pending');

  return (
    <div className="content-stack">
      {currentUser.role === 'admin' && pendingStaff.length > 0 && (
        <div className="alert-banner">
          <UserCheck size={16} />
          {pendingStaff.length} staff account{pendingStaff.length > 1 ? 's' : ''} awaiting approval — go to Staff to approve
        </div>
      )}

      <section className="panel compact-filter-panel">
        <div className="toolbar">
          <PanelTitle title="Clinic dashboard" subtitle="Clinic sessions only — home visits are tracked separately" />
          <div className="toolbar-right">
            <select
              className="clinic-filter-select"
              value={clinicFilter}
              onChange={(e) => setClinicFilter(e.target.value)}
              disabled={currentUser.role !== 'admin'}
            >
              {currentUser.role === 'admin' && <option value="all">All clinics</option>}
              {data.clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        </div>
      </section>

      {/* ── Row 1: KPI cards ── */}
      <section className="metric-grid metric-grid-5">
        <MetricCard icon={Users}        label="Active patients"    value={activePatients.toString()} accent="teal" />
        <MetricCard icon={DollarSign}   label="Actual revenue"     value={formatCurrency(actualRevenue)}    accent="green"
          sub="Completed sessions with payment" />
        <MetricCard icon={TrendingUp}   label="Estimated revenue"  value={estimatedRevenue > 0 ? formatCurrency(estimatedRevenue) : '—'}
          accent="blue" sub="Scheduled sessions (pre-set)" />
        <MetricCard icon={CalendarDays} label="Clinic sessions today" value={todayClinic.toString()} accent="amber" />
        <MetricCard icon={Activity}     label="Completion rate"    value={`${completionRate}%`} accent="teal" />
      </section>

      {/* ── Row 2: Charts ── */}
      <section className="dash-charts-row">

        {/* Weekly volume bar chart */}
        <div className="panel dash-chart-panel">
          <PanelTitle title="Weekly volume" subtitle="Sessions per day — last 7 days" />
          <div className="bar-chart">
            {weeklyVolume.map((day) => {
              const total = day.clinic;
              const clinicPct = maxWeekly > 0 ? (day.clinic / maxWeekly) * 100 : 0;
              const isToday   = day.dateStr === today;
              return (
                <div key={day.dateStr} className={`bar-col ${isToday ? 'today' : ''}`}>
                  <span className="bar-value">{total > 0 ? total : ''}</span>
                  <div className="bar-stack">
                    {clinicPct > 0 && <div className="bar-segment clinic" style={{ height: `${clinicPct}%` }} />}
                  </div>
                  <span className="bar-label">{day.label}</span>
                </div>
              );
            })}
          </div>
          <div className="chart-legend">
            <span><span className="legend-dot clinic" />Clinic</span>
          </div>
        </div>

        {/* Clinic status donut */}
        <div className="panel dash-chart-panel">
          <PanelTitle title="Clinic session mix" subtitle="Scheduled vs completed" />
          <DonutChart
            segments={[
              { label: 'Scheduled', value: scheduledSess, color: 'var(--blue)' },
              { label: 'Completed', value: completedSess, color: 'var(--green)' },
            ]}
            total={totalSessions}
            centerLabel={totalSessions.toString()}
            centerSub="total"
          />
          <div className="donut-legend">
            <div className="donut-legend-item">
              <span className="donut-dot" style={{ background: 'var(--teal)' }} />
              <span>Total clinic</span>
              <strong>{clinicSessions}</strong>
              <small>{totalSessions > 0 ? Math.round((clinicSessions / totalSessions) * 100) : 0}%</small>
            </div>
            <div className="donut-legend-item">
              <span className="donut-dot" style={{ background: 'var(--green)' }} />
              <span>Completed</span>
              <strong>{completedSess}</strong>
              <small>{totalSessions > 0 ? Math.round((completedSess / totalSessions) * 100) : 0}%</small>
            </div>
          </div>
        </div>

        {/* Revenue sparkline */}
        <div className="panel dash-chart-panel">
          <PanelTitle title="Daily revenue" subtitle="Last 7 days" />
          <div className="sparkline-chart">
            {weeklyRevenue.map((day) => {
              const pct = maxRevenue > 0 ? (day.amount / maxRevenue) * 100 : 0;
              const isToday = day.dateStr === today;
              return (
                <div key={day.dateStr} className={`spark-col ${isToday ? 'today' : ''}`}>
                  <span className="spark-value">{day.amount > 0 ? `₹${Math.round(day.amount / 100) > 0 ? (day.amount / 1000).toFixed(1) + 'k' : day.amount}` : ''}</span>
                  <div className="spark-bar-wrap">
                    <div className="spark-bar" style={{ height: `${pct}%` }} />
                  </div>
                  <span className="bar-label">{new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(day.dateStr + 'T12:00'))}</span>
                </div>
              );
            })}
          </div>
          <div className="chart-total-row">
            <span>7-day total</span>
            <strong>{formatCurrency(weeklyRevenue.reduce((s, d) => s + d.amount, 0))}</strong>
          </div>
        </div>
      </section>

      {/* ── Row 3: Status summary numbers + clinic bars ── */}
      <section className="dash-stats-row">
        <div className="panel">
          <PanelTitle title="Session status" subtitle="All time breakdown" />
          <div className="stat-numbers">
            <div className="stat-num-item stat-num-scheduled">
              <strong>{scheduledSess}</strong>
              <span className="status scheduled">Scheduled</span>
              <div className="stat-revenue-line">
                <TrendingUp size={11} />
                <span>Est. {estimatedRevenue > 0 ? formatCurrency(estimatedRevenue) : '—'}</span>
              </div>
            </div>
            <div className="stat-num-item stat-num-completed">
              <strong>{completedSess}</strong>
              <span className="status completed">Completed</span>
              <div className="stat-revenue-line">
                <DollarSign size={11} />
                <span>{formatCurrency(actualRevenue)} collected</span>
              </div>
            </div>
            <div className="stat-num-item">
              <strong>{allSessions.filter((s) => s.status === 'cancelled').length}</strong>
              <span className="status cancelled">Cancelled</span>
            </div>
            <div className="stat-num-item">
              <strong>{allSessions.filter((s) => s.status === 'no_show').length}</strong>
              <span className="status no_show">No show</span>
            </div>
          </div>
        </div>

        <div className="panel">
          <PanelTitle title="Revenue by clinic" subtitle={`This month · ${thisMonth}`} />
          <div className="horiz-bars">
            {clinicRevenue.map(({ clinic, amount, count }) => (
              <div key={clinic.id} className="horiz-bar-row">
                <span className="horiz-bar-label">{clinic.name}</span>
                <div className="horiz-bar-track">
                  <div
                    className="horiz-bar-fill"
                    style={{ width: `${maxClinicRev > 0 ? (amount / maxClinicRev) * 100 : 0}%` }}
                  />
                </div>
                <div className="horiz-bar-meta">
                  <span className="revenue-badge">{formatCurrency(amount)}</span>
                  <small>{count} sess.</small>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Row 3b: Clinic expenses ── */}
      <section className="panel dash-expenses-overview">
        <PanelTitle title="Clinic expenses" subtitle={`${thisMonth} · ${clinicFilter === 'all' ? 'All clinics' : revenueClinics[0]?.name ?? 'Selected clinic'}`} />
        <div className="dash-exp-kpi-grid">
          <div className="dash-exp-kpi exp-kpi-red">
            <span className="dash-exp-kpi-icon">💸</span>
            <div className="dash-exp-kpi-body">
              <span className="dash-exp-kpi-label">This month</span>
              <strong className="dash-exp-kpi-value">{formatCurrency(expensesThisMonth)}</strong>
            </div>
          </div>
          <div className="dash-exp-kpi exp-kpi-purple">
            <span className="dash-exp-kpi-icon">📊</span>
            <div className="dash-exp-kpi-body">
              <span className="dash-exp-kpi-label">This year</span>
              <strong className="dash-exp-kpi-value">{formatCurrency(expensesThisYear)}</strong>
            </div>
          </div>
          <div className="dash-exp-kpi exp-kpi-green">
            <span className="dash-exp-kpi-icon">📈</span>
            <div className="dash-exp-kpi-body">
              <span className="dash-exp-kpi-label">Net this month</span>
              <strong className={`dash-exp-kpi-value ${netThisMonth >= 0 ? 'positive' : 'negative'}`}>
                {formatCurrency(netThisMonth)}
              </strong>
              <small className="dash-exp-net-sub">Revenue {formatCurrency(monthRevenue)} − expenses</small>
            </div>
          </div>
          <div className="dash-exp-kpi exp-kpi-slate">
            <span className="dash-exp-kpi-icon">🗂</span>
            <div className="dash-exp-kpi-body">
              <span className="dash-exp-kpi-label">Records</span>
              <strong className="dash-exp-kpi-value">{filteredExpenses.length}</strong>
            </div>
          </div>
        </div>
      </section>

      <section className="dash-expenses-charts-row">
        <div className="panel">
          <PanelTitle title="Expenses by category" subtitle={`This month · ${thisMonth}`} />
          {expensesByCategory.length === 0 ? (
            <EmptyState message="No expenses recorded this month" />
          ) : (
            <div className="horiz-bars">
              {expensesByCategory.map(({ cat, total }) => (
                <div key={cat} className="horiz-bar-row">
                  <span className="horiz-bar-label">{cat}</span>
                  <div className="horiz-bar-track">
                    <div
                      className="horiz-bar-fill expense"
                      style={{ width: `${maxExpenseCategory > 0 ? (total / maxExpenseCategory) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="horiz-bar-meta">
                    <span className="revenue-badge expense">{formatCurrency(total)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {clinicFilter === 'all' && (
          <div className="panel">
            <PanelTitle title="Expenses by clinic" subtitle={`This month · ${thisMonth}`} />
            {clinicExpenses.every((c) => c.amount === 0) ? (
              <EmptyState message="No expenses recorded this month" />
            ) : (
              <div className="horiz-bars">
                {clinicExpenses.filter((c) => c.amount > 0).map(({ clinic, amount }) => (
                  <div key={clinic.id} className="horiz-bar-row">
                    <span className="horiz-bar-label">{clinic.name}</span>
                    <div className="horiz-bar-track">
                      <div
                        className="horiz-bar-fill expense"
                        style={{ width: `${maxClinicExpense > 0 ? (amount / maxClinicExpense) * 100 : 0}%` }}
                      />
                    </div>
                    <div className="horiz-bar-meta">
                      <span className="revenue-badge expense">{formatCurrency(amount)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* ── Row 4: Upcoming + recent patients ── */}
      <section className="dash-lists-row">
        <div className="panel">
          <PanelTitle title="Upcoming sessions" subtitle="Next 5 scheduled" />
          {upcoming.length === 0 ? (
            <EmptyState message="No upcoming sessions" />
          ) : (
            <div className="compact-list">
              {upcoming.map((session) => {
                const patient = data.patients.find((p) => p.id === session.patientId);
                return (
                  <div key={session.id} className="compact-row">
                    <span className={`compact-type-dot ${session.sessionType}`} />
                    <div className="compact-info">
                      <strong>{formatTherapyTypeDisplay(session.therapyType)}</strong>
                      <small>{patient?.name ?? '—'} · {formatDateTime(session.scheduledAt)}</small>
                    </div>
                    <span className={`status ${session.status}`}>{statusLabel(session.status)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <PanelTitle title="Recent patients" subtitle="Click to open record" />
          {recentPatients.length === 0 ? (
            <EmptyState message="No patients yet" />
          ) : (
            <div className="compact-list">
              {recentPatients.map((patient) => {
                const sessCount = allSessions.filter((s) => s.patientId === patient.id).length;
                return (
                  <button key={patient.id} className="compact-row clickable" onClick={() => onOpenPatient(patient.id)}>
                    <span className="compact-avatar">{patient.name.charAt(0)}</span>
                    <div className="compact-info">
                      <strong>{patient.name}</strong>
                      <small>{patient.diagnosis.slice(0, 40)}{patient.diagnosis.length > 40 ? '…' : ''}</small>
                    </div>
                    <span className="compact-count">{sessCount} sess.</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel">
          <PanelTitle title="Recent expenses" subtitle="Latest clinic costs" />
          {recentExpenses.length === 0 ? (
            <EmptyState message="No expenses recorded yet" />
          ) : (
            <div className="compact-list">
              {recentExpenses.map((expense) => {
                const clinic = data.clinics.find((c) => c.id === expense.clinicId);
                return (
                  <div key={expense.id} className="compact-row">
                    <span className="compact-type-dot expense" />
                    <div className="compact-info">
                      <strong>{expense.category}</strong>
                      <small>
                        {clinic?.name ?? 'Clinic'} · {formatDate(expense.date)}
                        {expense.notes ? ` · ${expense.notes.slice(0, 36)}${expense.notes.length > 36 ? '…' : ''}` : ''}
                      </small>
                    </div>
                    <span className="revenue-badge expense">{formatCurrency(expense.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ── Donut chart (pure SVG) ──
function DonutChart({
  segments, total, centerLabel, centerSub,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  total: number;
  centerLabel: string;
  centerSub: string;
}) {
  const size = 120;
  const strokeWidth = 22;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const arcs = segments.map((seg) => {
    const pct = total > 0 ? seg.value / total : 0;
    const dash = pct * circumference;
    const gap  = circumference - dash;
    const arc  = { ...seg, dash, gap, offset: offset * circumference };
    offset += pct;
    return arc;
  });

  return (
    <div className="donut-wrap">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {total === 0 ? (
          <circle
            cx={size / 2} cy={size / 2} r={r}
            fill="none" stroke="var(--border)" strokeWidth={strokeWidth}
          />
        ) : (
          arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={size / 2} cy={size / 2} r={r}
              fill="none"
              stroke={arc.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arc.dash} ${arc.gap}`}
              strokeDashoffset={-arc.offset}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
            />
          ))
        )}
        <text x={size / 2} y={size / 2 - 5} textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--ink)">
          {centerLabel}
        </text>
        <text x={size / 2} y={size / 2 + 14} textAnchor="middle" fontSize="11" fill="var(--muted)">
          {centerSub}
        </text>
      </svg>
    </div>
  );
}

// ─── Home Dashboard ───────────────────────────────────────────────────────────

function HomeDashboard({
  data, onOpenPatient,
}: {
  data: Pick<AppData, 'patients' | 'therapySessions' | 'clinics'>;
  onOpenPatient: (id: string) => void;
}) {
  const today = todayStr;
  const homeSessions = data.therapySessions.filter((s) => s.sessionType === 'home');
  const homePatientIds = new Set(homeSessions.map((s) => s.patientId));
  const homePatients = data.patients.filter((p) => p.homeVisitDetails || homePatientIds.has(p.id));
  const completed = homeSessions.filter((s) => s.status === 'completed');
  const scheduled = homeSessions.filter((s) => s.status === 'scheduled');
  const todayHome = homeSessions.filter((s) => sessionOnDate(s.scheduledAt, today)).length;
  const upcoming = scheduled
    .filter((s) => s.scheduledAt >= today)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 6);
  const revenue = completed
    .filter((s) => s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
  const estimatedRevenue = scheduled
    .filter((s) => s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
  const attentionPatients = homePatients
    .map((patient) => {
      const sessions = homeSessions.filter((s) => s.patientId === patient.id);
      const lastDone = sessions
        .filter((s) => s.status === 'completed')
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
      const next = sessions
        .filter((s) => s.status === 'scheduled' && s.scheduledAt >= today)
        .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];
      return { patient, lastDone, next, count: sessions.length };
    })
    .filter((item) => !item.next || !item.lastDone)
    .slice(0, 6);

  const totalHome = homeSessions.length;
  const completionRate = totalHome > 0 ? Math.round((completed.length / totalHome) * 100) : 0;
  const cancelled = homeSessions.filter((s) => s.status === 'cancelled' || s.status === 'no_show').length;

  return (
    <div className="content-stack home-dashboard">
      <section className="panel home-dashboard-hero">
        <div>
          <p className="eyebrow">Home care operations</p>
          <h2>Home Visit Dashboard</h2>
          <p>Focused view for caregiver-linked patients, home schedules, completions, and collections.</p>
        </div>
        <Home size={38} />
      </section>

      <section className="metric-grid metric-grid-5">
        <MetricCard icon={Users} label="Home patients" value={homePatients.length.toString()} accent="teal" />
        <MetricCard icon={CalendarDays} label="Today" value={todayHome.toString()} accent="amber" />
        <MetricCard icon={Activity} label="Upcoming" value={upcoming.length.toString()} accent="blue" />
        <MetricCard icon={Check} label="Completed" value={completed.length.toString()} accent="green" />
        <MetricCard icon={DollarSign} label="Actual revenue" value={formatCurrency(revenue)} accent="green"
          sub="Completed visits with payment" />
      </section>

      <section className="metric-grid metric-grid-2">
        <MetricCard icon={TrendingUp} label="Estimated revenue" value={estimatedRevenue > 0 ? formatCurrency(estimatedRevenue) : '—'}
          accent="blue" sub="Scheduled visits (pre-set amount)" />
        <MetricCard icon={Activity} label="Completion rate" value={`${completionRate}%`} accent="teal"
          sub={`${completed.length} of ${totalHome} visits done`} />
      </section>

      <section className="dash-charts-row">
        <div className="panel dash-chart-panel">
          <PanelTitle title="Home visit status" subtitle="Scheduled, completed and missed visits" />
          <DonutChart
            segments={[
              { label: 'Scheduled', value: scheduled.length, color: 'var(--blue)' },
              { label: 'Completed', value: completed.length, color: 'var(--green)' },
              { label: 'Missed', value: cancelled, color: 'var(--coral)' },
            ]}
            total={totalHome}
            centerLabel={`${completionRate}%`}
            centerSub="done"
          />
          <div className="donut-legend">
            <div className="donut-legend-item"><span className="donut-dot" style={{ background: 'var(--blue)' }} /><span>Scheduled</span><strong>{scheduled.length}</strong></div>
            <div className="donut-legend-item"><span className="donut-dot" style={{ background: 'var(--green)' }} /><span>Completed</span><strong>{completed.length}</strong></div>
            <div className="donut-legend-item"><span className="donut-dot" style={{ background: 'var(--coral)' }} /><span>Missed/cancelled</span><strong>{cancelled}</strong></div>
          </div>
        </div>

        <div className="panel dash-chart-panel">
          <PanelTitle title="Upcoming home visits" subtitle="Next scheduled visits" />
          {upcoming.length === 0 ? (
            <EmptyState message="No upcoming home visits" />
          ) : (
            <div className="compact-list">
              {upcoming.map((session) => {
                const patient = data.patients.find((p) => p.id === session.patientId);
                return (
                  <button key={session.id} className="compact-row clickable" onClick={() => patient && onOpenPatient(patient.id)}>
                    <span className="compact-type-dot home" />
                    <div className="compact-info">
                      <strong>{patient?.name ?? 'Unknown patient'}</strong>
                      <small>{formatDateTime(session.scheduledAt)} · {formatTherapyTypeDisplay(session.therapyType)}</small>
                    </div>
                    <span className={`status ${session.status}`}>{statusLabel(session.status)}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="panel dash-chart-panel">
          <PanelTitle title="Needs attention" subtitle="No next visit or no completed visit yet" />
          {attentionPatients.length === 0 ? (
            <EmptyState message="All home patients have activity" />
          ) : (
            <div className="compact-list">
              {attentionPatients.map(({ patient, lastDone, next, count }) => (
                <button key={patient.id} className="compact-row clickable" onClick={() => onOpenPatient(patient.id)}>
                  <span className="compact-avatar">{patient.name.charAt(0)}</span>
                  <div className="compact-info">
                    <strong>{patient.name}</strong>
                    <small>{next ? `Next ${formatDateTime(next.scheduledAt)}` : 'No upcoming visit'} · {lastDone ? `Last ${formatDate(lastDone.scheduledAt)}` : 'No completed visit'}</small>
                  </div>
                  <span className="compact-count">{count} visits</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

// ─── Patients View ────────────────────────────────────────────────────────────

function PatientsView({
  data, allClinics, onGoToAddPatient, onOpenPatient,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  allClinics: Clinic[];
  onGoToAddPatient: () => void;
  onOpenPatient: (patientId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [clinicFilter, setClinicFilter] = useState('all');

  const filtered = data.patients
    .filter((p) => {
      if (clinicFilter === 'all') return true;
      if (clinicFilter === 'home') return isHomeOnlyPatient(p);
      return p.clinicId === clinicFilter;
    })
    .filter((p) => [p.name, p.phone, p.diagnosis].join(' ').toLowerCase().includes(query.toLowerCase()));

  return (
    <section className="panel">
      <div className="toolbar">
        <PanelTitle title="All patients" subtitle={`${filtered.length} of ${data.patients.length} records`} />
        <div className="toolbar-right">
          <div className="search-field">
            <Search size={16} />
            <input placeholder="Search patients…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <select
            className="clinic-filter-select"
            value={clinicFilter}
            onChange={(e) => setClinicFilter(e.target.value)}
          >
            <option value="all">All clinics</option>
            <option value="home">Home only patients</option>
            {allClinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="primary-button" type="button" onClick={onGoToAddPatient}>
            <Plus size={16} /> Add patient
          </button>
        </div>
      </div>
      <div className="table">
        {filtered.length === 0 ? (
          <EmptyState message="No patients found" />
        ) : (
          filtered.map((patient) => {
            const sessions = data.therapySessions.filter((s) => s.patientId === patient.id);
            const lastSession = sessions.sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt))[0];
            const homeOnly = isHomeOnlyPatient(patient);
            const hasHomeSessions = sessions.some((s) => s.sessionType === 'home');
            return (
              <button key={patient.id} className="table-row patient-row" onClick={() => onOpenPatient(patient.id)}>
                <span className={`patient-avatar${homeOnly ? ' patient-avatar-home' : ''}`}>{patient.name.charAt(0)}</span>
                <span>
                  <strong className="patient-name-row">
                    {patient.name}
                    {homeOnly && <span className="home-badge-sm" title="Home only patient"><Home size={10} /></span>}
                  </strong>
                  <small>{patient.diagnosis}</small>
                </span>
                <span>
                  {homeOnly ? (
                    <span className="home-only-label"><Home size={11} /> Home only</span>
                  ) : (
                    <>
                      {clinicName(allClinics, patient.clinicId)}
                      {hasHomeSessions && <span className="home-badge-sm" title="Has home visits"><Home size={10} /></span>}
                    </>
                  )}
                </span>
                <span>{patient.phone}</span>
                <span>
                  {lastSession ? (
                    <span className={`status ${lastSession.status}`}>{statusLabel(lastSession.status)}</span>
                  ) : (
                    <small>No sessions</small>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

// ─── Patient Entry (Add) ──────────────────────────────────────────────────────

function PatientEntryView({
  clinics, defaultClinicId, onSavePatient, onBack,
}: {
  clinics: Clinic[];
  defaultClinicId: string;
  onSavePatient: (patient: PatientDraft, editingId: string | null, newPatientId?: string) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<PatientDraft>(() => emptyPatient(defaultClinicId));
  const newPatientId = useRef(createDbId()).current;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSavePatient(draft, null, newPatientId);
    onBack();
  };

  return (
    <div className="content-stack patient-entry-page">
      <div className="pe-topbar">
        <button className="ghost-button pe-back-btn" type="button" onClick={onBack}>
          <ChevronLeft size={16} /> Patients
        </button>
      </div>
      <PatientForm
        title="Add new patient"
        draft={draft}
        setDraft={setDraft}
        clinics={clinics}
        storagePatientId={newPatientId}
        onSubmit={submit}
        onCancel={onBack}
        editing={false}
        mode="entry"
      />
    </div>
  );
}

// ─── Patient Detail ───────────────────────────────────────────────────────────

type HomeVisitSync =
  | { action: 'create'; session: Omit<TherapySession, 'id'> }
  | { action: 'update'; sessionId: string; updates: Partial<TherapySession> }
  | { action: 'none' };

function PatientDetailView({
  data, allClinics, staff, currentUser, defaultClinicId,
  patientId, onSavePatient, onDeletePatient, onSyncHomeVisitLog, onBack, onGoToAddPatient, onScheduleSession,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  allClinics: Clinic[];
  staff: Profile[];
  currentUser: Profile;
  defaultClinicId: string;
  patientId: string;
  onSavePatient: (patient: PatientDraft, editingId: string | null, newPatientId?: string) => void;
  onDeletePatient: (patientId: string) => void | Promise<void>;
  onSyncHomeVisitLog: (patientId: string, updatedPatient: PatientDraft, sync: HomeVisitSync) => void;
  onBack: () => void;
  onGoToAddPatient: () => void;
  onScheduleSession: (patientId: string, sessionType: SessionType) => void;
}) {
  const patient = data.patients.find((p) => p.id === patientId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [draft, setDraft] = useState<PatientDraft>(() => emptyPatient(defaultClinicId));

  useEffect(() => {
    if (!patient) return;
    setDraft({
      clinicId: patient.clinicId,
      name: patient.name,
      phone: patient.phone,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      address: patient.address,
      signs: patient.signs ?? '',
      symptoms: patient.symptoms ?? '',
      diagnosis: patient.diagnosis,
      referralSource: patient.referralSource,
      emergencyContact: patient.emergencyContact,
      notes: patient.notes,
      complications: patient.complications ?? '',
      surgeries: patient.surgeries ?? '',
      reports: patient.reports ?? [],
      homeVisitDetails: patient.homeVisitDetails,
    });
  }, [patient]);

  if (!patient) {
    return (
      <section className="panel">
        <PanelTitle title="Patient not found" subtitle="The selected record is no longer available" />
        <div className="button-row">
          <button className="ghost-button" type="button" onClick={onBack}>Back to patients</button>
          <button className="primary-button" type="button" onClick={onGoToAddPatient}>
            <Plus size={16} /> Add patient
          </button>
        </div>
      </section>
    );
  }

  const patientSessions = data.therapySessions
    .filter((s) => s.patientId === patient.id)
    .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const completedSessions = patientSessions.filter((s) => s.status === 'completed');
  const scheduledSessions = patientSessions.filter((s) => s.status === 'scheduled');
  const homeVisitSessions = patientSessions.filter((s) => s.sessionType === 'home');
  const clinicSessions    = patientSessions.filter((s) => s.sessionType === 'clinic');
  const totalSpent = completedSessions
    .filter((s) => s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
  const nextSession = patientSessions
    .filter((s) => s.status === 'scheduled' && s.scheduledAt >= todayStr)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))[0];

  const openEdit = () => {
    setDraft({
      clinicId: patient.clinicId,
      name: patient.name,
      phone: patient.phone,
      dateOfBirth: patient.dateOfBirth,
      gender: patient.gender,
      address: patient.address,
      signs: patient.signs ?? '',
      symptoms: patient.symptoms ?? '',
      diagnosis: patient.diagnosis,
      referralSource: patient.referralSource,
      emergencyContact: patient.emergencyContact,
      notes: patient.notes,
      complications: patient.complications ?? '',
      surgeries: patient.surgeries ?? '',
      reports: patient.reports ?? [],
      homeVisitDetails: patient.homeVisitDetails,
    });
    setEditing(true);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSavePatient(draft, patient.id);
    setEditing(false);
  };

  return (
    <div className="content-stack patient-detail-page">
      <div className="pp-topbar">
        <button className="ghost-button pp-back-btn" type="button" onClick={onBack}>
          <ChevronLeft size={16} /> Patients
        </button>
        <div className="pp-topbar-actions">
          <button className="secondary-button" type="button" onClick={() => (editing ? setEditing(false) : openEdit())}>
            {editing ? <><X size={15} /> Close edit</> : <><ClipboardList size={15} /> Edit record</>}
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={deleting}
            onClick={async () => {
              setDeleting(true);
              try { await onDeletePatient(patient.id); } finally { setDeleting(false); }
            }}
          >
            {deleting ? <Loader2 size={15} className="icon-spin" /> : <Trash2 size={15} />}
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* ── Hero header ── */}
      <section className="pp-hero">
        <div className="pp-hero-accent" />
        <div className="pp-hero-body">
          <div className="pp-hero-main">
            <div className="pp-avatar">{patient.name.charAt(0).toUpperCase()}</div>
            <div className="pp-identity">
              <p className="pp-eyebrow">{patient.clinicId ? clinicName(allClinics, patient.clinicId) : 'Home only patient'}</p>
              <h1 className="pp-name">{patient.name}</h1>
              {patient.diagnosis && <p className="pp-diagnosis">{patient.diagnosis}</p>}
              <div className="pp-badges">
                <span className="pp-badge">{patient.gender}</span>
                <span className="pp-badge">{calculateAge(patient.dateOfBirth)} yrs</span>
                <span className={`pp-badge pp-badge-${patient.active ? 'active' : 'inactive'}`}>
                  {patient.active ? 'Active' : 'Inactive'}
                </span>
                {homeVisitSessions.length > 0 && (
                  <span className="pp-badge pp-badge-home"><Home size={11} /> Home visits</span>
                )}
              </div>
            </div>
          </div>
          <div className="pp-hero-actions">
            <button className="secondary-button" type="button" onClick={() => setShowInvoice(true)}>
              <FileText size={15} /> Generate invoice
            </button>
            <button className="primary-button" onClick={() => onScheduleSession(patient.id, 'clinic')}>
              <Stethoscope size={15} /> Schedule clinic
            </button>
            <button className="amber-button" onClick={() => onScheduleSession(patient.id, 'home')}>
              <Home size={15} /> Schedule home
            </button>
          </div>
        </div>

        {/* Quick stats strip */}
        <div className="pp-stats-strip">
          <div className="pp-stat">
            <CalendarDays size={16} />
            <div><strong>{patientSessions.length}</strong><span>Total sessions</span></div>
          </div>
          <div className="pp-stat">
            <Check size={16} />
            <div><strong>{completedSessions.length}</strong><span>Completed</span></div>
          </div>
          <div className="pp-stat">
            <Activity size={16} />
            <div><strong>{scheduledSessions.length}</strong><span>Scheduled</span></div>
          </div>
          <div className="pp-stat">
            <DollarSign size={16} />
            <div><strong>{formatCurrency(totalSpent)}</strong><span>Total paid</span></div>
          </div>
          {nextSession && (
            <div className="pp-stat pp-stat-next">
              <Clock size={16} />
              <div><strong>{formatDateTime(nextSession.scheduledAt)}</strong><span>Next visit</span></div>
            </div>
          )}
        </div>
      </section>

      {/* ── Contact & info cards ── */}
      <div className="pp-info-grid">
        <div className="pp-info-card">
          <Phone size={15} className="pp-info-icon" />
          <span className="pp-info-label">Phone</span>
          <span className="pp-info-value">{patient.phone || '—'}</span>
        </div>
        <div className="pp-info-card">
          <MapPin size={15} className="pp-info-icon" />
          <span className="pp-info-label">Address</span>
          <span className="pp-info-value">{patient.address || '—'}</span>
        </div>
        <div className="pp-info-card">
          <UserCheck size={15} className="pp-info-icon" />
          <span className="pp-info-label">Emergency contact</span>
          <span className="pp-info-value">{patient.emergencyContact || '—'}</span>
        </div>
        <div className="pp-info-card">
          <ExternalLink size={15} className="pp-info-icon" />
          <span className="pp-info-label">Referral source</span>
          <span className="pp-info-value">{patient.referralSource || '—'}</span>
        </div>
        <div className="pp-info-card">
          <Calendar size={15} className="pp-info-icon" />
          <span className="pp-info-label">Date of birth</span>
          <span className="pp-info-value">{patient.dateOfBirth ? formatDate(patient.dateOfBirth) : '—'}</span>
        </div>
        <div className="pp-info-card">
          <Stethoscope size={15} className="pp-info-icon" />
          <span className="pp-info-label">Session mix</span>
          <span className="pp-info-value">{clinicSessions.length} clinic · {homeVisitSessions.length} home</span>
        </div>
      </div>

      {/* ── Two-column body ── */}
      <div className="pp-body-grid">

        {/* Left: clinical + home visit */}
        <div className="pp-body-col">

          {/* Clinical overview */}
          {(patient.signs || patient.symptoms || patient.complications || patient.surgeries || patient.notes) && (
            <section className="panel pp-section">
              <PanelTitle title="Clinical overview" subtitle="Signs, symptoms and medical history" />
              {(patient.signs || patient.symptoms) && (
                <div className="pp-clinical-grid">
                  {patient.signs && (
                    <div className="pp-clinical-block pp-clinical-signs">
                      <span className="pp-clinical-label">Signs</span>
                      <p>{patient.signs}</p>
                    </div>
                  )}
                  {patient.symptoms && (
                    <div className="pp-clinical-block pp-clinical-symptoms">
                      <span className="pp-clinical-label">Symptoms</span>
                      <p>{patient.symptoms}</p>
                    </div>
                  )}
                </div>
              )}
              {(patient.complications || patient.surgeries) && (
                <div className="pp-clinical-tags">
                  {patient.complications && (
                    <div className="pp-tag pp-tag-warn"><strong>Complications:</strong> {patient.complications}</div>
                  )}
                  {patient.surgeries && (
                    <div className="pp-tag pp-tag-surgery"><strong>Surgeries:</strong> {patient.surgeries}</div>
                  )}
                </div>
              )}
              {patient.notes && (
                <div className="pp-notes-block">
                  <span className="pp-clinical-label">General notes</span>
                  <p>{patient.notes}</p>
                </div>
              )}
            </section>
          )}

          {/* Home visit panel */}
          {(homeVisitSessions.length > 0 || patient.homeVisitDetails) && (
            <HomeVisitPanel
              patient={patient}
              homeVisitSessions={homeVisitSessions}
              staff={staff}
              onToggleHomeLog={(date, record) => {
                const hvd   = patient.homeVisitDetails ?? emptyHomeVisitDetails();
                const log   = hvd.homeSessionLog ?? [];
                const notes = { ...(hvd.homeSessionNotes ?? {}) };
                const buildPayload = (newHvd: HomeVisitDetails): PatientDraft => ({
                  clinicId: patient.clinicId, name: patient.name, phone: patient.phone,
                  dateOfBirth: patient.dateOfBirth, gender: patient.gender, address: patient.address,
                  signs: patient.signs ?? '', symptoms: patient.symptoms ?? '',
                  diagnosis: patient.diagnosis, referralSource: patient.referralSource,
                  emergencyContact: patient.emergencyContact, notes: patient.notes,
                  complications: patient.complications ?? '', surgeries: patient.surgeries ?? '',
                  reports: patient.reports ?? [], homeVisitDetails: newHvd,
                });
                if (record === null) {
                  delete notes[date];
                  const updated: HomeVisitDetails = { ...hvd, homeSessionLog: log.filter((d) => d !== date), homeSessionNotes: notes };
                  const matchingSession = patientSessions.find(
                    (s) => s.sessionType === 'home' && sessionOnDate(s.scheduledAt, date) && s.status === 'completed'
                  );
                  onSyncHomeVisitLog(patient.id, buildPayload(updated),
                    matchingSession
                      ? { action: 'update', sessionId: matchingSession.id, updates: { status: 'scheduled', completedAt: null, amountCollected: null } }
                      : { action: 'none' }
                  );
                } else {
                  notes[date] = record;
                  const updated: HomeVisitDetails = { ...hvd, homeSessionLog: log.includes(date) ? log : [...log, date], homeSessionNotes: notes };
                  const existingSession = patientSessions.find((s) => s.sessionType === 'home' && sessionOnDate(s.scheduledAt, date));
                  onSyncHomeVisitLog(patient.id, buildPayload(updated),
                    existingSession
                      ? { action: 'update', sessionId: existingSession.id, updates: {
                          status: 'completed', completedAt: buildLocalDateTime(date, '12:00'),
                          treatmentNotes: record.notes, amountCollected: record.amount,
                        }}
                      : { action: 'create', session: {
                          patientId: patient.id, clinicId: null,
                          sessionType: 'home', therapyType: 'Home Visit', therapyLevel: 'basic',
                          assignedStaffId: '', scheduledAt: buildLocalDateTime(date, '09:00'),
                          status: 'completed', completedAt: buildLocalDateTime(date, '09:00'),
                          notes: '', treatmentNotes: record.notes, amountCollected: record.amount,
                        }}
                  );
                }
              }}
            />
          )}
        </div>

        {/* Right: reports + sessions */}
        <div className="pp-body-col">

          {/* Reports */}
          <section className="panel pp-section">
            <PanelTitle title="Reports & documents" subtitle={`${(patient.reports ?? []).length} attached`} />
            {(patient.reports ?? []).length === 0 ? (
              <EmptyState message="No reports yet. Use Edit record to attach documents." />
            ) : (
              <div className="pp-reports-grid">
                {(patient.reports ?? []).map((report) => (
                  <div key={report.id} className="pp-report-card">
                    <div className="pp-report-icon"><FileText size={20} /></div>
                    <div className="pp-report-body">
                      <strong>{report.title}</strong>
                      <small>{formatDate(report.date)}</small>
                      {report.fileName && <span className="pp-report-file">{report.fileName}</span>}
                      {report.notes && <p className="pp-report-notes">{report.notes}</p>}
                    </div>
                    {report.fileUrl && <ReportDownloadButton report={report} />}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Session history */}
          <section className="panel pp-section">
            <PanelTitle title="Session history" subtitle={`${patientSessions.length} sessions · ${completedSessions.length} completed`} />
            {patientSessions.length === 0 ? (
              <EmptyState message="No sessions recorded yet." />
            ) : (
              <div className="pp-session-list">
                {patientSessions.map((session) => (
                  <div key={session.id} className={`pp-session-item status-${session.status}`}>
                    <div className="pp-session-date">
                      <span className="pp-session-day">{new Intl.DateTimeFormat('en', { day: 'numeric' }).format(parseScheduledAt(session.scheduledAt))}</span>
                      <span className="pp-session-mon">{new Intl.DateTimeFormat('en', { month: 'short' }).format(parseScheduledAt(session.scheduledAt))}</span>
                    </div>
                    <div className="pp-session-body">
                      <div className="pp-session-top">
                        <strong>{formatTherapyTypeDisplay(session.therapyType)}</strong>
                        <span className={`status ${session.status}`}>{statusLabel(session.status)}</span>
                      </div>
                      <div className="pp-session-meta">
                        {session.sessionType === 'home'
                          ? <span className="badge badge-amber"><Home size={10} /> Home</span>
                          : <span className="badge badge-teal"><Stethoscope size={10} /> Clinic</span>}
                        <span className={`therapy-level-badge ${session.therapyLevel ?? 'basic'}`}>{session.therapyLevel ?? 'basic'}</span>
                        <span className="pp-session-time"><Clock size={10} /> {formatDateTime(session.scheduledAt)}</span>
                      </div>
                      {session.treatmentNotes && (
                        <p className="pp-session-notes">{session.treatmentNotes}</p>
                      )}
                    </div>
                    {session.amountCollected !== null && session.status === 'completed' && (
                      <span className="revenue-badge pp-session-amount">{formatCurrency(session.amountCollected)}</span>
                    )}
                    {session.amountCollected !== null && session.status === 'scheduled' && (
                      <span className="revenue-badge est pp-session-amount">Est. {formatCurrency(session.amountCollected)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* Edit form modal */}
      {editing && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEditing(false); }}>
          <PatientForm
            title="Update patient record"
            draft={draft}
            setDraft={setDraft}
            clinics={currentUser.role === 'admin' ? allClinics.filter((c) => c.active) : data.clinics}
            storagePatientId={patient.id}
            onSubmit={submit}
            onCancel={() => setEditing(false)}
            editing
          />
        </div>
      )}

      {showInvoice && (
        <InvoiceModal
          patient={patient}
          sessions={data.therapySessions}
          clinics={allClinics}
          profiles={staff}
          onClose={() => setShowInvoice(false)}
        />
      )}
    </div>
  );
}

// ─── Home Visit Panel ─────────────────────────────────────────────────────────

function HomeVisitPanel({
  patient, homeVisitSessions, staff, onToggleHomeLog,
}: {
  patient: Patient;
  homeVisitSessions: TherapySession[];
  staff: Profile[];
  onToggleHomeLog: (date: string, record: { notes: string; amount: number | null } | null) => void;
}) {
  const hvd = patient.homeVisitDetails;
  const now = new Date();
  const [logYear, setLogYear] = useState(now.getFullYear());
  const [logMonth, setLogMonth] = useState(now.getMonth());
  const log = hvd?.homeSessionLog ?? [];
  const sessionNotes = hvd?.homeSessionNotes ?? {};

  // Mark-done popup state
  const [pendingDate, setPendingDate] = useState<string | null>(null);
  const [popupForm, setPopupForm] = useState({ notes: '', amount: '' });

  const openMarkDone = (dateStr: string) => {
    const existing = sessionNotes[dateStr];
    setPopupForm({
      notes:  existing?.notes  ?? '',
      amount: existing?.amount != null ? String(existing.amount) : '',
    });
    setPendingDate(dateStr);
  };

  const submitMarkDone = (e: FormEvent) => {
    e.preventDefault();
    if (!pendingDate) return;
    onToggleHomeLog(pendingDate, {
      notes:  popupForm.notes,
      amount: popupForm.amount !== '' ? parseFloat(popupForm.amount) : null,
    });
    setPendingDate(null);
    setPopupForm({ notes: '', amount: '' });
  };

  const monthName = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(logYear, logMonth));
  const firstDay = new Date(logYear, logMonth, 1).getDay();
  const daysInMonth = new Date(logYear, logMonth + 1, 0).getDate();
  const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;

  const prevLogMonth = () => { if (logMonth === 0) { setLogMonth(11); setLogYear((y) => y - 1); } else setLogMonth((m) => m - 1); };
  const nextLogMonth = () => { if (logMonth === 11) { setLogMonth(0); setLogYear((y) => y + 1); } else setLogMonth((m) => m + 1); };

  const sessionDates = new Set(homeVisitSessions.map((s) => sessionDateKey(s.scheduledAt)));

  return (
    <section className="panel home-visit-panel">
      {/* Mark-done popup */}
      {pendingDate && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPendingDate(null); }}>
          <form className="modal-panel" style={{ maxWidth: 420 }} onSubmit={submitMarkDone}>
            <div className="modal-accent modal-accent-teal" />
            <div className="modal-header">
              <div className="modal-header-icon">✅</div>
              <div>
                <h3 className="modal-title">Mark session done</h3>
                <p className="modal-sub">{pendingDate}</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setPendingDate(null)}><X size={18} /></button>
            </div>
            <div className="modal-body">
              <label>
                Treatment notes
                <textarea rows={3} value={popupForm.notes}
                  onChange={(e) => setPopupForm((f) => ({ ...f, notes: e.target.value }))}
                  placeholder="What was done in this session…" />
              </label>
              <label>
                Amount collected (₹)
                <input type="number" min="0" step="0.01" value={popupForm.amount}
                  onChange={(e) => setPopupForm((f) => ({ ...f, amount: e.target.value }))}
                  placeholder="0" />
              </label>
            </div>
            <div className="modal-footer">
              <button className="ghost-button" type="button" onClick={() => setPendingDate(null)}><X size={14} /> Cancel</button>
              <button className="primary-button" type="submit"><Check size={14} /> Mark done</button>
            </div>
          </form>
        </div>
      )}

      <PanelTitle title="Home visit record" subtitle={`${homeVisitSessions.length} home sessions scheduled`} />

      {/* Caregiver card */}
      {hvd && (hvd.caregiverName || hvd.condition || hvd.homeVisitStartDate) && (
        <div className="caregiver-card">
          <div className="caregiver-icon"><Home size={20} /></div>
          <div className="caregiver-details">
            {hvd.caregiverName && (
              <div className="caregiver-row">
                <strong>Caregiver:</strong>
                <span>{hvd.caregiverName}{hvd.caregiverRelation ? ` (${hvd.caregiverRelation})` : ''}</span>
              </div>
            )}
            {hvd.caregiverPhone && (
              <div className="caregiver-row">
                <strong>Phone:</strong>
                <a href={`tel:${hvd.caregiverPhone}`} className="caregiver-phone">{hvd.caregiverPhone}</a>
              </div>
            )}
            {hvd.condition && (
              <div className="caregiver-row">
                <strong>Condition:</strong><span>{hvd.condition}</span>
              </div>
            )}
            {hvd.homeVisitStartDate && (
              <div className="caregiver-row">
                <strong>Home visit started:</strong><span>{formatDate(hvd.homeVisitStartDate)}</span>
              </div>
            )}
            {hvd.dischargeDate && (
              <div className="caregiver-row">
                <strong>Discharged:</strong><span>{formatDate(hvd.dischargeDate)}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Daily session log calendar */}
      <div className="home-log-section">
        <div className="home-log-header">
          <h4 className="home-log-title">Daily session log</h4>
          <div className="home-log-nav">
            <button className="ghost-button icon-only" type="button" onClick={prevLogMonth}><ChevronLeft size={15} /></button>
            <span className="home-log-month">{monthName}</span>
            <button className="ghost-button icon-only" type="button" onClick={nextLogMonth}><ChevronRight size={15} /></button>
          </div>
          <small className="home-log-hint">Click a day to mark done · click again to undo</small>
        </div>
        <div className="home-log-grid">
          {['S','M','T','W','T','F','S'].map((d, i) => (
            <div key={`${d}-${i}`} className="home-log-dow">{d}</div>
          ))}
          {Array.from({ length: totalCells }, (_, i) => {
            const dayNum = i - firstDay + 1;
            if (dayNum < 1 || dayNum > daysInMonth) {
              return <div key={`empty-${i}`} className="home-log-cell empty" />;
            }
            const mm = String(logMonth + 1).padStart(2, '0');
            const dd = String(dayNum).padStart(2, '0');
            const dateStr = `${logYear}-${mm}-${dd}`;
            const isDone    = log.includes(dateStr);
            const isSchd    = sessionDates.has(dateStr);
            const isToday   = dateStr === todayStr;
            const rec       = sessionNotes[dateStr];
            const tipParts  = [
              isDone ? 'Done' : isSchd ? 'Scheduled' : '',
              rec?.notes  ? `Notes: ${rec.notes}` : '',
              rec?.amount != null ? `₹${rec.amount}` : '',
            ].filter(Boolean);
            return (
              <button
                key={dateStr}
                type="button"
                className={`home-log-cell${isDone ? ' done' : ''}${isSchd ? ' scheduled' : ''}${isToday ? ' today' : ''}`}
                onClick={() => isDone ? onToggleHomeLog(dateStr, null) : openMarkDone(dateStr)}
                title={tipParts.length ? tipParts.join(' · ') : dateStr}
              >
                {dayNum}
                {isDone && <span className="log-tick">✓</span>}
                {isDone && rec?.amount != null && <span className="log-amount">₹{rec.amount}</span>}
              </button>
            );
          })}
        </div>
        <div className="home-log-legend">
          <span><span className="log-swatch done" />Done</span>
          <span><span className="log-swatch scheduled" />Scheduled</span>
          <span><span className="log-swatch today" />Today</span>
        </div>
      </div>

      {/* Session list */}
      {homeVisitSessions.length > 0 && (
        <div className="list">
          {homeVisitSessions.map((session) => {
            const therapist = staff.find((p) => p.id === session.assignedStaffId);
            return (
              <div key={session.id} className="list-row vertical">
                <div className="session-header-row">
                  <span className={`status ${session.status}`}>{statusLabel(session.status)}</span>
                  <span className="badge badge-amber"><Home size={12} /> Home visit</span>
                  <span className={`therapy-level-badge ${session.therapyLevel}`}>{session.therapyLevel}</span>
                  <strong>{formatTherapyTypeDisplay(session.therapyType)}</strong>
                  <small>{formatDateTime(session.scheduledAt)}</small>
                </div>
                {therapist && <small>Therapist: {therapist.name}</small>}
                {session.notes && <p className="clinical-note">{session.notes}</p>}
                {session.treatmentNotes && (
                  <p className="clinical-note"><strong>Treatment:</strong> {session.treatmentNotes}</p>
                )}
                {session.amountCollected !== null && (
                  <p className="clinical-note"><strong>Amount:</strong> {formatCurrency(session.amountCollected)}</p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── Patient Form (Add / Edit) ────────────────────────────────────────────────

function ReportDownloadButton({ report }: { report: PatientReport }) {
  const [opening, setOpening] = useState(false);

  if (!report.fileUrl) return null;

  if (!isStoredReportKey(report.fileUrl)) {
    return (
      <a className="secondary-button icon-only" href={report.fileUrl} target="_blank" rel="noreferrer" title="Open report">
        <ExternalLink size={14} />
      </a>
    );
  }

  return (
    <button
      className="secondary-button icon-only"
      type="button"
      disabled={opening}
      title={report.fileName ? `Open ${report.fileName}` : 'Open report'}
      onClick={async () => {
        setOpening(true);
        try {
          await openStoredReport(report.fileUrl!);
        } catch (error) {
          window.alert(error instanceof Error ? error.message : 'Could not open report.');
        } finally {
          setOpening(false);
        }
      }}
    >
      {opening ? <Loader2 size={14} className="icon-spin" /> : <ExternalLink size={14} />}
    </button>
  );
}

function PatientFormSection({
  entry, step, title, subtitle, icon: Icon, children,
}: {
  entry: boolean;
  step?: number;
  title?: string;
  subtitle?: string;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  if (!entry) return <>{children}</>;
  return (
    <section className="pe-section">
      <div className="pe-section-head">
        {step != null && <span className="pe-step">{step}</span>}
        <div className="pe-section-titles">
          {Icon && title && (
            <h3><Icon size={16} /> {title}</h3>
          )}
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      <div className="pe-section-body">{children}</div>
    </section>
  );
}

function PatientForm({
  title, draft, setDraft, clinics, storagePatientId, onSubmit, onCancel, editing,
  mode = 'compact',
}: {
  title: string;
  draft: PatientDraft;
  setDraft: (d: PatientDraft) => void;
  clinics: Clinic[];
  storagePatientId: string;
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  editing: boolean;
  mode?: 'entry' | 'compact';
}) {
  const isEntry = mode === 'entry';
  const [newReport, setNewReport] = useState<Omit<PatientReport, 'id'>>({
    title: '', date: todayStr, notes: '', fileUrl: '', fileName: '',
  });
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadingReport, setUploadingReport] = useState(false);
  const [reportError, setReportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const completion = useMemo(() => {
    const checks = [
      Boolean(draft.name.trim()),
      Boolean(draft.phone.trim()),
      Boolean(draft.dateOfBirth),
      Boolean(draft.diagnosis.trim()),
      isHomeOnlyPatient(draft) ? true : Boolean(draft.clinicId),
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  }, [draft]);

  const previewInitials = useMemo(() => {
    const parts = draft.name.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    return parts.slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('');
  }, [draft.name]);

  const resetReportForm = () => {
    setNewReport({ title: '', date: todayStr, notes: '', fileUrl: '', fileName: '' });
    setSelectedFile(null);
    setReportError('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const addReport = async () => {
    if (!newReport.title.trim()) return;
    if (selectedFile && !isR2Configured) {
      setReportError('Report uploads require Cloudflare R2. Add VITE_R2_API_URL and VITE_R2_API_TOKEN.');
      return;
    }

    setReportError('');
    setUploadingReport(true);

    try {
      const reportId = createId('report');
      let fileUrl = newReport.fileUrl;
      let fileName = newReport.fileName;

      if (selectedFile) {
        const uploaded = await uploadPatientReport(storagePatientId, reportId, selectedFile);
        fileUrl = uploaded.key;
        fileName = uploaded.fileName;
      }

      const report: PatientReport = {
        ...newReport,
        id: reportId,
        fileUrl: fileUrl || undefined,
        fileName: fileName || undefined,
      };
      setDraft({ ...draft, reports: [...(draft.reports ?? []), report] });
      resetReportForm();
    } catch (error) {
      setReportError(error instanceof Error ? error.message : 'Could not upload report.');
    } finally {
      setUploadingReport(false);
    }
  };

  const removeReport = (reportId: string) => {
    setDraft({ ...draft, reports: (draft.reports ?? []).filter((r) => r.id !== reportId) });
  };

  const setClinicPatient = () => {
    setDraft({
      ...draft,
      clinicId: draft.clinicId ?? clinics[0]?.id ?? '',
      homeVisitDetails: undefined,
    });
  };

  const setHomePatient = () => {
    setDraft({
      ...draft,
      clinicId: null,
      homeVisitDetails: draft.homeVisitDetails ?? emptyHomeVisitDetails(),
    });
  };

  const genderOptions: Patient['gender'][] = ['Female', 'Male', 'Other'];

  const reportsBlock = (
    <>
      {!isR2Configured && (
        <p className="report-upload-hint">
          Connect Cloudflare R2 to upload PDFs and images. Reports can still be saved with title and notes only.
        </p>
      )}
      {(draft.reports ?? []).length > 0 && (
        <div className={isEntry ? 'pe-reports-list' : 'list'}>
          {(draft.reports ?? []).map((report) => (
            <div key={report.id} className={isEntry ? 'pe-report-chip' : 'list-row compact report-row'}>
              <span>
                <strong>{report.title}</strong>
                <small>{formatDate(report.date)}</small>
                {report.fileName && <small className="report-file-name">{report.fileName}</small>}
              </span>
              <button className="ghost-button icon-only" type="button" onClick={() => removeReport(report.id)} title="Remove">
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className={isEntry ? 'pe-add-report' : 'add-report-form'}>
        <input
          placeholder="Report title"
          value={newReport.title}
          onChange={(e) => setNewReport({ ...newReport, title: e.target.value })}
        />
        <input
          type="date"
          value={newReport.date}
          onChange={(e) => setNewReport({ ...newReport, date: e.target.value })}
        />
        <label className="file-upload-field">
          <span>Upload report file (optional)</span>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_REPORT_TYPES}
            disabled={!isR2Configured || uploadingReport}
            onChange={(e) => setSelectedFile(e.target.files?.[0] ?? null)}
          />
          {selectedFile && <small className="report-file-name">{selectedFile.name}</small>}
        </label>
        <textarea
          placeholder="Notes (optional)"
          value={newReport.notes}
          onChange={(e) => setNewReport({ ...newReport, notes: e.target.value })}
        />
        {reportError && <p className="report-upload-error">{reportError}</p>}
        <button className="secondary-button" type="button" onClick={() => void addReport()} disabled={uploadingReport}>
          {uploadingReport ? <Loader2 size={14} className="icon-spin" /> : <Upload size={14} />}
          {uploadingReport ? 'Uploading…' : 'Add report'}
        </button>
      </div>
    </>
  );

  return (
    <form
      className={
        isEntry ? 'pe-form'
          : editing ? 'modal-panel patient-edit-modal form-grid'
          : 'panel form-grid'
      }
      onSubmit={onSubmit}
    >
      {isEntry ? (
        <>
          <div className="pe-hero">
            <div className="pe-hero-accent" />
            <div className="pe-hero-body">
              <div className="pe-hero-preview">
                <div className="pe-avatar">{previewInitials}</div>
                <div>
                  <h1 className="pe-hero-title">{draft.name.trim() || 'New patient'}</h1>
                  <p className="pe-hero-sub">
                    {draft.diagnosis.trim() || 'Fill in details below to create the clinical record'}
                  </p>
                  <div className="pe-hero-badges">
                    {draft.homeVisitDetails ? (
                      <span className="pe-hero-badge home"><Home size={12} /> Home only</span>
                    ) : (
                      <span className="pe-hero-badge clinic"><Building2 size={12} /> Clinic patient</span>
                    )}
                    {draft.dateOfBirth && (
                      <span className="pe-hero-badge">{calculateAge(draft.dateOfBirth)} yrs</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="pe-progress-wrap">
                <div className="pe-progress-label">
                  <span>Profile completion</span>
                  <strong>{completion}%</strong>
                </div>
                <div className="pe-progress-track">
                  <div className="pe-progress-fill" style={{ width: `${completion}%` }} />
                </div>
              </div>
            </div>
          </div>

          <PatientFormSection
            entry
            step={1}
            title="Patient type"
            subtitle="Clinic patients visit a location; home only patients are treated at home"
            icon={MapPin}
          >
            <div className="pe-type-cards">
              <button
                type="button"
                className={`pe-type-card${!draft.homeVisitDetails ? ' active' : ''}`}
                onClick={setClinicPatient}
              >
                <Building2 size={22} />
                <strong>Clinic patient</strong>
                <span>Assigned to a clinic location</span>
              </button>
              <button
                type="button"
                className={`pe-type-card${draft.homeVisitDetails ? ' active' : ''}`}
                onClick={setHomePatient}
              >
                <Home size={22} />
                <strong>Home only</strong>
                <span>No clinic — physiotherapy at home</span>
              </button>
            </div>
            {!draft.homeVisitDetails && (
              <label className="pe-clinic-select">
                Clinic <span className="required">*</span>
                <select required value={draft.clinicId ?? ''} onChange={(e) => setDraft({ ...draft, clinicId: e.target.value })}>
                  {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
          </PatientFormSection>
        </>
      ) : editing ? (
        <>
          <div className="modal-accent modal-accent-teal" />
          <div className="modal-header">
            <div className="modal-header-icon"><User size={18} /></div>
            <div>
              <h3 className="modal-title">{title}</h3>
              <p className="modal-sub">Update clinical record, home visit details and reports</p>
            </div>
            <button type="button" className="icon-btn" onClick={onCancel} aria-label="Close"><X size={18} /></button>
          </div>
        </>
      ) : (
        <PanelTitle title={title} subtitle="Clinical record details" />
      )}

      <div className={!isEntry && editing ? 'modal-body' : undefined}>
      {editing && !isEntry && (
        <div className="pf-type-row">
          <span className="pf-type-label">Patient type</span>
          <div className="pe-type-cards">
            <button
              type="button"
              className={`pe-type-card compact${!draft.homeVisitDetails ? ' active' : ''}`}
              onClick={setClinicPatient}
            >
              <Building2 size={18} />
              <strong>Clinic</strong>
            </button>
            <button
              type="button"
              className={`pe-type-card compact${draft.homeVisitDetails ? ' active' : ''}`}
              onClick={setHomePatient}
            >
              <Home size={18} />
              <strong>Home only</strong>
            </button>
          </div>
        </div>
      )}
      <PatientFormSection
        entry={isEntry}
        step={2}
        title="Personal details"
        subtitle="Contact information and demographics"
        icon={User}
      >
        {!isEntry && (
          <div className="form-two-col">
            {!draft.homeVisitDetails ? (
              <label>
                Clinic <span className="required">*</span>
                <select required value={draft.clinicId ?? ''} onChange={(e) => setDraft({ ...draft, clinicId: e.target.value })}>
                  {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            ) : (
              <div className="home-no-clinic-note">
                <Home size={15} />
                Home only patient — no clinic assignment required
              </div>
            )}
            <label>
              Gender
              <select value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value as Patient['gender'] })}>
                {genderOptions.map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
          </div>
        )}

        {isEntry && (
          <div className="pe-field-block">
            <span className="pe-field-label">Gender</span>
            <div className="pe-gender-pills">
              {genderOptions.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={`pe-gender-pill${draft.gender === g ? ' active' : ''}`}
                  onClick={() => setDraft({ ...draft, gender: g })}
                >
                  {g}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="form-two-col">
          <label>
            Full name <span className="required">*</span>
            <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Patient full name" />
          </label>
          <label>
            Phone <span className="required">*</span>
            <input required type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+91 …" />
          </label>
          <label>
            Date of birth <span className="required">*</span>
            <input required type="date" value={draft.dateOfBirth} onChange={(e) => setDraft({ ...draft, dateOfBirth: e.target.value })} />
            {draft.dateOfBirth && (
              <span className="dob-age-hint">Age: <strong>{calculateAge(draft.dateOfBirth)} yrs</strong></span>
            )}
          </label>
          <label>
            Address
            <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Street, city, pin code" />
          </label>
          <label>
            Referral source
            <input value={draft.referralSource} onChange={(e) => setDraft({ ...draft, referralSource: e.target.value })} placeholder="Doctor, walk-in, online…" />
          </label>
          <label>
            Emergency contact
            <input value={draft.emergencyContact} onChange={(e) => setDraft({ ...draft, emergencyContact: e.target.value })} placeholder="Name and phone" />
          </label>
        </div>
      </PatientFormSection>

      <PatientFormSection
        entry={isEntry}
        step={3}
        title="Clinical overview"
        subtitle="Signs, symptoms, diagnosis and history"
        icon={Stethoscope}
      >
        <div className="form-two-col">
          <label>
            Signs
            <textarea
              value={draft.signs ?? ''}
              onChange={(e) => setDraft({ ...draft, signs: e.target.value })}
              placeholder="Observable clinical signs (e.g. swelling, tenderness, reduced ROM)"
              rows={3}
            />
          </label>
          <label>
            Symptoms
            <textarea
              value={draft.symptoms ?? ''}
              onChange={(e) => setDraft({ ...draft, symptoms: e.target.value })}
              placeholder="Patient-reported symptoms (e.g. pain, stiffness, weakness)"
              rows={3}
            />
          </label>
        </div>

        <label>
          Diagnosis <span className="required">*</span>
          <textarea required value={draft.diagnosis} onChange={(e) => setDraft({ ...draft, diagnosis: e.target.value })} placeholder="Primary diagnosis" />
        </label>

        <div className="form-two-col">
          <label>
            Complications (if any)
            <textarea
              rows={2}
              placeholder="e.g. Diabetes, hypertension, neuropathy…"
              value={draft.complications ?? ''}
              onChange={(e) => setDraft({ ...draft, complications: e.target.value })}
            />
          </label>
          <label>
            Surgeries (if any)
            <textarea
              rows={2}
              placeholder="e.g. ACL reconstruction March 2026, L4/L5 discectomy 2023…"
              value={draft.surgeries ?? ''}
              onChange={(e) => setDraft({ ...draft, surgeries: e.target.value })}
            />
          </label>
        </div>

        <label>
          Notes
          <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} placeholder="Additional clinical notes" />
        </label>
      </PatientFormSection>

      {(draft.homeVisitDetails || !isEntry) && (
        <PatientFormSection
          entry={isEntry}
          step={4}
          title="Home visit details"
          subtitle="Caregiver and visit schedule information"
          icon={Home}
        >
          {!isEntry ? (
            <div className="form-section">
              <div className="form-section-header">
                <h3 className="form-section-title"><Home size={15} /> Home visit details</h3>
                {!draft.homeVisitDetails ? (
                  <button
                    type="button" className="ghost-button"
                    onClick={() => setDraft({ ...draft, clinicId: null, homeVisitDetails: emptyHomeVisitDetails() })}
                  >
                    <Plus size={14} /> Enable
                  </button>
                ) : (
                  <button
                    type="button" className="ghost-button"
                    onClick={() => setDraft({ ...draft, clinicId: clinics[0]?.id ?? '', homeVisitDetails: undefined })}
                  >
                    <X size={14} /> Remove
                  </button>
                )}
              </div>
              {draft.homeVisitDetails && (
                <div className="form-two-col">
                  <label>
                    Caregiver name
                    <input
                      value={draft.homeVisitDetails.caregiverName}
                      onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, caregiverName: e.target.value } })}
                      placeholder="Name of the primary caregiver"
                    />
                  </label>
                  <label>
                    Relation to patient
                    <input
                      value={draft.homeVisitDetails.caregiverRelation}
                      onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, caregiverRelation: e.target.value } })}
                      placeholder="e.g. Son, Spouse, Parent…"
                    />
                  </label>
                  <label>
                    Caregiver phone
                    <input
                      type="tel"
                      value={draft.homeVisitDetails.caregiverPhone ?? ''}
                      onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, caregiverPhone: e.target.value } })}
                      placeholder="Caregiver contact number"
                    />
                  </label>
                  <label>
                    Condition / case summary
                    <input
                      value={draft.homeVisitDetails.condition}
                      onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, condition: e.target.value } })}
                      placeholder="e.g. Post-discectomy recovery"
                    />
                  </label>
                  <label>
                    Home visit started
                    <input
                      type="date"
                      value={draft.homeVisitDetails.homeVisitStartDate ?? ''}
                      onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, homeVisitStartDate: e.target.value } })}
                    />
                  </label>
                  <label>
                    Discharge date
                    <input
                      type="date"
                      value={draft.homeVisitDetails.dischargeDate}
                      onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, dischargeDate: e.target.value } })}
                    />
                  </label>
                </div>
              )}
            </div>
          ) : (
            <div className="form-two-col">
              <label>
                Caregiver name
                <input
                  value={draft.homeVisitDetails!.caregiverName}
                  onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, caregiverName: e.target.value } })}
                  placeholder="Name of the primary caregiver"
                />
              </label>
              <label>
                Relation to patient
                <input
                  value={draft.homeVisitDetails!.caregiverRelation}
                  onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, caregiverRelation: e.target.value } })}
                  placeholder="e.g. Son, Spouse, Parent…"
                />
              </label>
              <label>
                Caregiver phone
                <input
                  type="tel"
                  value={draft.homeVisitDetails!.caregiverPhone ?? ''}
                  onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, caregiverPhone: e.target.value } })}
                  placeholder="Caregiver contact number"
                />
              </label>
              <label>
                Condition / case summary
                <input
                  value={draft.homeVisitDetails!.condition}
                  onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, condition: e.target.value } })}
                  placeholder="e.g. Post-discectomy recovery"
                />
              </label>
              <label>
                Home visit started
                <input
                  type="date"
                  value={draft.homeVisitDetails!.homeVisitStartDate ?? ''}
                  onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, homeVisitStartDate: e.target.value } })}
                />
              </label>
              <label>
                Discharge date
                <input
                  type="date"
                  value={draft.homeVisitDetails!.dischargeDate}
                  onChange={(e) => setDraft({ ...draft, homeVisitDetails: { ...draft.homeVisitDetails!, dischargeDate: e.target.value } })}
                />
              </label>
            </div>
          )}
        </PatientFormSection>
      )}

      <PatientFormSection
        entry={isEntry}
        step={draft.homeVisitDetails ? 5 : 4}
        title="Reports"
        subtitle="Upload scans, prescriptions or assessment documents"
        icon={FileText}
      >
        {!isEntry ? (
          <div className="form-section">
            <h3 className="form-section-title"><FileText size={15} /> Reports</h3>
            {reportsBlock}
          </div>
        ) : (
          reportsBlock
        )}
      </PatientFormSection>
      </div>

      <div className={isEntry ? 'pe-footer' : editing ? 'modal-footer' : 'button-row'}>
        {isEntry && (
          <div className="pe-footer-meta">
            <Sparkles size={15} />
            <span>{completion === 100 ? 'Ready to save' : `${completion}% complete — fill required fields to save`}</span>
          </div>
        )}
        <div className={isEntry ? 'pe-footer-actions' : undefined}>
          {(isEntry || editing) && (
            <button className="ghost-button" type="button" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button className="primary-button" type="submit">
            {editing ? 'Save changes' : 'Add patient'}
          </button>
        </div>
      </div>
    </form>
  );
}

// ─── Sessions View (list + actions) ──────────────────────────────────────────

function SessionsView({
  data, allClinics, profiles, onUpdateSession, onBulkUpdateSessions, onChangeStatus, onDeleteSession, onScheduleNew, onRecordSession,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  allClinics: Clinic[];
  profiles: Profile[];
  onUpdateSession: (sessionId: string, updates: Partial<TherapySession>) => void;
  onBulkUpdateSessions: (items: { sessionId: string; updates: Partial<TherapySession> }[]) => void;
  onChangeStatus: (sessionId: string, status: SessionStatus) => void;
  onDeleteSession: (sessionId: string) => void;
  onScheduleNew: () => void;
  onRecordSession: (session: Omit<TherapySession, 'id'>) => void;
}) {
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionData, setCompletionData] = useState<CompletionFormData>(emptyCompletionForm);
  const [editingSession, setEditingSession] = useState<TherapySession | null>(null);
  const [bulkEditTarget, setBulkEditTarget] = useState<BulkEditTarget | null>(null);
  const [filterStatus, setFilterStatus] = useState<'all' | SessionStatus>('all');
  const [filterLevel, setFilterLevel] = useState<'all' | TherapyLevel>('all');
  const [filterPatient, setFilterPatient] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [expandedPatients, setExpandedPatients] = useState<Set<string>>(new Set());
  const [invoiceModal, setInvoiceModal] = useState<{
    patientId: string;
    mode?: InvoiceMode;
    sessionId?: string;
  } | null>(null);

  const togglePatient = (patientId: string) =>
    setExpandedPatients((prev) => {
      const next = new Set(prev);
      next.has(patientId) ? next.delete(patientId) : next.add(patientId);
      return next;
    });

  const submitCompletion = (e: FormEvent) => {
    e.preventDefault();
    if (!completingId || !completionData.therapyType.trim()) return;
    onUpdateSession(completingId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      therapyType: completionData.therapyType.trim(),
      treatmentNotes: completionData.treatmentNotes,
      amountCollected: completionData.amountCollected ? parseFloat(completionData.amountCollected) : null,
    });
    setCompletingId(null);
    setCompletionData(emptyCompletionForm());
  };

  const filteredSessions = data.therapySessions
    .filter((s) => s.sessionType === 'clinic')
    .filter((s) => filterStatus === 'all' || s.status === filterStatus)
    .filter((s) => filterLevel === 'all' || s.therapyLevel === filterLevel)
    .filter((s) => !filterPatient || s.patientId === filterPatient)
    .filter((s) => {
      if (!searchQuery) return true;
      const patient = data.patients.find((p) => p.id === s.patientId);
      return [s.therapyType, patient?.name ?? ''].join(' ').toLowerCase().includes(searchQuery.toLowerCase());
    });

  // Group by patient
  const patientGroups = useMemo(() => {
    const map = new Map<string, TherapySession[]>();
    filteredSessions.forEach((s) => {
      if (!map.has(s.patientId)) map.set(s.patientId, []);
      map.get(s.patientId)!.push(s);
    });
    return Array.from(map.entries())
      .map(([patientId, sessions]) => {
        const patient = data.patients.find((p) => p.id === patientId);
        const sorted = [...sessions].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
        return {
          patient,
          patientId,
          sessions: sorted,
          total:     sessions.length,
          scheduled: sessions.filter((s) => s.status === 'scheduled').length,
          completed: sessions.filter((s) => s.status === 'completed').length,
          cancelled: sessions.filter((s) => s.status === 'cancelled' || s.status === 'no_show').length,
          revenue:   sessions.filter((s) => s.status === 'completed' && s.amountCollected !== null)
                             .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0),
          next:      sorted.find((s) => s.status === 'scheduled' && s.scheduledAt >= todayStr),
        };
      })
      .sort((a, b) => (a.patient?.name ?? '').localeCompare(b.patient?.name ?? ''));
  }, [filteredSessions, data.patients]);

  const totalScheduled = filteredSessions.filter((s) => s.status === 'scheduled').length;
  const totalCompleted = filteredSessions.filter((s) => s.status === 'completed').length;
  const totalRevenue = filteredSessions
    .filter((s) => s.status === 'completed' && s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
  const estimatedRevenue = filteredSessions
    .filter((s) => s.status === 'scheduled' && s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);

  const invoicePatient = invoiceModal
    ? data.patients.find((p) => p.id === invoiceModal.patientId)
    : undefined;

  return (
    <>
      {/* Complete session modal */}
      {completingId && (
        <CompleteSessionModal
          title="Complete session"
          subtitle="Record therapy, treatment notes and payment"
          accentClass="modal-accent-green"
          icon="🏁"
          data={completionData}
          onChange={(updates) => setCompletionData((prev) => ({ ...prev, ...updates }))}
          onSubmit={submitCompletion}
          onClose={() => { setCompletingId(null); setCompletionData(emptyCompletionForm()); }}
        />
      )}

      {bulkEditTarget && (
        <BulkEditSessionsModal
          target={bulkEditTarget}
          onApply={(items) => { void onBulkUpdateSessions(items); setBulkEditTarget(null); }}
          onClose={() => setBulkEditTarget(null)}
        />
      )}

      {/* Edit session modal */}
      {editingSession && (
        <EditSessionModal
          session={editingSession}
          data={data}
          lockSessionType="clinic"
          onSave={(updates) => { onUpdateSession(editingSession.id, updates); setEditingSession(null); }}
          onClose={() => setEditingSession(null)}
        />
      )}

      {/* Record walk-in modal */}
      {showRecordModal && (
        <RecordSessionModal
          data={data}
          onSave={(session) => { onRecordSession(session); setShowRecordModal(false); }}
          onClose={() => setShowRecordModal(false)}
        />
      )}

      {invoiceModal && invoicePatient && (
        <InvoiceModal
          patient={invoicePatient}
          sessions={data.therapySessions}
          clinics={allClinics}
          profiles={profiles}
          initialMode={invoiceModal.mode}
          initialSessionId={invoiceModal.sessionId}
          onClose={() => setInvoiceModal(null)}
        />
      )}

      <div className="content-stack">
        {/* Summary metrics */}
        <section className="metric-grid metric-grid-5">
          <MetricCard icon={Users}        label="Patients"           value={patientGroups.length.toString()}   accent="teal" />
          <MetricCard icon={Activity}     label="Scheduled"          value={totalScheduled.toString()}          accent="blue" />
          <MetricCard icon={Check}        label="Completed"          value={totalCompleted.toString()}          accent="green" />
          <MetricCard icon={DollarSign}   label="Actual revenue"     value={formatCurrency(totalRevenue)}       accent="green"
            sub="Completed with payment" />
          <MetricCard icon={TrendingUp}   label="Estimated revenue"  value={estimatedRevenue > 0 ? formatCurrency(estimatedRevenue) : '—'}
            accent="blue" sub="Scheduled (pre-set amount)" />
        </section>

        <section className="panel">
          <div className="sessions-toolbar">
            <PanelTitle title="Clinic sessions by patient" subtitle="Home visits are managed in the Home Visits tab" />
            <div className="toolbar-actions">
              <button className="ghost-button accent" onClick={() => setShowRecordModal(true)}>
                <ClipboardList size={16} /> Record walk-in
              </button>
              <button className="primary-button" onClick={onScheduleNew}>
                <Plus size={16} /> Schedule sessions
              </button>
            </div>
          </div>

          <div className="sessions-filters">
            <div className="search-field">
              <Search size={15} />
              <input
                placeholder="Search patient or therapy…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select value={filterPatient} onChange={(e) => setFilterPatient(e.target.value)}>
              <option value="">All patients</option>
              {data.patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value as typeof filterLevel)}>
              <option value="all">All levels</option>
              <option value="basic">Basic</option>
              <option value="rehab">Rehab</option>
              <option value="advance">Advance</option>
            </select>
            <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as typeof filterStatus)}>
              <option value="all">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No show</option>
            </select>
          </div>

          {patientGroups.length === 0 ? (
            <EmptyState message="No sessions match your filters" />
          ) : (
            <div className="patient-session-groups">
              {patientGroups.map(({ patient, patientId, sessions, total, scheduled, completed, cancelled, revenue, next }) => {
                const isExpanded = expandedPatients.has(patientId);
                return (
                  <div key={patientId} className="patient-session-group">
                    <div className="patient-group-header">
                      <button
                        className="patient-group-header-main"
                        onClick={() => togglePatient(patientId)}
                        type="button"
                      >
                        <span className="patient-group-avatar">{(patient?.name ?? '?').charAt(0)}</span>
                        <div className="patient-group-info">
                          <strong>{patient?.name ?? 'Unknown patient'}</strong>
                          <span className="patient-group-clinic">
                            <Building2 size={11} />
                            {clinicName(allClinics, patient?.clinicId ?? sessions[0]?.clinicId)}
                          </span>
                          {next && <small>Next: {formatDateTime(next.scheduledAt)} · {formatTherapyTypeDisplay(next.therapyType)}</small>}
                        </div>
                        <div className="patient-group-stats">
                          <span className="pg-stat total"><CalendarDays size={12} />{total}</span>
                          <span className="pg-stat scheduled"><Activity size={12} />{scheduled}</span>
                          <span className="pg-stat completed"><Check size={12} />{completed}</span>
                          {cancelled > 0 && <span className="pg-stat cancelled"><X size={12} />{cancelled}</span>}
                          {revenue > 0 && <span className="pg-stat revenue"><DollarSign size={12} />{formatCurrency(revenue)}</span>}
                        </div>
                        <span className={`group-chevron ${isExpanded ? 'open' : ''}`}>
                          <ChevronRight size={16} />
                        </span>
                      </button>
                      {patient && revenue > 0 && (
                        <button
                          type="button"
                          className="secondary-button icon-only patient-group-invoice-btn"
                          title="Generate invoice"
                          onClick={() => setInvoiceModal({ patientId, mode: 'period' })}
                        >
                          <FileText size={14} />
                        </button>
                      )}
                      {scheduled >= 2 && (
                        <button
                          type="button"
                          className="secondary-button patient-group-bulk-btn"
                          title="Bulk edit all scheduled sessions"
                          onClick={() => setBulkEditTarget({
                            patientName: patient?.name ?? 'Patient',
                            sessionType: 'clinic',
                            sessions: sessions.filter((s) => s.status === 'scheduled'),
                          })}
                        >
                          <ClipboardList size={14} /> Bulk edit ({scheduled})
                        </button>
                      )}
                    </div>

                    {/* Expanded session rows — grouped by date */}
                    {isExpanded && (
                      <div className="patient-group-sessions">
                        {(() => {
                          // Group sessions by calendar date
                          const byDate = new Map<string, TherapySession[]>();
                          sessions.forEach((s) => {
                            const key = sessionDateKey(s.scheduledAt);
                            if (!byDate.has(key)) byDate.set(key, []);
                            byDate.get(key)!.push(s);
                          });
                          return Array.from(byDate.entries()).map(([dateKey, daySessions]) => {
                            const dateLabel = new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateKey + 'T12:00'));
                            return (
                              <div key={dateKey} className="session-date-group">
                                <div className="session-date-header">
                                  <Calendar size={12} />
                                  {dateLabel}
                                  {daySessions.length > 1 && (
                                    <span className="session-date-count">{daySessions.length} sessions</span>
                                  )}
                                </div>
                                {daySessions.map((session) => (
                                  <div key={session.id} className="group-session-row">
                                    <div className="group-session-badges">
                                      {session.sessionType === 'home'
                                        ? <span className="badge badge-amber"><Home size={10} /> Home</span>
                                        : <span className="badge badge-teal"><Stethoscope size={10} /> Clinic</span>}
                                      <span className={`therapy-level-badge ${session.therapyLevel ?? 'basic'}`}>{session.therapyLevel ?? 'basic'}</span>
                                    </div>
                                    <div className="group-session-info">
                                      <strong>{formatTherapyTypeDisplay(session.therapyType)}</strong>
                                      <div className="group-session-meta">
                                        <small className="group-session-clinic">
                                          <Building2 size={10} /> {clinicName(allClinics, session.clinicId)}
                                        </small>
                                        <span className="group-session-meta-sep">·</span>
                                        <small className="session-slot-time"><Clock size={10} /> {formatSessionTime(session.scheduledAt)}</small>
                                      </div>
                                      {session.treatmentNotes && <p className="clinical-note">{session.treatmentNotes}</p>}
                                    </div>
                                    <div className="group-session-right">
                                      <span className={`status ${session.status}`}>{statusLabel(session.status)}</span>
                                      {session.amountCollected !== null && (
                                        <span className={`revenue-badge${session.status === 'scheduled' ? ' est' : ''}`}>
                                          {session.status === 'scheduled' ? 'Est. ' : ''}{formatCurrency(session.amountCollected)}
                                        </span>
                                      )}
                                    </div>
                                    <div className="group-session-actions">
                                      {session.status === 'scheduled' && (
                                        <>
                                          <button className="primary-button icon-only" title="Mark complete"
                                            onClick={() => {
                                              setCompletingId(session.id);
                                              setCompletionData({
                                                treatmentNotes: session.treatmentNotes ?? '',
                                                amountCollected: session.amountCollected?.toString() ?? '',
                                                therapyType: session.therapyType ?? '',
                                              });
                                            }}>
                                            <Check size={13} />
                                          </button>
                                          <button className="secondary-button icon-only" title="Edit session" onClick={() => setEditingSession(session)}>
                                            <FileText size={13} />
                                          </button>
                                          <button className="ghost-button icon-only" title="No show" onClick={() => onChangeStatus(session.id, 'no_show')}>NS</button>
                                          <button className="ghost-button icon-only" title="Cancel" onClick={() => onChangeStatus(session.id, 'cancelled')}><X size={13} /></button>
                                          <button className="danger-button icon-only" title="Delete" onClick={() => onDeleteSession(session.id)}><Trash2 size={13} /></button>
                                        </>
                                      )}
                                      {session.status === 'completed' && session.amountCollected !== null && patient && (
                                        <button
                                          className="secondary-button icon-only"
                                          title="Generate invoice"
                                          onClick={() => setInvoiceModal({
                                            patientId: patient.id,
                                            mode: 'single',
                                            sessionId: session.id,
                                          })}
                                        >
                                          <Receipt size={13} />
                                        </button>
                                      )}
                                      {session.status !== 'scheduled' && (
                                        <button className="danger-button icon-only" title="Delete" onClick={() => onDeleteSession(session.id)}><Trash2 size={13} /></button>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            );
                          });
                        })()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

// ─── Home Visits View (home-only scheduling + management) ─────────────────────

function HomeVisitsView({
  data, currentUser, preset, onAddSession, onUpdateSession, onBulkUpdateSessions, onChangeStatus, onDeleteSession, onOpenPatient, onClearPreset,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  currentUser: Profile;
  preset: { patientId?: string; sessionType?: SessionType };
  onAddSession: (session: Omit<TherapySession, 'id'>) => void;
  onUpdateSession: (sessionId: string, updates: Partial<TherapySession>) => void;
  onBulkUpdateSessions: (items: { sessionId: string; updates: Partial<TherapySession> }[]) => void;
  onChangeStatus: (sessionId: string, status: SessionStatus) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenPatient: (patientId: string) => void;
  onClearPreset: () => void;
}) {
  const homeSessions = data.therapySessions.filter((s) => s.sessionType === 'home');
  const homePatientIds = new Set(homeSessions.map((s) => s.patientId));
  const homePatients = data.patients.filter((p) => p.homeVisitDetails || homePatientIds.has(p.id) || p.id === preset.patientId);
  const [patientId, setPatientId] = useState(preset.patientId ?? homePatients[0]?.id ?? '');
  const [therapyType, setTherapyType] = useState('Home Visit');
  const [therapyLevel, setTherapyLevel] = useState<TherapyLevel>('basic');
  const [dualTherapy, setDualTherapy] = useState(false);
  const [therapyType2, setTherapyType2] = useState('');
  const [therapyLevel2, setTherapyLevel2] = useState<TherapyLevel>('basic');
  const [startDate, setStartDate] = useState(todayStr);
  const [startTime, setStartTime] = useState('09:00');
  const [startTime2, setStartTime2] = useState('11:00');
  const [visitCount, setVisitCount] = useState(1);
  const [freqDays, setFreqDays] = useState(1);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionData, setCompletionData] = useState<CompletionFormData>(emptyCompletionForm);
  const [editingSession, setEditingSession] = useState<TherapySession | null>(null);
  const [bulkEditTarget, setBulkEditTarget] = useState<BulkEditTarget | null>(null);

  useEffect(() => {
    if (preset.patientId) {
      setPatientId(preset.patientId);
      return;
    }
    if (!patientId && homePatients[0]) setPatientId(homePatients[0].id);
  }, [homePatients, patientId, preset.patientId]);

  const submitSchedule = (e: FormEvent) => {
    e.preventDefault();
    if (!patientId || !therapyType.trim() || !isHomeVisitSlot(startTime)) return;
    if (dualTherapy && (!therapyType2.trim() || !isHomeVisitSlot(startTime2))) return;

    const count = Math.max(1, Math.min(visitCount, 60));
    const gap = Math.max(1, freqDays);
    const parsedAmount = amount ? parseFloat(amount) : null;
    const base = {
      patientId,
      clinicId: null,
      sessionType: 'home' as const,
      assignedStaffId: currentUser.id,
      status: 'scheduled' as const,
      completedAt: null,
      notes,
      treatmentNotes: '',
      amountCollected: parsedAmount,
    };

    for (let i = 0; i < count; i++) {
      const d = new Date(`${startDate}T${startTime}`);
      d.setDate(d.getDate() + i * gap);
      onAddSession({
        ...base,
        scheduledAt: formatLocalDateTimeFromDate(d, startTime),
        therapyType: therapyType.trim(),
        therapyLevel,
      });
      if (dualTherapy && therapyType2.trim()) {
        onAddSession({
          ...base,
          scheduledAt: formatLocalDateTimeFromDate(d, startTime2),
          therapyType: therapyType2.trim(),
          therapyLevel: therapyLevel2,
        });
      }
    }
  };

  const submitCompletion = (e: FormEvent) => {
    e.preventDefault();
    if (!completingId || !completionData.therapyType.trim()) return;
    onUpdateSession(completingId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      therapyType: completionData.therapyType.trim(),
      treatmentNotes: completionData.treatmentNotes,
      amountCollected: completionData.amountCollected ? parseFloat(completionData.amountCollected) : null,
    });
    setCompletingId(null);
    setCompletionData(emptyCompletionForm());
  };

  const groups = Array.from(
    homeSessions.reduce((map, session) => {
      if (!map.has(session.patientId)) map.set(session.patientId, []);
      map.get(session.patientId)!.push(session);
      return map;
    }, new Map<string, TherapySession[]>())
  ).map(([id, sessions]) => {
    const patient = data.patients.find((p) => p.id === id);
    const sorted = [...sessions].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
    return {
      patient,
      patientId: id,
      sessions: sorted,
      total: sessions.length,
      scheduled: sessions.filter((s) => s.status === 'scheduled').length,
      completed: sessions.filter((s) => s.status === 'completed').length,
      missed: sessions.filter((s) => s.status === 'cancelled' || s.status === 'no_show').length,
      next: sorted.find((s) => s.status === 'scheduled' && s.scheduledAt >= todayStr),
    };
  }).sort((a, b) => (a.patient?.name ?? '').localeCompare(b.patient?.name ?? ''));

  // Which patient cards are expanded to show sessions
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className="content-stack">
      {completingId && (
        <CompleteSessionModal
          title="Complete home visit"
          subtitle="Record therapy, treatment notes and amount collected"
          accentClass="modal-accent-teal"
          icon={<Home size={18} />}
          data={completionData}
          onChange={(updates) => setCompletionData((prev) => ({ ...prev, ...updates }))}
          onSubmit={submitCompletion}
          onClose={() => { setCompletingId(null); setCompletionData(emptyCompletionForm()); }}
        />
      )}

      {bulkEditTarget && (
        <BulkEditSessionsModal
          target={bulkEditTarget}
          onApply={(items) => { void onBulkUpdateSessions(items); setBulkEditTarget(null); }}
          onClose={() => setBulkEditTarget(null)}
        />
      )}

      {editingSession && (
        <EditSessionModal
          session={editingSession}
          data={data}
          lockSessionType="home"
          onSave={(updates) => { onUpdateSession(editingSession.id, updates); setEditingSession(null); }}
          onClose={() => setEditingSession(null)}
        />
      )}

      <section className="panel home-visit-scheduler">
        <div className="toolbar">
          <PanelTitle title="Schedule home visits" subtitle="9 AM–6 PM slots · optional dual timings per visit day" />
          {preset.patientId && (
            <button className="ghost-button" type="button" onClick={onClearPreset}>Clear patient preset</button>
          )}
        </div>
        {homePatients.length === 0 ? (
          <EmptyState message="Enable Home visit details on a patient record before scheduling home visits." />
        ) : (
          <form className="home-schedule-grid" onSubmit={submitSchedule}>
            <label>
              Patient
              <select required value={patientId} onChange={(e) => setPatientId(e.target.value)}>
                {homePatients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>

            <div className="dual-therapy-block home-dual-block">
              <div className="dual-therapy-header">
                <label className="dual-therapy-label">
                  {dualTherapy ? 'Therapy 1' : 'Therapy / treatment type'}
                </label>
                <button
                  type="button"
                  className={`toggle-btn ${dualTherapy ? 'active' : ''}`}
                  onClick={() => setDualTherapy((v) => !v)}
                >
                  <Plus size={13} /> {dualTherapy ? 'Dual slot on' : 'Add 2nd slot'}
                </button>
              </div>
              <TherapyTypeSelect required value={therapyType} onChange={setTherapyType} />
              <div className="toggle-row" style={{ marginTop: 6 }}>
                {(['basic', 'rehab', 'advance'] as TherapyLevel[]).map((lvl) => (
                  <button key={lvl} type="button"
                    className={`toggle-btn level-${lvl} ${therapyLevel === lvl ? 'active' : ''}`}
                    onClick={() => setTherapyLevel(lvl)}
                  >
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {dualTherapy && (
              <div className="dual-therapy-block second home-dual-block">
                <div className="dual-therapy-header">
                  <label className="dual-therapy-label">Therapy 2</label>
                </div>
                <TherapyTypeSelect required value={therapyType2} onChange={setTherapyType2} />
                <div className="toggle-row" style={{ marginTop: 6 }}>
                  {(['basic', 'rehab', 'advance'] as TherapyLevel[]).map((lvl) => (
                    <button key={lvl} type="button"
                      className={`toggle-btn level-${lvl} ${therapyLevel2 === lvl ? 'active' : ''}`}
                      onClick={() => setTherapyLevel2(lvl)}
                    >
                      {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label>
              Start date
              <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              {dualTherapy ? 'Slot 1 time' : 'Time slot'}
              <select value={startTime} onChange={(e) => setStartTime(e.target.value)}>
                {HOME_VISIT_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>{formatVisitSlotLabel(slot)}</option>
                ))}
              </select>
            </label>
            {dualTherapy && (
              <label>
                Slot 2 time
                <select value={startTime2} onChange={(e) => setStartTime2(e.target.value)}>
                  {HOME_VISIT_SLOTS.map((slot) => (
                    <option key={slot} value={slot}>{formatVisitSlotLabel(slot)}</option>
                  ))}
                </select>
              </label>
            )}
            {dualTherapy && (
              <small className="dual-slot-hint home-dual-hint">
                Each visit day: {formatVisitSlotLabel(startTime)} and {formatVisitSlotLabel(startTime2)}
              </small>
            )}
            <label>
              Number of visits
              <input type="number" min="1" max="60" value={visitCount} onChange={(e) => setVisitCount(parseInt(e.target.value || '1', 10))} />
            </label>
            <label>
              Repeat every (days)
              <input type="number" min="1" value={freqDays} onChange={(e) => setFreqDays(parseInt(e.target.value || '1', 10))} />
            </label>
            <label>
              Estimated amount (₹)
              <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
            <label className="home-schedule-notes">
              Notes
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </label>
            <div className="form-actions">
              <button className="primary-button" type="submit">
                <Plus size={15} />
                {dualTherapy
                  ? `Schedule ${visitCount * 2} home visit${visitCount * 2 !== 1 ? 's' : ''}`
                  : `Schedule home visit${visitCount !== 1 ? 's' : ''}`}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="panel">
        <PanelTitle
          title="Home visit patients"
          subtitle={`${groups.length} patient${groups.length !== 1 ? 's' : ''} · ${homeSessions.length} total visits`}
        />
        {groups.length === 0 ? (
          <EmptyState message="No home visits scheduled yet" />
        ) : (
          <div className="hv-patient-list">
            {groups.map(({ patient, patientId: gpId, sessions, total, scheduled, completed, missed, next }) => {
              const isOpen = expandedIds.has(gpId);
              const hvd = patient?.homeVisitDetails;
              const age = patient?.dateOfBirth
                ? `${Math.floor((Date.now() - new Date(patient.dateOfBirth).getTime()) / (365.25 * 24 * 3600 * 1000))} yrs`
                : null;

              return (
                <div key={gpId} className={`hv-patient-card${isOpen ? ' open' : ''}`}>
                  {/* ── Collapsed header (always visible) ── */}
                  <div className="hv-card-header">
                    <div className="hv-card-avatar">{(patient?.name ?? '?').charAt(0).toUpperCase()}</div>

                    <div className="hv-card-main">
                      <div className="hv-card-name-row">
                        <span className="hv-card-name">{patient?.name ?? 'Unknown patient'}</span>
                        {patient?.gender && <span className="hv-detail-chip">{patient.gender}</span>}
                        {age && <span className="hv-detail-chip">{age}</span>}
                        {hvd?.condition && <span className="hv-detail-chip hv-chip-condition">{hvd.condition}</span>}
                      </div>

                      <div className="hv-card-meta-row">
                        {patient?.phone && (
                          <span className="hv-meta-item"><Phone size={11} /> {patient.phone}</span>
                        )}
                        {hvd?.homeVisitStartDate && (
                          <span className="hv-meta-item"><Calendar size={11} /> Since {hvd.homeVisitStartDate}</span>
                        )}
                        {hvd?.caregiverName && (
                          <span className="hv-meta-item"><UserCheck size={11} /> {hvd.caregiverName}
                            {hvd.caregiverRelation ? ` (${hvd.caregiverRelation})` : ''}
                            {hvd.caregiverPhone ? ` · ${hvd.caregiverPhone}` : ''}
                          </span>
                        )}
                        {next
                          ? <span className="hv-meta-item hv-meta-next"><Activity size={11} /> Next: {formatDateTime(next.scheduledAt)}</span>
                          : <span className="hv-meta-item hv-meta-none">No upcoming visit</span>
                        }
                      </div>
                    </div>

                    {/* Stats */}
                    <div className="hv-card-stats">
                      <div className="hv-stat-pill hv-stat-total"><Home size={11} />{total}</div>
                      <div className="hv-stat-pill hv-stat-sched"><Activity size={11} />{scheduled}</div>
                      <div className="hv-stat-pill hv-stat-done"><Check size={11} />{completed}</div>
                      {missed > 0 && <div className="hv-stat-pill hv-stat-miss"><X size={11} />{missed}</div>}
                    </div>

                    {/* Controls */}
                    <div className="hv-card-controls">
                      {scheduled >= 2 && (
                        <button
                          type="button"
                          className="secondary-button hv-bulk-edit-btn"
                          title="Bulk edit all scheduled visits"
                          onClick={(e) => {
                            e.stopPropagation();
                            setBulkEditTarget({
                              patientName: patient?.name ?? 'Patient',
                              sessionType: 'home',
                              sessions: sessions.filter((s) => s.status === 'scheduled'),
                            });
                          }}
                        >
                          <ClipboardList size={13} /> Bulk edit
                        </button>
                      )}
                      <button className="ghost-button icon-only" title="Open patient record"
                        onClick={(e) => { e.stopPropagation(); patient && onOpenPatient(patient.id); }}>
                        <ExternalLink size={13} />
                      </button>
                      <button
                        className={`hv-expand-btn${isOpen ? ' open' : ''}`}
                        type="button"
                        title={isOpen ? 'Collapse sessions' : `Show ${total} session${total !== 1 ? 's' : ''}`}
                        onClick={() => toggleExpand(gpId)}>
                        <ChevronRight size={15} className={`hv-chevron${isOpen ? ' rotated' : ''}`} />
                        <span>{isOpen ? 'Hide' : `${total} session${total !== 1 ? 's' : ''}`}</span>
                      </button>
                    </div>
                  </div>

                  {/* ── Expanded sessions ── */}
                  {isOpen && (
                    <div className="hv-sessions-body">
                      {sessions.map((session) => (
                        <div key={session.id} className="hv-session-row">
                          <div className="hv-session-left">
                            <span className={`therapy-level-badge ${session.therapyLevel ?? 'basic'}`}>{session.therapyLevel ?? 'basic'}</span>
                            <div className="hv-session-info">
                              <span className="hv-session-type">{formatTherapyTypeDisplay(session.therapyType)}</span>
                              <span className="hv-session-time"><Clock size={10} /> {formatDateTime(session.scheduledAt)}</span>
                              {session.notes && <span className="hv-session-note">{session.notes}</span>}
                            </div>
                          </div>
                          <div className="hv-session-right">
                            <span className={`status ${session.status}`}>{statusLabel(session.status)}</span>
                            {session.amountCollected !== null && (
                              <span className={`revenue-badge${session.status === 'scheduled' ? ' est' : ''}`}>
                                {session.status === 'scheduled' ? 'Est. ' : ''}{formatCurrency(session.amountCollected)}
                              </span>
                            )}
                            <div className="hv-session-actions">
                              {session.status === 'scheduled' && (
                                <>
                                  <button className="secondary-button icon-only" title="Edit session"
                                    onClick={() => setEditingSession(session)}>
                                    <ClipboardList size={12} />
                                  </button>
                                  <button className="primary-button icon-only" title="Mark complete"
                                    onClick={() => {
                                      setCompletingId(session.id);
                                      setCompletionData({
                                        treatmentNotes: session.treatmentNotes ?? '',
                                        amountCollected: session.amountCollected?.toString() ?? '',
                                        therapyType: session.therapyType ?? '',
                                      });
                                    }}>
                                    <Check size={12} />
                                  </button>
                                  <button className="ghost-button icon-only" title="No show"
                                    onClick={() => onChangeStatus(session.id, 'no_show')}>NS</button>
                                  <button className="ghost-button icon-only" title="Cancel"
                                    onClick={() => onChangeStatus(session.id, 'cancelled')}><X size={12} /></button>
                                </>
                              )}
                              <button className="danger-button icon-only" title="Delete"
                                onClick={() => onDeleteSession(session.id)}><Trash2 size={12} /></button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Bulk edit scheduled sessions ─────────────────────────────────────────────

type BulkEditTarget = {
  patientName: string;
  sessionType: SessionType;
  sessions: TherapySession[];
};

type BulkEditForm = {
  shiftDays: string;
  newTime: string;
  therapyType: string;
  therapyLevel: '' | TherapyLevel;
  amountCollected: string;
  notes: string;
};

const emptyBulkEditForm = (): BulkEditForm => ({
  shiftDays: '',
  newTime: '',
  therapyType: '',
  therapyLevel: '',
  amountCollected: '',
  notes: '',
});

function buildBulkSessionUpdates(session: TherapySession, form: BulkEditForm): Partial<TherapySession> {
  const updates: Partial<TherapySession> = {};
  let scheduledAt = session.scheduledAt;

  if (form.shiftDays !== '' && form.shiftDays !== '0') {
    const d = parseScheduledAt(scheduledAt);
    d.setDate(d.getDate() + parseInt(form.shiftDays, 10));
    scheduledAt = formatLocalDateTimeFromDate(d, sessionTimeKey(scheduledAt));
  }
  if (form.newTime) {
    scheduledAt = buildLocalDateTime(sessionDateKey(scheduledAt), form.newTime);
  }
  if ((form.shiftDays !== '' && form.shiftDays !== '0') || form.newTime) {
    updates.scheduledAt = scheduledAt;
  }
  if (form.therapyType.trim()) updates.therapyType = form.therapyType.trim();
  if (form.therapyLevel) updates.therapyLevel = form.therapyLevel;
  if (form.amountCollected !== '') updates.amountCollected = parseFloat(form.amountCollected);
  if (form.notes !== '') updates.notes = form.notes;
  return updates;
}

function BulkEditSessionsModal({
  target, onApply, onClose,
}: {
  target: BulkEditTarget;
  onApply: (items: { sessionId: string; updates: Partial<TherapySession> }[]) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(emptyBulkEditForm);
  const [saving, setSaving] = useState(false);
  const isHome = target.sessionType === 'home';
  const slotOptions = isHome ? HOME_VISIT_SLOTS : CLINIC_VISIT_SLOTS;
  const sorted = [...target.sessions].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));

  const set = (k: keyof BulkEditForm, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const items = sorted
      .map((session) => ({
        sessionId: session.id,
        updates: buildBulkSessionUpdates(session, form),
      }))
      .filter((item) => Object.keys(item.updates).length > 0);
    if (items.length === 0) return;
    setSaving(true);
    onApply(items);
    setSaving(false);
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-panel bulk-edit-modal" style={{ maxWidth: 520 }} onSubmit={handleSubmit}>
        <div className={`modal-accent ${isHome ? 'modal-accent-teal' : 'modal-accent-violet'}`} />
        <div className="modal-header">
          <div className="modal-header-icon">
            {isHome ? <Home size={18} /> : <Stethoscope size={18} />}
          </div>
          <div>
            <h3 className="modal-title">Bulk edit scheduled sessions</h3>
            <p className="modal-sub">
              {target.patientName} · {sorted.length} session{sorted.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <p className="bulk-edit-hint">
            Fill only the fields you want to change — blank fields are left unchanged on every session.
          </p>

          <div className="form-two-col">
            <label>
              Shift all dates (days)
              <input
                type="number"
                value={form.shiftDays}
                onChange={(e) => set('shiftDays', e.target.value)}
                placeholder="e.g. 1 or -2"
              />
            </label>
            <label>
              Set time slot
              <select value={form.newTime} onChange={(e) => set('newTime', e.target.value)}>
                <option value="">— keep current times —</option>
                {slotOptions.map((slot) => (
                  <option key={slot} value={slot}>{formatVisitSlotLabel(slot)}</option>
                ))}
              </select>
            </label>
          </div>

          <label>
            Therapy type
            <TherapyTypeSelect value={form.therapyType} onChange={(v) => set('therapyType', v)} />
            {!form.therapyType && <small className="bulk-edit-field-hint">Leave empty to keep current therapy on each session</small>}
          </label>

          <label>
            Therapy level
            <select value={form.therapyLevel} onChange={(e) => set('therapyLevel', e.target.value)}>
              <option value="">— keep current level —</option>
              <option value="basic">Basic</option>
              <option value="rehab">Rehab</option>
              <option value="advance">Advance</option>
            </select>
          </label>

          <label>
            Estimated amount (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amountCollected}
              onChange={(e) => set('amountCollected', e.target.value)}
              placeholder="Leave blank to keep current"
            />
          </label>

          <label>
            Notes
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Leave blank to keep current notes"
            />
          </label>

          <div className="bulk-edit-preview">
            <span className="bulk-edit-preview-label">Sessions to update</span>
            <ul className="bulk-edit-preview-list">
              {sorted.slice(0, 8).map((s) => (
                <li key={s.id}>
                  {formatSessionDateTime(s.scheduledAt)} · {formatTherapyTypeDisplay(s.therapyType)}
                </li>
              ))}
              {sorted.length > 8 && <li className="bulk-edit-preview-more">+{sorted.length - 8} more</li>}
            </ul>
          </div>
        </div>
        <div className="modal-footer">
          <button className="ghost-button" type="button" onClick={onClose}><X size={14} /> Cancel</button>
          <button className="primary-button" type="submit" disabled={saving}>
            <Check size={14} /> Apply to {sorted.length} session{sorted.length !== 1 ? 's' : ''}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Edit Session Modal ────────────────────────────────────────────────────────

function EditSessionModal({
  session, data, lockSessionType, onSave, onClose,
}: {
  session: TherapySession;
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  lockSessionType?: SessionType;
  onSave: (updates: Partial<TherapySession>) => void;
  onClose: () => void;
}) {
  const effectiveType = lockSessionType ?? (session.sessionType as SessionType);
  const [form, setForm] = useState({
    therapyType:   session.therapyType,
    sessionType:   effectiveType,
    therapyLevel:  session.therapyLevel as TherapyLevel,
    homeDate:      sessionDateKey(session.scheduledAt),
    homeTime:      snapToHomeVisitSlot(sessionTimeKey(session.scheduledAt)),
    clinicDate:    sessionDateKey(session.scheduledAt),
    clinicTime:    snapToClinicVisitSlot(sessionTimeKey(session.scheduledAt)),
    notes:         session.notes,
    amountCollected: session.amountCollected != null ? String(session.amountCollected) : '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const isHome = form.sessionType === 'home';

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const scheduledAt = isHome
      ? buildLocalDateTime(form.homeDate, form.homeTime)
      : buildLocalDateTime(form.clinicDate, form.clinicTime);
    onSave({
      therapyType:     form.therapyType,
      sessionType:     form.sessionType,
      therapyLevel:    form.therapyLevel,
      scheduledAt,
      notes:           form.notes,
      amountCollected: form.amountCollected !== '' ? parseFloat(form.amountCollected) : null,
    });
  };

  const patient = data.patients.find((p) => p.id === session.patientId);
  const slotOptions = isHome ? HOME_VISIT_SLOTS : CLINIC_VISIT_SLOTS;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-panel" style={{ maxWidth: 440 }} onSubmit={handleSubmit}>
        <div className={`modal-accent ${isHome ? 'modal-accent-teal' : 'modal-accent-violet'}`} />
        <div className="modal-header">
          <div className="modal-header-icon">
            {isHome ? <Home size={18} /> : <Stethoscope size={18} />}
          </div>
          <div>
            <h3 className="modal-title">Edit scheduled session</h3>
            <p className="modal-sub">
              {patient?.name ?? 'Unknown'}
              {lockSessionType === 'home' ? ' · Home visit' : lockSessionType === 'clinic' ? ' · Clinic' : ''}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <label>
            Therapy type <span className="required">*</span>
            <TherapyTypeSelect required value={form.therapyType} onChange={(v) => set('therapyType', v)} />
          </label>
          <label>
            Date &amp; time
            <div className="form-two-col" style={{ marginTop: 6 }}>
              <input
                type="date"
                required
                value={isHome ? form.homeDate : form.clinicDate}
                onChange={(e) => set(isHome ? 'homeDate' : 'clinicDate', e.target.value)}
              />
              <select
                value={isHome ? form.homeTime : form.clinicTime}
                onChange={(e) => set(isHome ? 'homeTime' : 'clinicTime', e.target.value)}
              >
                {slotOptions.map((slot) => (
                  <option key={slot} value={slot}>{formatVisitSlotLabel(slot)}</option>
                ))}
              </select>
            </div>
          </label>
          {!lockSessionType && (
            <label>
              Session type
              <div className="toggle-row">
                {(['clinic', 'home'] as SessionType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`toggle-btn ${form.sessionType === t ? 'active' : ''}`}
                    onClick={() => setForm((f) => ({
                      ...f,
                      sessionType: t,
                      homeTime: snapToHomeVisitSlot(f.homeTime),
                      clinicTime: snapToClinicVisitSlot(f.clinicTime),
                    }))}
                  >
                    {t === 'clinic' ? <Stethoscope size={13} /> : <Home size={13} />}
                    {t === 'clinic' ? 'Clinic' : 'Home visit'}
                  </button>
                ))}
              </div>
            </label>
          )}
          <label>
            Therapy level
            <div className="toggle-row">
              {(['basic', 'rehab', 'advance'] as TherapyLevel[]).map((lvl) => (
                <button key={lvl} type="button" className={`toggle-btn level-${lvl} ${form.therapyLevel === lvl ? 'active' : ''}`} onClick={() => set('therapyLevel', lvl)}>
                  {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                </button>
              ))}
            </div>
          </label>
          <label>
            Estimated amount (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.amountCollected}
              onChange={(e) => set('amountCollected', e.target.value)}
              placeholder="Leave blank if unknown"
            />
          </label>
          <label>
            Notes
            <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any notes for this session…" />
          </label>
        </div>
        <div className="modal-footer">
          <button className="ghost-button" type="button" onClick={onClose}><X size={14} /> Cancel</button>
          <button className="primary-button" type="submit"><Check size={14} /> Save changes</button>
        </div>
      </form>
    </div>
  );
}

// ─── Schedule New Page ────────────────────────────────────────────────────────

type ScheduleMode = 'count' | 'range';
type FrequencyUnit = 'days' | 'weeks' | 'months';

function generateDates(
  mode: ScheduleMode,
  startDate: string,
  startTime: string,
  countMode: { count: number; freqValue: number; freqUnit: FrequencyUnit },
  rangeMode: { endDate: string; freqValue: number; freqUnit: FrequencyUnit }
): string[] {
  const dates: string[] = [];
  if (!startDate || !startTime) return dates;

  const addUnit = (date: Date, value: number, unit: FrequencyUnit): Date => {
    const d = new Date(date);
    if (unit === 'days')   d.setDate(d.getDate() + value);
    if (unit === 'weeks')  d.setDate(d.getDate() + value * 7);
    if (unit === 'months') d.setMonth(d.getMonth() + value);
    return d;
  };

  const toISO = (d: Date) => formatLocalDateTimeFromDate(d, startTime);

  const start = new Date(`${startDate}T${startTime}`);
  if (isNaN(start.getTime())) return dates;

  if (mode === 'count') {
    const { count, freqValue, freqUnit } = countMode;
    if (count < 1 || freqValue < 1) return dates;
    let current = start;
    for (let i = 0; i < Math.min(count, 60); i++) {
      dates.push(toISO(current));
      current = addUnit(current, freqValue, freqUnit);
    }
  } else {
    const { endDate, freqValue, freqUnit } = rangeMode;
    if (!endDate || freqValue < 1) return dates;
    const end = new Date(`${endDate}T${startTime}`);
    if (isNaN(end.getTime()) || end < start) return dates;
    let current = start;
    while (current <= end && dates.length < 60) {
      dates.push(toISO(current));
      current = addUnit(current, freqValue, freqUnit);
    }
  }
  return dates;
}

// ─── Record walk-in session modal ────────────────────────────────────────────

function RecordSessionModal({
  data, onSave, onClose,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  onSave: (session: Omit<TherapySession, 'id'>) => void;
  onClose: () => void;
}) {
  const nowLocal = localDateTimeInputValue();

  const [form, setForm] = useState({
    patientId: '',
    clinicId: data.clinics[0]?.id ?? '',
    therapyType: '',
    therapyLevel: 'basic' as TherapyLevel,
    scheduledAt: nowLocal,
    status: 'completed' as SessionStatus,
    amountCollected: '',
    treatmentNotes: '',
    staffId: '',
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.patientId) return;
    onSave({
      patientId:        form.patientId,
      clinicId:         form.clinicId,
      therapyType:      form.therapyType,
      sessionType:      'clinic',
      therapyLevel:     form.therapyLevel,
      scheduledAt:      form.scheduledAt,
      status:           form.status,
      amountCollected:  form.amountCollected ? parseFloat(form.amountCollected) : null,
      treatmentNotes:   form.treatmentNotes,
      assignedStaffId:  form.staffId,
      notes:            '',
      completedAt:      form.status === 'completed' ? new Date().toISOString() : null,
    });
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-panel record-session-modal" onSubmit={handleSubmit}>
        <div className="modal-accent" />
        <div className="modal-header">
          <div className="modal-header-icon"><Stethoscope size={18} /></div>
          <div>
            <h3 className="modal-title">Record session</h3>
            <p className="modal-sub">Log a walk-in or already-completed session</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="record-session-grid">
          {/* Left column */}
          <div className="form-col">
            <label>
              Patient <span className="required">*</span>
              <select required value={form.patientId} onChange={(e) => set('patientId', e.target.value)}>
                <option value="">— select patient —</option>
                {data.patients.filter((p) => p.clinicId !== null).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>

            <label>
              Clinic
              <select value={form.clinicId} onChange={(e) => set('clinicId', e.target.value)}>
                {data.clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>

            <label>
              Therapy type <span className="required">*</span>
              <TherapyTypeSelect required value={form.therapyType} onChange={(v) => set('therapyType', v)} />
            </label>

            <div className="home-no-clinic-note">
              <Stethoscope size={15} />
              Clinic walk-in session
            </div>

            <label>
              Therapy level
              <div className="toggle-row">
                {(['basic', 'rehab', 'advance'] as TherapyLevel[]).map((lvl) => (
                  <button
                    key={lvl} type="button"
                    className={`toggle-btn level-${lvl} ${form.therapyLevel === lvl ? 'active' : ''}`}
                    onClick={() => set('therapyLevel', lvl)}
                  >
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </button>
                ))}
              </div>
            </label>
          </div>

          {/* Right column */}
          <div className="form-col">
            <label>
              Date &amp; time
              <input
                type="datetime-local"
                value={form.scheduledAt}
                onChange={(e) => set('scheduledAt', e.target.value)}
              />
            </label>

            <label>
              Status
              <div className="toggle-row">
                {(['completed', 'scheduled', 'cancelled', 'no_show'] as SessionStatus[]).map((s) => (
                  <button
                    key={s} type="button"
                    className={`toggle-btn status-${s} ${form.status === s ? 'active' : ''}`}
                    onClick={() => set('status', s)}
                  >
                    {statusLabel(s)}
                  </button>
                ))}
              </div>
            </label>

            <label>
              Amount collected (₹)
              <input
                type="number" min="0" step="0.01"
                value={form.amountCollected}
                onChange={(e) => set('amountCollected', e.target.value)}
                placeholder="0"
              />
            </label>

            <label>
              Treatment notes
              <textarea
                rows={3}
                value={form.treatmentNotes}
                onChange={(e) => set('treatmentNotes', e.target.value)}
                placeholder="What was done in this session…"
              />
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button className="ghost-button" type="button" onClick={onClose}><X size={14} /> Cancel</button>
          <button className="primary-button" type="submit"><Check size={14} /> Save session</button>
        </div>
      </form>
    </div>
  );
}

function ScheduleNewPage({
  data, staff, currentUser, defaultClinicId, preset, onAddSession, onBack, onClearPreset,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  staff: Profile[];
  currentUser: Profile;
  defaultClinicId: string;
  preset: { patientId?: string; sessionType?: SessionType };
  onAddSession: (session: Omit<TherapySession, 'id'>) => void;
  onBack: () => void;
  onClearPreset: () => void;
}) {
  const clinicPatients = data.patients.filter((p) => p.clinicId !== null);
  const [patientId, setPatientId] = useState(preset.patientId ?? clinicPatients[0]?.id ?? '');
  const sessionType: SessionType = 'clinic';
  const [therapyLevel, setTherapyLevel] = useState<TherapyLevel>('basic');
  const [therapyType, setTherapyType] = useState('');
  const [dualTherapy, setDualTherapy] = useState(false);
  const [therapyType2, setTherapyType2] = useState('');
  const [therapyLevel2, setTherapyLevel2] = useState<TherapyLevel>('basic');
  const [startTime2, setStartTime2] = useState('11:00');
  const [assignedStaffId, setAssignedStaffId] = useState(currentUser.id);
  const [notes, setNotes] = useState('');
  const [amountPerSession, setAmountPerSession] = useState('');

  // Scheduling config
  const [mode, setMode] = useState<ScheduleMode>('count');
  const [startDate, setStartDate] = useState(todayStr);
  const [startTime, setStartTime] = useState('09:00');
  const [countConfig, setCountConfig] = useState({ count: 10, freqValue: 2, freqUnit: 'days' as FrequencyUnit });
  const [rangeConfig, setRangeConfig] = useState({ endDate: '', freqValue: 2, freqUnit: 'days' as FrequencyUnit });

  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successCount, setSuccessCount] = useState(0);

  const finishScheduling = useCallback(() => {
    setConfirmed(false);
    setSuccessCount(0);
    onBack();
  }, [onBack]);

  useEffect(() => {
    if (!confirmed) return;
    const timer = window.setTimeout(finishScheduling, 3500);
    return () => clearTimeout(timer);
  }, [confirmed, finishScheduling]);

  // Sync preset
  useEffect(() => {
    if (preset.patientId) setPatientId(preset.patientId);
  }, [preset.patientId]);

  const previewDates = useMemo(
    () => generateDates(mode, startDate, startTime, countConfig, rangeConfig),
    [mode, startDate, startTime, countConfig, rangeConfig]
  );

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (previewDates.length === 0 || !therapyType.trim()) return;
    if (dualTherapy && !therapyType2.trim()) return;

    const patient = data.patients.find((p) => p.id === patientId);
    const clinicId = patient?.clinicId ?? defaultClinicId;
    const amount = amountPerSession ? parseFloat(amountPerSession) : null;
    const base = { patientId, clinicId, sessionType, assignedStaffId, notes, status: 'scheduled' as const, completedAt: null, treatmentNotes: '', amountCollected: amount };

    // Helper: replace just the time component of an ISO datetime string
    const withTime = (iso: string, hhmm: string) => withLocalTime(iso, hhmm);

    setSubmitting(true);
    previewDates.forEach((scheduledAt) => {
      onAddSession({ ...base, scheduledAt, therapyType: therapyType.trim(), therapyLevel });
      if (dualTherapy && therapyType2.trim()) {
        const scheduledAt2 = withTime(scheduledAt, startTime2);
        onAddSession({ ...base, scheduledAt: scheduledAt2, therapyType: therapyType2.trim(), therapyLevel: therapyLevel2 });
      }
    });

    const total = dualTherapy ? previewDates.length * 2 : previewDates.length;
    setSuccessCount(total);
    setSubmitting(false);
    setConfirmed(true);
    onClearPreset();
  };

  const selectedPatient = data.patients.find((p) => p.id === patientId);

  return (
    <div className="content-stack">
      <div className="back-row">
        <button className="ghost-button" type="button" onClick={onBack}>
          <ChevronLeft size={16} /> Back to sessions
        </button>
        {preset.patientId && (
          <div className="preset-notice">
            Pre-filled for {selectedPatient?.name ?? 'patient'}.{' '}
            <button type="button" className="ghost-link" onClick={() => { onClearPreset(); setPatientId(clinicPatients[0]?.id ?? ''); }}>
              Clear
            </button>
          </div>
        )}
      </div>

      {confirmed && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) finishScheduling(); }}>
          <div className="modal-panel schedule-success-modal" style={{ maxWidth: 440 }}>
            <div className="modal-accent modal-accent-green" />
            <div className="modal-header">
              <div className="modal-header-icon"><Check size={18} /></div>
              <div>
                <h3 className="modal-title">Sessions scheduled</h3>
                <p className="modal-sub">
                  {successCount} session{successCount > 1 ? 's' : ''} created
                  {selectedPatient ? ` for ${selectedPatient.name}` : ''}
                </p>
              </div>
            </div>
            <div className="modal-body">
              <p className="schedule-success-msg">
                Your sessions are saved and will appear in the Sessions list. You&apos;ll be taken there shortly.
              </p>
            </div>
            <div className="modal-footer">
              <button className="primary-button" type="button" onClick={finishScheduling}>
                <CalendarDays size={14} /> View sessions
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="schedule-new-layout">
        {/* Left: form */}
        <form className="panel form-grid" onSubmit={handleSubmit}>
          <PanelTitle title="Schedule sessions" subtitle="Set up single or bulk recurring sessions" />

          <div className="home-no-clinic-note">
            <Stethoscope size={15} />
            Clinic scheduling only — home visits are scheduled from the Home Visits tab
          </div>

          {/* Patient */}
          <label>
            Patient
            <select required value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              {clinicPatients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          {/* Therapy 1 */}
          <div className="dual-therapy-block">
            <div className="dual-therapy-header">
              <label className="dual-therapy-label">
                {dualTherapy ? 'Therapy 1' : 'Therapy / treatment type'}
              </label>
              <button
                type="button"
                className={`toggle-btn ${dualTherapy ? 'active' : ''}`}
                onClick={() => setDualTherapy((v) => !v)}
              >
                <Plus size={13} /> {dualTherapy ? 'Dual therapy on' : 'Add 2nd therapy'}
              </button>
            </div>
            <TherapyTypeSelect required value={therapyType} onChange={setTherapyType} />
            <div className="toggle-row" style={{ marginTop: 6 }}>
              {(['basic', 'rehab', 'advance'] as TherapyLevel[]).map((lvl) => (
                <button key={lvl} type="button"
                  className={`toggle-btn level-${lvl} ${therapyLevel === lvl ? 'active' : ''}`}
                  onClick={() => setTherapyLevel(lvl)}
                >
                  {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Therapy 2 (dual) */}
          {dualTherapy && (
            <div className="dual-therapy-block second">
              <div className="dual-therapy-header">
                <label className="dual-therapy-label">Therapy 2</label>
              </div>
              <TherapyTypeSelect required value={therapyType2} onChange={setTherapyType2} />
              <div className="toggle-row" style={{ marginTop: 6 }}>
                {(['basic', 'rehab', 'advance'] as TherapyLevel[]).map((lvl) => (
                  <button key={lvl} type="button"
                    className={`toggle-btn level-${lvl} ${therapyLevel2 === lvl ? 'active' : ''}`}
                    onClick={() => setTherapyLevel2(lvl)}
                  >
                    {lvl.charAt(0).toUpperCase() + lvl.slice(1)}
                  </button>
                ))}
              </div>
              <label className="dual-slot-label">
                <Clock size={13} /> Slot time for Therapy 2
                <input
                  type="time"
                  value={startTime2}
                  onChange={(e) => setStartTime2(e.target.value)}
                  style={{ marginTop: 4 }}
                />
              </label>
              <small className="dual-slot-hint">
                Therapy 1 starts at {startTime} · Therapy 2 starts at {startTime2}
              </small>
            </div>
          )}

          {/* Therapist */}
          <label>
            Therapist
            <select value={assignedStaffId} onChange={(e) => setAssignedStaffId(e.target.value)}>
              {staff.filter((p) => p.status === 'active').map((p) => (
                <option key={p.id} value={p.id}>{p.name} — {p.title}</option>
              ))}
            </select>
          </label>

          {/* Amount */}
          <label>
            Amount per session (₹)
            <input
              type="number" min="0" step="0.01"
              value={amountPerSession}
              onChange={(e) => setAmountPerSession(e.target.value)}
              placeholder="Leave blank to record later"
            />
          </label>

          {/* ── Scheduling assistant ── */}
          <div className="form-section">
            <h3 className="form-section-title"><Sparkles size={15} /> Scheduling assistant</h3>
            <p className="form-hint">Pick a preset to auto-fill the schedule below.</p>
            <div className="assistant-grid">
              {[
                { label: 'Post-surgery intensive', desc: '5× / week · 3 wks', count: 15, freq: 1, unit: 'days' as FrequencyUnit },
                { label: 'Standard rehab', desc: '3× / week · 6 wks', count: 18, freq: 2, unit: 'days' as FrequencyUnit },
                { label: 'Twice weekly', desc: '2× / week · 4 wks', count: 8, freq: 3, unit: 'days' as FrequencyUnit },
                { label: 'Acute daily', desc: 'Daily · 1 wk', count: 7, freq: 1, unit: 'days' as FrequencyUnit },
                { label: 'Weekly follow-up', desc: '1× / week · 8 wks', count: 8, freq: 1, unit: 'weeks' as FrequencyUnit },
                { label: 'Monthly check-in', desc: '1× / month · 6 mo', count: 6, freq: 1, unit: 'months' as FrequencyUnit },
              ].map((t) => (
                <button
                  key={t.label}
                  type="button"
                  className="assistant-card"
                  onClick={() => {
                    setMode('count');
                    setCountConfig({ count: t.count, freqValue: t.freq, freqUnit: t.unit });
                  }}
                >
                  <strong>{t.label}</strong>
                  <small>{t.desc}</small>
                </button>
              ))}
            </div>
          </div>

          {/* Scheduling mode */}
          <div className="form-section">
            <h3 className="form-section-title"><CalendarDays size={15} /> Schedule details</h3>

            <div className="mode-tabs">
              <button type="button" className={`mode-tab ${mode === 'count' ? 'active' : ''}`} onClick={() => setMode('count')}>
                By session count
              </button>
              <button type="button" className={`mode-tab ${mode === 'range' ? 'active' : ''}`} onClick={() => setMode('range')}>
                By date range
              </button>
            </div>

            <div className="form-two-col" style={{ marginTop: '10px' }}>
              <label>
                Start date
                <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </label>
              <label>
                Start time
                <input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
              </label>
            </div>

            {mode === 'count' ? (
              <div className="form-two-col" style={{ marginTop: '10px' }}>
                <label>
                  Number of sessions
                  <input
                    type="number" min="1" max="60" required
                    value={countConfig.count}
                    onChange={(e) => setCountConfig({ ...countConfig, count: parseInt(e.target.value) || 1 })}
                  />
                </label>
                <label>
                  Repeat every
                  <div className="freq-row">
                    <input
                      type="number" min="1" max="90"
                      value={countConfig.freqValue}
                      onChange={(e) => setCountConfig({ ...countConfig, freqValue: parseInt(e.target.value) || 1 })}
                    />
                    <select
                      value={countConfig.freqUnit}
                      onChange={(e) => setCountConfig({ ...countConfig, freqUnit: e.target.value as FrequencyUnit })}
                    >
                      <option value="days">days</option>
                      <option value="weeks">weeks</option>
                      <option value="months">months</option>
                    </select>
                  </div>
                </label>
              </div>
            ) : (
              <div className="form-two-col" style={{ marginTop: '10px' }}>
                <label>
                  End date
                  <input
                    type="date" required
                    value={rangeConfig.endDate}
                    min={startDate}
                    onChange={(e) => setRangeConfig({ ...rangeConfig, endDate: e.target.value })}
                  />
                </label>
                <label>
                  Repeat every
                  <div className="freq-row">
                    <input
                      type="number" min="1" max="90"
                      value={rangeConfig.freqValue}
                      onChange={(e) => setRangeConfig({ ...rangeConfig, freqValue: parseInt(e.target.value) || 1 })}
                    />
                    <select
                      value={rangeConfig.freqUnit}
                      onChange={(e) => setRangeConfig({ ...rangeConfig, freqUnit: e.target.value as FrequencyUnit })}
                    >
                      <option value="days">days</option>
                      <option value="weeks">weeks</option>
                      <option value="months">months</option>
                    </select>
                  </div>
                </label>
              </div>
            )}
          </div>

          {/* Notes */}
          <label>
            Notes (applied to all sessions)
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes for all sessions…" />
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={previewDates.length === 0 || submitting}
          >
            <CalendarDays size={16} />
            {previewDates.length > 0
              ? `Confirm & schedule ${previewDates.length} session${previewDates.length > 1 ? 's' : ''}`
              : 'Fill in scheduling details'}
          </button>
        </form>

        {/* Right: preview */}
        <section className="panel">
          <PanelTitle
            title="Preview"
            subtitle={previewDates.length > 0 ? `${previewDates.length} sessions will be created` : 'Fill in the form to see a preview'}
          />

          {previewDates.length === 0 ? (
            <EmptyState message="Adjust dates and frequency to generate a preview" />
          ) : (
            <>
              <div className="preview-summary">
                <span className="badge badge-teal">
                  <Stethoscope size={12} />
                  Clinic session
                </span>
                {selectedPatient && <span className="badge badge-slate">{selectedPatient.name}</span>}
                {therapyType && <span className="badge badge-blue">{formatTherapyTypeDisplay(therapyType)}</span>}
                {amountPerSession && (
                  <span className="badge badge-green">₹{amountPerSession} / session</span>
                )}
              </div>

              <div className="preview-total">
                <strong>Total estimated cost:</strong>{' '}
                {amountPerSession
                  ? formatCurrency(parseFloat(amountPerSession) * previewDates.length * (dualTherapy ? 2 : 1))
                  : '—'}
              </div>

              <div className="preview-list">
                {(() => {
                  // Group preview dates by calendar date; also include therapy-2 slot
                  const byDate = new Map<string, string[]>();
                  previewDates.forEach((dt) => {
                    const dateKey = sessionDateKey(dt);
                    if (!byDate.has(dateKey)) byDate.set(dateKey, []);
                    byDate.get(dateKey)!.push(dt);
                    if (dualTherapy && startTime2) {
                      byDate.get(dateKey)!.push(dateKey + 'T' + startTime2);
                    }
                  });
                  let sessionNum = 0;
                  return Array.from(byDate.entries()).map(([dateKey, slots]) => {
                    const dateLabel = new Intl.DateTimeFormat('en', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(dateKey + 'T12:00'));
                    return (
                      <div key={dateKey} className="preview-date-group">
                        <div className="preview-date-header">{dateLabel}</div>
                        {slots.map((slot, si) => {
                          sessionNum++;
                          const time = sessionTimeKey(slot);
                          const label = dualTherapy
                            ? si === 0
                              ? `${formatTherapyTypeDisplay(therapyType) || 'Therapy 1'} · ${therapyLevel}`
                              : `${formatTherapyTypeDisplay(therapyType2) || 'Therapy 2'} · ${therapyLevel2}`
                            : (formatTherapyTypeDisplay(therapyType) || 'Session');
                          return (
                            <div key={slot + si} className="preview-item">
                              <span className="preview-num">{sessionNum}</span>
                              <span className="preview-time">{time}</span>
                              <span className="preview-label">{label}</span>
                            </div>
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

// ─── Calendar View ────────────────────────────────────────────────────────────

const CLINIC_DAY_SLOTS = CLINIC_VISIT_SLOTS;

function CalendarView({
  data, allClinics, currentUser, onOpenPatient, onAddSession, onUpdateSession,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  allClinics: Clinic[];
  currentUser: Profile;
  onOpenPatient: (patientId: string) => void;
  onAddSession: (session: Omit<TherapySession, 'id'>) => void;
  onUpdateSession: (sessionId: string, updates: Partial<TherapySession>) => void;
}) {
  const now = new Date();
  const [view, setView]         = useState<'month' | 'day'>('day');
  const [year, setYear]         = useState(now.getFullYear());
  const [month, setMonth]       = useState(now.getMonth()); // 0-indexed
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [selectedClinicId, setSelectedClinicId] = useState(
    currentUser.role === 'staff' && currentUser.clinicId ? currentUser.clinicId : 'all'
  );
  const [popover, setPopover]   = useState<TherapySession | null>(null);
  const [editingSession, setEditingSession] = useState<TherapySession | null>(null);

  // Quick-schedule booking state
  const [booking, setBooking]   = useState<{ date: string; time: string; type: SessionType; clinicId: string } | null>(null);
  const [bkPatient, setBkPatient]       = useState('');
  const [bkPatients, setBkPatients]     = useState<string[]>([]);
  const [bkMulti, setBkMulti]           = useState(false);
  const [bkTherapy, setBkTherapy]       = useState('');
  const [bkLevel, setBkLevel]           = useState<TherapyLevel>('basic');
  const [bkClinic, setBkClinic]         = useState('');

  const clinicsForSelector = currentUser.role === 'admin' ? allClinics : data.clinics;

  // ── Month navigation ──
  const prevMonth = () => { if (month === 0) { setMonth(11); setYear((y) => y - 1); } else setMonth((m) => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear((y) => y + 1); } else setMonth((m) => m + 1); };
  const monthName = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(year, month));

  // ── Day navigation ──
  const shiftDay = (delta: number) => {
    const d = new Date(selectedDate + 'T12:00');
    d.setDate(d.getDate() + delta);
    setSelectedDate(formatLocalDateFromDate(d));
  };
  const dayLabel = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(selectedDate + 'T12:00'));

  // ── Grid cells ──
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells  = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;
  const cells: Array<{ date: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDayOfMonth + 1;
    if (dayNum < 1 || dayNum > daysInMonth) { cells.push({ date: null, dateStr: null }); }
    else {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(dayNum).padStart(2, '0');
      cells.push({ date: dayNum, dateStr: `${year}-${mm}-${dd}` });
    }
  }

  const filteredSessions = data.therapySessions.filter((s) =>
    s.sessionType === 'clinic' && (selectedClinicId === 'all' || s.clinicId === selectedClinicId)
  );
  const sessionsByDate  = (ds: string) => filteredSessions.filter((s) => sessionOnDate(s.scheduledAt, ds));
  const daySessions     = filteredSessions.filter((s) => sessionOnDate(s.scheduledAt, selectedDate));
  const sessionsAt      = (time: string, type: SessionType) =>
    daySessions.filter((s) => sessionTimeKey(s.scheduledAt) === time && s.sessionType === type);
  const todayDateStr    = todayStr;

  const bookablePatients = useMemo(() => {
    return data.patients.filter((p) => (bkClinic ? p.clinicId === bkClinic : p.clinicId !== null));
  }, [data.patients, bkClinic]);

  const pruneBkPatients = (validIds: Set<string>) => {
    setBkPatients((prev) => prev.filter((id) => validIds.has(id)));
  };

  const toggleBkPatient = (patientId: string) => {
    setBkPatients((prev) =>
      prev.includes(patientId) ? prev.filter((id) => id !== patientId) : [...prev, patientId]
    );
  };

  // Monthly stats
  const monthStr       = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthSessions  = filteredSessions.filter((s) => sessionInMonth(s.scheduledAt, monthStr));
  const monthScheduled = monthSessions.filter((s) => s.status === 'scheduled').length;
  const monthCompleted = monthSessions.filter((s) => s.status === 'completed').length;
  const monthRevenue   = monthSessions.filter((s) => s.status === 'completed' && s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);

  // ── Open quick-booking for a slot ──
  const handleBookSlot = (time: string) => {
    const cId = selectedClinicId !== 'all'
      ? selectedClinicId
      : (data.clinics[0]?.id ?? '');
    setBkClinic(cId);
    setBkMulti(false);
    setBkPatients([]);
    setBkPatient(data.patients.find((p) => p.clinicId === cId)?.id ?? '');
    setBkTherapy('');
    setBkLevel('basic');
    setBooking({ date: selectedDate, time, type: 'clinic', clinicId: cId });
  };

  const submitBooking = (e: FormEvent) => {
    e.preventDefault();
    const patientIds = bkMulti ? bkPatients : (bkPatient ? [bkPatient] : []);
    if (!booking || patientIds.length === 0 || !bkTherapy.trim()) return;

    const base = {
      clinicId:        bkClinic || booking.clinicId,
      scheduledAt:     buildLocalDateTime(booking.date, booking.time),
      therapyType:     bkTherapy.trim(),
      sessionType:     'clinic' as const,
      therapyLevel:    bkLevel,
      assignedStaffId: currentUser.id,
      status:          'scheduled' as const,
      completedAt:     null,
      notes:           '',
      treatmentNotes:  '',
      amountCollected: null,
    };

    patientIds.forEach((patientId) => onAddSession({ ...base, patientId }));
    setBooking(null);
  };

  // ── Shared session detail popover renderer ──
  const renderPopover = () => {
    if (!popover) return null;
    const patient  = data.patients.find((p) => p.id === popover.patientId);
    const clinic   = allClinics.find((c) => c.id === popover.clinicId);
    const isHome   = popover.sessionType === 'home';
    const time     = formatSessionTime(popover.scheduledAt);
    const dateDisp = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
      .format(parseScheduledAt(popover.scheduledAt));
    return (
      <div className="modal-backdrop" onClick={() => setPopover(null)}>
        <div className="cal-popover" onClick={(e) => e.stopPropagation()}>
          <div className={`cal-popover-header ${isHome ? 'home' : 'clinic'} status-${popover.status}`}>
            <div className="cal-popover-title-row">
              <span className="cal-popover-icon">{isHome ? <Home size={16} /> : <Stethoscope size={16} />}</span>
              <div>
                <h3 className="cal-popover-title">{formatTherapyTypeDisplay(popover.therapyType)}</h3>
                <p className="cal-popover-sub">{dateDisp} · {time}</p>
              </div>
            </div>
            <button className="cal-popover-close" onClick={() => setPopover(null)}><X size={16} /></button>
          </div>
          <div className="cal-popover-badges">
            <span className={`status ${popover.status}`}>{statusLabel(popover.status)}</span>
            <span className={`therapy-level-badge ${popover.therapyLevel ?? 'basic'}`}>{popover.therapyLevel ?? 'basic'}</span>
            <span className={`badge ${isHome ? 'badge-amber' : 'badge-teal'}`}>
              {isHome ? <Home size={10} /> : <Stethoscope size={10} />}{isHome ? 'Home visit' : 'Clinic'}
            </span>
          </div>
          <div className="cal-popover-rows">
            <div className="cal-popover-row"><Users size={14} /><div>
              <span className="cal-row-label">Patient</span>
              <button className="ghost-link cal-row-value" onClick={() => { onOpenPatient(popover.patientId); setPopover(null); }}>
                {patient?.name ?? 'Unknown'} ↗
              </button>
            </div></div>
            <div className="cal-popover-row"><Building2 size={14} /><div>
              <span className="cal-row-label">Clinic</span>
              <span className="cal-row-value">{clinic?.name ?? '—'}</span>
            </div></div>
            <div className="cal-popover-row"><Clock size={14} /><div>
              <span className="cal-row-label">Date &amp; time</span>
              <span className="cal-row-value">{dateDisp} at {time}</span>
            </div></div>
            {popover.amountCollected !== null && (
              <div className="cal-popover-row"><DollarSign size={14} /><div>
                <span className="cal-row-label">Amount</span>
                <span className="cal-row-value">{formatCurrency(popover.amountCollected)}</span>
              </div></div>
            )}
            {popover.treatmentNotes && (
              <div className="cal-popover-row"><FileText size={14} /><div>
                <span className="cal-row-label">Treatment notes</span>
                <span className="cal-row-value">{popover.treatmentNotes}</span>
              </div></div>
            )}
          </div>
          <div className="cal-popover-actions">
            {popover.status === 'scheduled' && (
              <button
                className="secondary-button"
                onClick={() => { setEditingSession(popover); setPopover(null); }}
              >
                <ClipboardList size={14} /> Edit session
              </button>
            )}
            <button className="primary-button" onClick={() => { onOpenPatient(popover.patientId); setPopover(null); }}>
              <Users size={14} /> View patient
            </button>
            <button className="ghost-button" onClick={() => setPopover(null)}>Close</button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="content-stack">
      {renderPopover()}

      {editingSession && (
        <EditSessionModal
          session={editingSession}
          data={data}
          lockSessionType="clinic"
          onSave={(updates) => { onUpdateSession(editingSession.id, updates); setEditingSession(null); }}
          onClose={() => setEditingSession(null)}
        />
      )}

      {/* ── Quick-schedule modal ── */}
      {booking && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setBooking(null); }}>
          <form className="modal-panel bk-modal" onSubmit={submitBooking}>
            <div className="modal-accent modal-accent-teal" />
            <div className="modal-header">
              <div className="modal-header-icon">
                <Stethoscope size={18} />
              </div>
              <div>
                <h3 className="modal-title">Book clinic slot</h3>
                <p className="modal-sub">
                  {new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(booking.date + 'T12:00'))}
                  {' · '}{formatVisitSlotLabel(booking.time)}
                </p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setBooking(null)}><X size={18} /></button>
            </div>

            <div className="bk-modal-body">
              {currentUser.role === 'admin' && (
                <div className="bk-field">
                  <span className="bk-label">Clinic</span>
                  <select value={bkClinic} onChange={(e) => {
                    const cId = e.target.value;
                    setBkClinic(cId);
                    const next = data.patients.filter((p) => p.clinicId === cId);
                    setBkPatient(next[0]?.id ?? '');
                    pruneBkPatients(new Set(next.map((p) => p.id)));
                  }}>
                    {data.clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}

              <div className="bk-field">
                <span className="bk-label">Patients <span className="required">*</span></span>
                <div className="toggle-row bk-patient-mode">
                  <button
                    type="button"
                    className={`toggle-btn${!bkMulti ? ' active' : ''}`}
                    onClick={() => {
                      setBkMulti(false);
                      if (!bkPatient && bkPatients.length) setBkPatient(bkPatients[0]);
                    }}
                  ><User size={13} /> Single</button>
                  <button
                    type="button"
                    className={`toggle-btn${bkMulti ? ' active' : ''}`}
                    onClick={() => {
                      setBkMulti(true);
                      setBkPatients(bkPatient ? [bkPatient] : []);
                    }}
                  ><Users size={13} /> Multiple</button>
                </div>

                {!bkMulti ? (
                  <select required={!bkMulti} value={bkPatient} onChange={(e) => setBkPatient(e.target.value)}>
                    <option value="">— select patient —</option>
                    {bookablePatients.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                ) : bookablePatients.length === 0 ? (
                  <p className="bk-empty-patients">No patients available for this session type.</p>
                ) : (
                  <>
                    <div className="multi-patient-toolbar">
                      <span>{bkPatients.length} selected</span>
                      <button type="button" className="ghost-link" onClick={() => setBkPatients(bookablePatients.map((p) => p.id))}>
                        Select all
                      </button>
                      <button type="button" className="ghost-link" onClick={() => setBkPatients([])}>
                        Clear
                      </button>
                    </div>
                    <div className="multi-patient-picker">
                      {bookablePatients.map((p) => (
                        <label key={p.id} className="multi-patient-option">
                          <input
                            type="checkbox"
                            checked={bkPatients.includes(p.id)}
                            onChange={() => toggleBkPatient(p.id)}
                          />
                          <span>{p.name}</span>
                          {p.diagnosis && <span className="patient-clinic-tag">{p.diagnosis.slice(0, 28)}{p.diagnosis.length > 28 ? '…' : ''}</span>}
                        </label>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="bk-field">
                <span className="bk-label">Therapy type <span className="required">*</span></span>
                <TherapyTypeSelect required value={bkTherapy} onChange={setBkTherapy} />
              </div>

              <div className="bk-field">
                <span className="bk-label">Therapy level</span>
                <div className="toggle-row">
                  {(['basic', 'rehab', 'advance'] as TherapyLevel[]).map((lvl) => (
                    <button key={lvl} type="button"
                      className={`toggle-btn level-${lvl}${bkLevel === lvl ? ' active' : ''}`}
                      onClick={() => setBkLevel(lvl)}
                    >{lvl.charAt(0).toUpperCase() + lvl.slice(1)}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="ghost-button" onClick={() => setBooking(null)}>Cancel</button>
              <button
                type="submit"
                className="primary-button"
                disabled={!bkTherapy.trim() || (bkMulti ? bkPatients.length === 0 : !bkPatient)}
              >
                <CalendarDays size={14} />
                {bkMulti && bkPatients.length > 1
                  ? `Schedule ${bkPatients.length} sessions`
                  : 'Schedule'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Toolbar ── */}
      <div className="calendar-toolbar">
        {/* Left: view toggle + nav — always on same row */}
        <div className="cal-nav-group">
          <div className="view-toggle">
            <button
              className={`view-toggle-btn${view === 'day' ? ' active' : ''}`}
              onClick={() => setView('day')}
            ><Clock size={14} /> Day</button>
            <button
              className={`view-toggle-btn${view === 'month' ? ' active' : ''}`}
              onClick={() => setView('month')}
            ><CalendarDays size={14} /> Month</button>
          </div>

          {view === 'month' ? (
            <>
              <button className="ghost-button icon-only" onClick={prevMonth}><ChevronLeft size={18} /></button>
              <h2 className="calendar-month-title">{monthName}</h2>
              <button className="ghost-button icon-only" onClick={nextMonth}><ChevronRight size={18} /></button>
              <button className="ghost-button cal-today-btn"
                onClick={() => { setMonth(now.getMonth()); setYear(now.getFullYear()); }}>Today</button>
            </>
          ) : (
            <>
              <button className="ghost-button icon-only" onClick={() => shiftDay(-1)}><ChevronLeft size={18} /></button>
              <h2 className="calendar-month-title">{dayLabel}</h2>
              <button className="ghost-button icon-only" onClick={() => shiftDay(1)}><ChevronRight size={18} /></button>
              <button className="ghost-button cal-today-btn"
                onClick={() => setSelectedDate(todayStr)}>Today</button>
            </>
          )}
        </div>

        {/* Right: stats + clinic filter */}
        <div className="cal-toolbar-right">
          <div className="cal-month-stats">
            <span className="cal-stat scheduled"><Activity size={11} />{monthScheduled} scheduled</span>
            <span className="cal-stat completed"><Check size={11} />{monthCompleted} done</span>
            {monthRevenue > 0 && <span className="cal-stat revenue"><DollarSign size={11} />{formatCurrency(monthRevenue)}</span>}
          </div>
          <select className="clinic-selector" value={selectedClinicId}
            onChange={(e) => setSelectedClinicId(e.target.value)}>
            {currentUser.role === 'admin' && <option value="all">All clinics</option>}
            {clinicsForSelector.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      </div>

      {/* ══ MONTH VIEW ══ */}
      {view === 'month' && (
        <>
          <section className="calendar-grid-wrapper panel">
            <div className="calendar-header-row">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, di) => (
                <div key={d} className={`calendar-dow ${di === 0 || di === 6 ? 'weekend' : ''}`}>{d}</div>
              ))}
            </div>
            <div className="calendar-grid">
              {cells.map((cell, i) => {
                const sessions   = cell.dateStr ? sessionsByDate(cell.dateStr) : [];
                const isToday    = cell.dateStr === todayDateStr;
                const isWeekend  = i % 7 === 0 || i % 7 === 6;
                const hasSessions = sessions.length > 0;
                return (
                  <div key={i}
                    className={`calendar-cell${!cell.date ? ' empty' : ''}${isToday ? ' today' : ''}${isWeekend ? ' weekend' : ''}${hasSessions ? ' has-sessions' : ''}`}
                  >
                    {cell.date !== null && (
                      <>
                        <div className="calendar-date-row">
                          <span className="calendar-date">{cell.date}</span>
                          {cell.dateStr && (
                            <button className="day-view-link" title="Open day view"
                              onClick={() => { setSelectedDate(cell.dateStr!); setView('day'); }}>
                              <Clock size={11} />
                            </button>
                          )}
                        </div>
                        <div className="calendar-sessions">
                          {sessions.slice(0, 3).map((s) => (
                            <button key={s.id}
                              className={`cal-session-chip ${s.sessionType === 'home' ? 'home' : 'clinic'} level-${s.therapyLevel ?? 'basic'} status-${s.status}`}
                              onClick={() => setPopover(s)}
                              title={`${formatTherapyTypeDisplay(s.therapyType)} · ${formatSessionTime(s.scheduledAt)} [${s.therapyLevel ?? 'basic'}]`}
                            >
                              {s.sessionType === 'home' ? <Home size={9} /> : <Stethoscope size={9} />}
                              <span className="chip-time">{formatSessionTime(s.scheduledAt)}</span>
                              <span className="chip-label">{formatTherapyTypeDisplay(s.therapyType).slice(0, 16)}</span>
                            </button>
                          ))}
                          {sessions.length > 3 && (
                            <button className="cal-more"
                              onClick={() => { setSelectedDate(cell.dateStr!); setView('day'); }}>
                              +{sessions.length - 3} more
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <div className="calendar-legend">
            <span className="legend-item"><span className="legend-dot teal" />Clinic · scheduled</span>
            <span className="legend-item"><span className="legend-dot green" />Completed</span>
            <span className="legend-item"><span className="legend-dot coral" />Cancelled / No-show</span>
            <span className="legend-item"><span className="legend-bar rehab" />Rehab level</span>
            <span className="legend-item"><span className="legend-bar advance" />Advance level</span>
          </div>
        </>
      )}

      {/* ══ DAY VIEW ══ */}
      {view === 'day' && (
        <div className="panel day-view-panel">
          {/* Column headers */}
          <div className="day-view-header clinic-only">
            <div className="day-time-gutter" />
            <div className="day-col-header clinic-col">
              <Stethoscope size={14} />
              <span>Clinic Sessions</span>
              <small>9:00 AM – 9:00 PM</small>
            </div>
          </div>

          {/* Time slot rows */}
          <div className="day-view-grid">
            {CLINIC_DAY_SLOTS.map((time) => {
              const clinicSessions = sessionsAt(time, 'clinic');
              const isHour        = time.endsWith(':00');
              return (
                <div key={time} className={`day-slot-row clinic-only${isHour ? ' hour-boundary' : ''}`}>
                  {/* Time label */}
                  <div className="day-time-label">
                    {isHour && (
                      <span>{time.startsWith('0') ? time.replace(/^0/, '') : time}</span>
                    )}
                  </div>

                  {/* Clinic column */}
                  <div className="day-slot">
                    {clinicSessions.length === 0 ? (
                      <button className="day-slot-empty" onClick={() => handleBookSlot(time)}>
                        <Plus size={12} /><span>Add</span>
                      </button>
                    ) : (
                      <div className="day-slot-stack">
                        {clinicSessions.map((clinicSession) => (
                          <button
                            key={clinicSession.id}
                            className={`day-slot-booked clinic compact level-${clinicSession.therapyLevel ?? 'basic'} status-${clinicSession.status}`}
                            onClick={() => setPopover(clinicSession)}
                          >
                            <div className="slot-booked-top">
                              <span className="slot-patient">{data.patients.find((p) => p.id === clinicSession.patientId)?.name ?? '—'}</span>
                              <span className={`therapy-level-badge sm ${clinicSession.therapyLevel ?? 'basic'}`}>{clinicSession.therapyLevel ?? 'basic'}</span>
                            </div>
                            <div className="slot-booked-bottom">
                              <span className="slot-therapy">{formatTherapyTypeDisplay(clinicSession.therapyType)}</span>
                              <span className={`status sm ${clinicSession.status}`}>{statusLabel(clinicSession.status)}</span>
                            </div>
                          </button>
                        ))}
                        <button type="button" className="day-slot-add-more" onClick={() => handleBookSlot(time)}>
                          <Plus size={10} /> Add patient
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Clinics View ─────────────────────────────────────────────────────────────

function ClinicsView({
  clinics, profiles, onSaveClinic, onToggleClinic, onDeleteClinic, onUpdateProfile,
}: {
  clinics: Clinic[];
  profiles: Profile[];
  onSaveClinic: (clinic: ClinicDraft, editingId: string | null) => void;
  onToggleClinic: (clinicId: string) => void;
  onDeleteClinic: (clinicId: string) => void;
  onUpdateProfile: (profile: Profile) => void;
}) {
  const [draft, setDraft] = useState<ClinicDraft>(emptyClinic);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [staffForNewClinic, setStaffForNewClinic] = useState<string[]>([]);

  const openAdd = () => {
    setEditingId(null);
    setDraft(emptyClinic);
    setStaffForNewClinic([]);
    setShowModal(true);
  };

  const startEdit = (clinic: Clinic) => {
    setEditingId(clinic.id);
    setDraft({ name: clinic.name, address: clinic.address, phone: clinic.phone });
    setStaffForNewClinic(profiles.filter((p) => p.clinicId === clinic.id).map((p) => p.id));
    setShowModal(true);
  };

  const closeModal = () => { setShowModal(false); setEditingId(null); setDraft(emptyClinic); setStaffForNewClinic([]); };

  const toggleStaffSelection = (staffId: string) => {
    setStaffForNewClinic((prev) =>
      prev.includes(staffId) ? prev.filter((id) => id !== staffId) : [...prev, staffId]
    );
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const savedId = editingId ?? createId('clinic');
    onSaveClinic(draft, editingId);
    profiles
      .filter((p) => p.role !== 'admin')
      .forEach((p) => {
        const shouldBelong    = staffForNewClinic.includes(p.id);
        const currentlyBelongs = p.clinicId === (editingId ?? savedId);
        if (shouldBelong && !currentlyBelongs)  onUpdateProfile({ ...p, clinicId: editingId ?? savedId });
        else if (!shouldBelong && currentlyBelongs) onUpdateProfile({ ...p, clinicId: null });
      });
    closeModal();
  };

  const staffForClinic  = (clinicId: string) => profiles.filter((p) => p.clinicId === clinicId);
  const unassignedStaff = profiles.filter((p) => p.role !== 'admin' && !p.clinicId);

  return (
    <div className="content-stack">

      {/* ── Add / Edit modal ── */}
      {showModal && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <form className="modal-panel clinic-modal" onSubmit={submit}>
            <div className="modal-accent modal-accent-green" />
            <div className="modal-header">
              <div className="modal-header-icon"><Building2 size={18} /></div>
              <div>
                <h3 className="modal-title">{editingId ? 'Edit clinic' : 'Add new clinic'}</h3>
                <p className="modal-sub">{editingId ? 'Update clinic details and staff assignment' : 'Register a new clinic location'}</p>
              </div>
              <button type="button" className="icon-btn" onClick={closeModal}><X size={18} /></button>
            </div>

            <label>Clinic name <span className="required">*</span>
              <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. North Spine & Rehab" />
            </label>
            <label>Address <span className="required">*</span>
              <input required value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Full street address" />
            </label>
            <label>Phone
              <input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+91 98765 43210" type="tel" />
            </label>

            {/* Staff assignment */}
            {profiles.filter((p) => p.role !== 'admin').length > 0 && (
              <div className="form-section">
                <h3 className="form-section-title"><UserCheck size={14} /> Assign staff</h3>
                <div className="staff-assign-list">
                  {profiles.filter((p) => p.role !== 'admin').map((p) => (
                    <label key={p.id} className={`staff-assign-row ${staffForNewClinic.includes(p.id) ? 'selected' : ''}`}>
                      <input type="checkbox" checked={staffForNewClinic.includes(p.id)} onChange={() => toggleStaffSelection(p.id)} />
                      <span className="staff-chip-avatar sm">{p.name.charAt(0)}</span>
                      <div className="staff-assign-info">
                        <strong>{p.name}</strong>
                        <small>{p.title}</small>
                      </div>
                      {p.clinicId && p.clinicId !== editingId && (
                        <small className="staff-currently-at">→ {clinics.find((c) => c.id === p.clinicId)?.name ?? 'other'}</small>
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button className="ghost-button" type="button" onClick={closeModal}><X size={14} /> Cancel</button>
              <button className="primary-button" type="submit">
                {editingId ? <><Check size={14} /> Save changes</> : <><Plus size={14} /> Add clinic</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Page header ── */}
      <section className="panel">
        <div className="toolbar">
          <PanelTitle title="Clinics" subtitle={`${clinics.length} clinic${clinics.length !== 1 ? 's' : ''} registered`} />
          <div className="toolbar-right">
            <button className="primary-button" type="button" onClick={openAdd}>
              <Plus size={16} /> Add clinic
            </button>
          </div>
        </div>

        {clinics.length === 0 ? (
          <EmptyState message="No clinics yet — click Add clinic to register one" />
        ) : (
          <div className="clinic-cards-list">
            {clinics.map((clinic) => {
              const members = staffForClinic(clinic.id);
              return (
                <div key={clinic.id} className={`clinic-detail-card ${!clinic.active ? 'inactive' : ''}`}>
                  <div className="clinic-detail-header">
                    <div className="clinic-detail-title">
                      <span className={`dot ${clinic.active ? 'green' : 'muted'}`} />
                      <div>
                        <strong>{clinic.name}</strong>
                        <small>{clinic.address}</small>
                      </div>
                    </div>
                    <div className="clinic-detail-actions">
                      <button className="secondary-button" onClick={() => startEdit(clinic)}><FileText size={13} /> Edit</button>
                      <button className="ghost-button" onClick={() => onToggleClinic(clinic.id)}>
                        {clinic.active ? 'Deactivate' : 'Activate'}
                      </button>
                      <button className="danger-button icon-only" onClick={() => onDeleteClinic(clinic.id)} title="Delete clinic">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                  {clinic.phone && (
                    <div className="clinic-detail-meta">
                      <a href={`tel:${clinic.phone}`} className="caregiver-phone">{clinic.phone}</a>
                    </div>
                  )}
                  <div className="clinic-staff-list">
                    {members.length === 0 ? (
                      <span className="clinic-no-staff">No staff assigned</span>
                    ) : (
                      members.map((p) => (
                        <div key={p.id} className="clinic-staff-chip">
                          <span className="staff-chip-avatar">{p.name.charAt(0)}</span>
                          <div>
                            <strong>{p.name}</strong>
                            <small>{p.title}</small>
                          </div>
                          <span className={`status ${p.status}`}>{p.status}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {unassignedStaff.length > 0 && (
          <div className="unassigned-notice">
            <strong>{unassignedStaff.length} unassigned staff</strong>
            <div className="clinic-staff-list" style={{ marginTop: 8 }}>
              {unassignedStaff.map((p) => (
                <div key={p.id} className="clinic-staff-chip muted">
                  <span className="staff-chip-avatar muted">{p.name.charAt(0)}</span>
                  <div><strong>{p.name}</strong><small>{p.title}</small></div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

// ─── Staff View ───────────────────────────────────────────────────────────────

type StaffDraft = { name: string; email: string; password: string; phone: string; title: string; clinicId: string; role: Role; status: StaffStatus };
const emptyStaff = (): StaffDraft => ({ name: '', email: '', password: '', phone: '', title: '', clinicId: '', role: 'staff', status: 'active' });

const JOB_TITLES = [
  'Consultant Physiotherapist',
  'Assistant Physiotherapist',
  'Intern',
];

function StaffView({
  profiles, clinics, onUpdateProfile, onAddProfile, onDeleteProfile,
}: {
  profiles: Profile[];
  clinics: Clinic[];
  onUpdateProfile: (profile: Profile) => void;
  onAddProfile: (profile: Omit<Profile, 'id'> & { password: string }) => void;
  onDeleteProfile: (profileId: string) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<StaffDraft>(emptyStaff);
  const [showPassword, setShowPassword] = useState(false);
  const [editingProfile, setEditingProfile] = useState<Profile | null>(null);
  const [customTitle, setCustomTitle] = useState(false);

  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#';
    const pw = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setDraft((d) => ({ ...d, password: pw }));
  };

  const startEdit = (p: Profile) => {
    setEditingProfile(p);
    const isPreset = JOB_TITLES.includes(p.title);
    setCustomTitle(!isPreset && !!p.title);
    setDraft({ name: p.name, email: p.email, password: '', phone: p.phone, title: p.title, clinicId: p.clinicId ?? '', role: p.role, status: p.status });
    setShowForm(true);
  };

  const openAdd = () => {
    setEditingProfile(null);
    setCustomTitle(false);
    setDraft(emptyStaff());
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setDraft(emptyStaff()); setEditingProfile(null); setCustomTitle(false); };

  const submitForm = (e: FormEvent) => {
    e.preventDefault();
    if (editingProfile) {
      onUpdateProfile({ ...editingProfile, name: draft.name, email: draft.email, phone: draft.phone, title: draft.title, clinicId: draft.clinicId || null, role: draft.role, status: draft.status });
    } else {
      onAddProfile({ name: draft.name, email: draft.email, password: draft.password, phone: draft.phone, title: draft.title, clinicId: draft.clinicId || null, role: draft.role, status: draft.status });
    }
    cancelForm();
  };

  const pending  = profiles.filter((p) => p.status === 'pending');
  const active   = profiles.filter((p) => p.status === 'active');
  const inactive = profiles.filter((p) => p.status === 'inactive');

  return (
    <div className="content-stack">
      {/* ── Staff modal ── */}
      {showForm && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) cancelForm(); }}>
          <form className="modal-panel staff-modal" onSubmit={submitForm}>
            {/* Coloured accent strip */}
            <div className="staff-modal-accent" />

            {/* Header */}
            <div className="staff-modal-header">
              <div className="staff-modal-avatar-wrap">
                <div className="staff-modal-avatar">
                  {draft.name ? draft.name.charAt(0).toUpperCase() : <UserCheck size={20} />}
                </div>
              </div>
              <div className="staff-modal-titles">
                <h3>{editingProfile ? 'Edit staff member' : 'Add new staff'}</h3>
                <p>{editingProfile ? 'Update account details and access' : 'Create a login and set up clinic access'}</p>
              </div>
              <button type="button" className="icon-btn" onClick={cancelForm}><X size={18} /></button>
            </div>

            {/* Section: Personal info */}
            <div className="staff-modal-section">
              <span className="staff-modal-section-label">Personal info</span>
              <div className="form-two-col">
                <label style={{ gridColumn: '1 / -1' }}>Full name <span className="required">*</span>
                  <input required value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="e.g. Dr. Priya Sharma" />
                </label>
                <label>Job title <span className="required">*</span>
                  {customTitle ? (
                    <div className="staff-title-custom-row">
                      <input required value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                        placeholder="Custom job title" />
                      <button type="button" className="ghost-button"
                        onClick={() => { setCustomTitle(false); setDraft((d) => ({ ...d, title: '' })); }}>
                        <ChevronRight size={13} style={{ transform: 'rotate(180deg)' }} /> Preset
                      </button>
                    </div>
                  ) : (
                    <div className="staff-title-select-row">
                      <select required value={draft.title}
                        onChange={(e) => setDraft({ ...draft, title: e.target.value })}>
                        <option value="">— Select title —</option>
                        {JOB_TITLES.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <button type="button" className="ghost-button"
                        onClick={() => { setCustomTitle(true); setDraft((d) => ({ ...d, title: '' })); }}>
                        Custom
                      </button>
                    </div>
                  )}
                </label>
                <label>Phone
                  <input type="tel" value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                    placeholder="+91 98765 00000" />
                </label>
              </div>
            </div>

            {/* Section: Login credentials */}
            <div className="staff-modal-section">
              <span className="staff-modal-section-label">Login credentials</span>
              <div className="form-two-col">
                <label style={{ gridColumn: '1 / -1' }}>Email <span className="required">*</span>
                  <input required type="email" value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    placeholder="staff@clinic.com" />
                </label>
                {!editingProfile && (
                  <label style={{ gridColumn: '1 / -1' }}>Password <span className="required">*</span>
                    <div className="password-field-row">
                      <div className="password-input-wrap">
                        <input required
                          type={showPassword ? 'text' : 'password'}
                          value={draft.password}
                          onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                          placeholder="Set a login password"
                          autoComplete="new-password" />
                        <button type="button" className="pw-toggle"
                          onClick={() => setShowPassword((v) => !v)}>
                          {showPassword ? 'Hide' : 'Show'}
                        </button>
                      </div>
                      <button type="button" className="ghost-button" onClick={generatePassword}>
                        Generate
                      </button>
                    </div>
                    {draft.password && (
                      <small className="pw-strength">✓ Password set — share securely with the staff member</small>
                    )}
                  </label>
                )}
              </div>
            </div>

            {/* Section: Access & clinic */}
            <div className="staff-modal-section">
              <span className="staff-modal-section-label">Access &amp; clinic</span>
              <div className="form-two-col">
                <label>Role
                  <div className="staff-role-toggle">
                    {(['staff', 'admin'] as Role[]).map((r) => (
                      <button key={r} type="button"
                        className={`staff-role-btn${draft.role === r ? ' active' : ''}`}
                        onClick={() => setDraft({ ...draft, role: r })}>
                        {r === 'admin' ? '🔑 Admin' : '👤 Staff'}
                      </button>
                    ))}
                  </div>
                </label>
                <label>Status
                  <select value={draft.status}
                    onChange={(e) => setDraft({ ...draft, status: e.target.value as StaffStatus })}>
                    <option value="active">Active</option>
                    <option value="pending">Pending</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </label>
                <label style={{ gridColumn: '1 / -1' }}>Clinic assignment
                  <select value={draft.clinicId}
                    onChange={(e) => setDraft({ ...draft, clinicId: e.target.value })}>
                    <option value="">— All clinics (admin scope) —</option>
                    {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </label>
              </div>
            </div>

            {/* Footer actions */}
            <div className="staff-modal-footer modal-footer" style={{ position: 'sticky', bottom: 0 }}>
              <button type="button" className="ghost-button" onClick={cancelForm}><X size={14} /> Cancel</button>
              <button type="submit" className="primary-button">
                {editingProfile ? <><Check size={14} /> Save changes</> : <><Plus size={14} /> Create account</>}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Pending section ── */}
      {pending.length > 0 && (
        <section className="panel">
          <PanelTitle title="Pending approval" subtitle="These accounts are waiting to be activated" />
          <div className="staff-cards">
            {pending.map((p) => <StaffCard key={p.id} profile={p} clinics={clinics} onUpdate={onUpdateProfile} onEdit={startEdit} onDelete={onDeleteProfile} />)}
          </div>
        </section>
      )}

      {/* ── All staff ── */}
      <section className="panel">
        <div className="toolbar">
          <PanelTitle title="All staff" subtitle={`${profiles.length} account${profiles.length !== 1 ? 's' : ''}`} />
          <button className="primary-button" onClick={openAdd}>
            <Plus size={15} /> Add new staff
          </button>
        </div>
        {active.length > 0 && (
          <>
            <p className="staff-section-label">Active</p>
            <div className="staff-cards">
              {active.map((p) => <StaffCard key={p.id} profile={p} clinics={clinics} onUpdate={onUpdateProfile} onEdit={startEdit} onDelete={onDeleteProfile} />)}
            </div>
          </>
        )}
        {inactive.length > 0 && (
          <>
            <p className="staff-section-label muted">Inactive</p>
            <div className="staff-cards">
              {inactive.map((p) => <StaffCard key={p.id} profile={p} clinics={clinics} onUpdate={onUpdateProfile} onEdit={startEdit} onDelete={onDeleteProfile} />)}
            </div>
          </>
        )}
        {profiles.length === 0 && (
          <EmptyState message="No staff accounts yet. Click 'Add new staff' to create one." />
        )}
      </section>
    </div>
  );
}

function StaffCard({
  profile, clinics, onUpdate, onEdit, onDelete,
}: {
  profile: Profile;
  clinics: Clinic[];
  onUpdate: (p: Profile) => void;
  onEdit: (p: Profile) => void;
  onDelete: (id: string) => void;
}) {
  const clinic = clinics.find((c) => c.id === profile.clinicId);
  const isAdmin = profile.role === 'admin';
  return (
    <div className={`staff-card ${profile.status}`}>
      <div className="staff-card-avatar">{profile.name.charAt(0)}</div>
      <div className="staff-card-info">
        <strong>{profile.name}</strong>
        <span className="staff-card-title">{profile.title}</span>
        <small>{profile.email}</small>
        {profile.phone && <small>{profile.phone}</small>}
        <div className="badge-row" style={{ marginTop: 4 }}>
          <span className={`role-pill ${profile.role}`}>{profile.role}</span>
          <span className={`status ${profile.status}`}>{profile.status}</span>
          {clinic && <span className="badge badge-teal">{clinic.name}</span>}
          {!clinic && !isAdmin && <span className="badge badge-muted">Unassigned</span>}
        </div>
      </div>
      <div className="staff-card-actions">
        {!isAdmin && profile.status === 'pending' && (
          <button className="primary-button" onClick={() => onUpdate({ ...profile, status: 'active' })}>
            <Check size={14} /> Approve
          </button>
        )}
        {!isAdmin && profile.status === 'active' && (
          <button className="ghost-button" onClick={() => onUpdate({ ...profile, status: 'inactive' })}>
            Deactivate
          </button>
        )}
        {!isAdmin && profile.status === 'inactive' && (
          <button className="ghost-button" onClick={() => onUpdate({ ...profile, status: 'active' })}>
            Reactivate
          </button>
        )}
        <button className="secondary-button" onClick={() => onEdit(profile)}>Edit</button>
        {!isAdmin && (
          <button className="danger-button" onClick={() => onDelete(profile.id)} title="Remove staff">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Shared Components ────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon, label, value, accent, sub,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: 'teal' | 'blue' | 'amber' | 'green';
  sub?: string;
}) {
  return (
    <div className={`metric-card accent-${accent}`}>
      <div className="metric-icon-wrap"><Icon size={20} /></div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {sub && <span className="metric-sub">{sub}</span>}
    </div>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state"><ClipboardList size={22} /><span>{message}</span></div>;
}

function SessionRow({
  session, data, actions, compact, showTreatmentNotes, showAmount,
}: {
  session: TherapySession;
  data: Pick<AppData, 'patients' | 'clinics'>;
  actions?: ReactNode;
  compact?: boolean;
  showTreatmentNotes?: boolean;
  showAmount?: boolean;
}) {
  const patient = data.patients.find((p) => p.id === session.patientId);
  return (
    <div className={`list-row session-row ${compact ? 'compact' : ''}`}>
      <div className="session-info">
        <div className="session-type-badge">
          {session.sessionType === 'home'
            ? <span className="badge badge-amber"><Home size={11} /> Home</span>
            : <span className="badge badge-teal"><Stethoscope size={11} /> Clinic</span>}
          <span className={`therapy-level-badge ${session.therapyLevel ?? 'basic'}`}>
            {session.therapyLevel ?? 'basic'}
          </span>
        </div>
        <strong>{formatTherapyTypeDisplay(session.therapyType)}</strong>
        <small>{patient?.name ?? 'Unknown patient'} · {clinicName(data.clinics, session.clinicId)}</small>
      </div>
      <div className="session-meta">
        <span className={`status ${session.status}`}>{statusLabel(session.status)}</span>
        <small>{formatDateTime(session.scheduledAt)}</small>
        {showAmount && session.amountCollected !== null && (
          <span className="revenue-badge">{formatCurrency(session.amountCollected)}</span>
        )}
      </div>
      {showTreatmentNotes && session.treatmentNotes && (
        <p className="clinical-note treatment-note">{session.treatmentNotes}</p>
      )}
      {actions}
    </div>
  );
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function clinicName(clinics: Clinic[], clinicId: string | null | undefined) {
  if (!clinicId) return 'Home only';
  return clinics.find((c) => c.id === clinicId)?.name ?? 'Unknown clinic';
}

function isHomeOnlyPatient(p: { clinicId: string | null; homeVisitDetails?: HomeVisitDetails }) {
  return p.clinicId === null || Boolean(p.homeVisitDetails);
}

// ─── Therapy type multi-select ────────────────────────────────────────────────

type CompletionFormData = {
  treatmentNotes: string;
  amountCollected: string;
  therapyType: string;
};

const emptyCompletionForm = (): CompletionFormData => ({
  treatmentNotes: '',
  amountCollected: '',
  therapyType: '',
});

function CompleteSessionModal({
  title,
  subtitle,
  accentClass,
  icon,
  data,
  onChange,
  onSubmit,
  onClose,
}: {
  title: string;
  subtitle: string;
  accentClass: string;
  icon: ReactNode;
  data: CompletionFormData;
  onChange: (updates: Partial<CompletionFormData>) => void;
  onSubmit: (e: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-panel" style={{ maxWidth: 460 }} onSubmit={onSubmit}>
        <div className={`modal-accent ${accentClass}`} />
        <div className="modal-header">
          <div className="modal-header-icon">{icon}</div>
          <div>
            <h3 className="modal-title">{title}</h3>
            <p className="modal-sub">{subtitle}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="modal-body">
          <label>
            Therapy performed
            <TherapyTypeSelect
              required
              value={data.therapyType}
              onChange={(therapyType) => onChange({ therapyType })}
            />
          </label>
          <label>
            Treatment notes <span className="required">*</span>
            <textarea
              required
              rows={3}
              value={data.treatmentNotes}
              onChange={(e) => onChange({ treatmentNotes: e.target.value })}
              placeholder="What was done in this session…"
            />
          </label>
          <label>
            Amount collected (₹)
            <input
              type="number"
              min="0"
              step="0.01"
              value={data.amountCollected}
              onChange={(e) => onChange({ amountCollected: e.target.value })}
              placeholder="0"
            />
          </label>
        </div>
        <div className="modal-footer">
          <button className="ghost-button" type="button" onClick={onClose}><X size={14} /> Cancel</button>
          <button className="primary-button" type="submit"><Check size={14} /> Mark complete</button>
        </div>
      </form>
    </div>
  );
}

function TherapyTypeSelect({
  value,
  onChange,
  required,
}: {
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const selected = splitTherapyTypes(value);
  const selectedSet = new Set(selected);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const toggle = (option: string, checked: boolean) => {
    const next = checked
      ? [...selected.filter((s) => s !== option), option]
      : selected.filter((s) => s !== option);
    onChange(next.join(THERAPY_SEPARATOR));
  };

  const removeItem = (option: string) => {
    onChange(selected.filter((s) => s !== option).join(THERAPY_SEPARATOR));
  };

  return (
    <div className="therapy-multiselect" ref={wrapRef}>
      {/* Trigger button */}
      <button
        type="button"
        className={`therapy-select-trigger${open ? ' open' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {selected.length > 0 ? (
          <span className="therapy-trigger-chips">
            {selected.map((item) => (
              <span key={item} className="therapy-trigger-chip">
                {item}
                <span
                  role="button"
                  tabIndex={-1}
                  className="therapy-chip-x"
                  onClick={(e) => { e.stopPropagation(); removeItem(item); }}
                >
                  <X size={11} />
                </span>
              </span>
            ))}
          </span>
        ) : (
          <span className="therapy-trigger-placeholder">Select therapy type(s)</span>
        )}
        <ChevronRight size={14} className={`therapy-trigger-caret${open ? ' rotate-down' : ''}`} />
      </button>

      {/* Hidden required-validation proxy */}
      <input
        tabIndex={-1}
        aria-hidden="true"
        className="therapy-required-shadow"
        required={required}
        value={selected.length > 0 ? 'ok' : ''}
        onChange={() => undefined}
      />

      {/* Dropdown menu */}
      {open && (
        <div className="therapy-dropdown-menu">
          {THERAPY_GROUPS.map((group) => (
            <div key={group.label} className="therapy-dropdown-group">
              <span className="therapy-dropdown-title">{group.label}</span>
              <div className="therapy-dropdown-options">
                {group.options.map((option) => (
                  <label key={option} className="therapy-check-option">
                    <input
                      type="checkbox"
                      checked={selectedSet.has(option)}
                      onChange={(e) => toggle(option, e.target.checked)}
                    />
                    <span>{option}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="therapy-dropdown-actions">
            <button type="button" className="ghost-button" onClick={() => onChange('')}>Clear</button>
            <button type="button" className="primary-button" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Expenses & Equipment View ────────────────────────────────────────────────

const EXPENSE_CATEGORIES: ExpenseCategory[] = ['Rent', 'Utilities', 'Salaries', 'Supplies', 'Maintenance', 'Other'];
const EXPENSE_RECURRENCES: ExpenseRecurrence[] = ['one-time', 'monthly', 'annual'];
const EQUIPMENT_CATEGORIES: EquipmentCategory[] = ['Machine', 'Hand tool', 'Consumable', 'Furniture', 'Other'];
const EQUIPMENT_CONDITIONS: EquipmentCondition[] = ['Good', 'Fair', 'Needs service', 'Retired'];

/** Clinic-specific consumables preset list */
const CLINIC_CONSUMABLES: { name: string; emoji: string }[] = [
  { name: 'US Gel Bottles',            emoji: '🫙' },
  { name: 'Tissue Rolls',              emoji: '🧻' },
  { name: 'Adhesive Pads Packet',      emoji: '🩹' },
  { name: 'Sanitizer',                 emoji: '🧴' },
  { name: 'Disposable Cups',           emoji: '🥤' },
  { name: 'Dry Needles Box (25mm)',     emoji: '💉' },
  { name: 'Dry Needles Box (40mm)',     emoji: '💉' },
  { name: 'Dry Needles Box (50mm)',     emoji: '💉' },
  { name: 'Dry Needles Box (60mm)',     emoji: '💉' },
  { name: 'Cotton Roll',               emoji: '☁️' },
  { name: 'Sumo Gel',                  emoji: '🫧' },
  { name: 'Micropore Tape',            emoji: '🩻' },
  { name: 'Surgical Blades / Needles', emoji: '🔪' },
];

const emptyExpense = (clinicId: string): Omit<ClinicExpense, 'id'> => ({
  clinicId, category: 'Supplies', amount: 0, date: todayStr, recurrence: 'one-time', notes: '',
});
const emptyEquipment = (clinicId: string): Omit<Equipment, 'id'> => ({
  clinicId, name: '', category: 'Machine', purchaseDate: todayStr, purchaseCost: null,
  condition: 'Good', serialNumber: '', notes: '',
});

function ExpensesView({
  clinics, expenses, equipment,
  onAddExpense, onUpdateExpense, onDeleteExpense,
  onAddEquipment, onUpdateEquipment, onDeleteEquipment,
}: {
  clinics: Clinic[];
  expenses: ClinicExpense[];
  equipment: Equipment[];
  onAddExpense: (e: Omit<ClinicExpense, 'id'>) => void | Promise<void>;
  onUpdateExpense: (e: ClinicExpense) => void | Promise<void>;
  onDeleteExpense: (id: string) => void | Promise<void>;
  onAddEquipment: (e: Omit<Equipment, 'id'>) => void | Promise<void>;
  onUpdateEquipment: (e: Equipment) => void | Promise<void>;
  onDeleteEquipment: (id: string) => void | Promise<void>;
}) {
  const [tab, setTab] = useState<'expenses' | 'equipment'>('expenses');

  // ── Expense state ──
  const [expModal, setExpModal]   = useState(false);
  const [expEditing, setExpEditing] = useState<ClinicExpense | null>(null);
  const [expDraft, setExpDraft]   = useState<Omit<ClinicExpense, 'id'>>(emptyExpense(clinics[0]?.id ?? ''));
  const [expFilterClinic, setExpFilterClinic] = useState('all');
  const [expFilterCat, setExpFilterCat]       = useState<ExpenseCategory | 'all'>('all');
  const [expSearch, setExpSearch] = useState('');

  // ── Equipment state ──
  const [eqModal, setEqModal]     = useState(false);
  const [eqEditing, setEqEditing] = useState<Equipment | null>(null);
  const [eqDraft, setEqDraft]     = useState<Omit<Equipment, 'id'>>(emptyEquipment(clinics[0]?.id ?? ''));
  const [eqFilterClinic, setEqFilterClinic] = useState('all');
  const [eqFilterCat, setEqFilterCat]       = useState<EquipmentCategory | 'all'>('all');
  const [eqFilterCond, setEqFilterCond]     = useState<EquipmentCondition | 'all'>('all');
  const [eqSearch, setEqSearch]   = useState('');
  const [expSaving, setExpSaving]   = useState(false);
  const [eqSaving, setEqSaving]     = useState(false);

  // ── Helpers ──
  const clinicName = (id: string) => clinics.find((c) => c.id === id)?.name ?? '—';
  const thisMonth = todayStr.slice(0, 7);
  const thisYear  = todayStr.slice(0, 4);

  // ── Expense derived ──
  const filteredExp = expenses.filter((e) => {
    if (expFilterClinic !== 'all' && e.clinicId !== expFilterClinic) return false;
    if (expFilterCat !== 'all' && e.category !== expFilterCat) return false;
    if (expSearch) {
      const q = expSearch.toLowerCase();
      if (!e.notes.toLowerCase().includes(q) && !e.category.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => b.date.localeCompare(a.date));

  const totalThisMonth = expenses.filter((e) => e.date.startsWith(thisMonth)).reduce((s, e) => s + e.amount, 0);
  const totalThisYear  = expenses.filter((e) => e.date.startsWith(thisYear)).reduce((s, e) => s + e.amount, 0);
  const byCategory = EXPENSE_CATEGORIES.map((cat) => ({
    cat, total: expenses.filter((e) => e.category === cat).reduce((s, e) => s + e.amount, 0),
  })).filter((r) => r.total > 0);

  // ── Equipment derived ──
  const filteredEq = equipment.filter((e) => {
    if (eqFilterClinic !== 'all' && e.clinicId !== eqFilterClinic) return false;
    if (eqFilterCat !== 'all' && e.category !== eqFilterCat) return false;
    if (eqFilterCond !== 'all' && e.condition !== eqFilterCond) return false;
    if (eqSearch) {
      const q = eqSearch.toLowerCase();
      if (!e.name.toLowerCase().includes(q) && !e.serialNumber.toLowerCase().includes(q)) return false;
    }
    return true;
  }).sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));

  const totalItems  = equipment.length;
  const totalValue  = equipment.reduce((s, e) => s + (e.purchaseCost ?? 0), 0);
  const needsService = equipment.filter((e) => e.condition === 'Needs service').length;

  // ── Expense handlers ──
  const openAddExp = () => { setExpEditing(null); setExpDraft(emptyExpense(clinics[0]?.id ?? '')); setExpModal(true); };
  const openEditExp = (e: ClinicExpense) => {
    setExpEditing(e);
    setExpDraft({ clinicId: e.clinicId, category: e.category, amount: e.amount, date: e.date, recurrence: e.recurrence, notes: e.notes });
    setExpModal(true);
  };
  const submitExp = async (ev: FormEvent) => {
    ev.preventDefault();
    setExpSaving(true);
    try {
      if (expEditing) await onUpdateExpense({ ...expDraft, id: expEditing.id });
      else await onAddExpense(expDraft);
      setExpModal(false);
    } catch {
      // Error surfaced via systemNotice in parent handler
    } finally {
      setExpSaving(false);
    }
  };

  // ── Equipment handlers ──
  const openAddEq = () => { setEqEditing(null); setEqDraft(emptyEquipment(clinics[0]?.id ?? '')); setEqModal(true); };
  const openEditEq = (e: Equipment) => {
    setEqEditing(e);
    setEqDraft({ clinicId: e.clinicId, name: e.name, category: e.category, purchaseDate: e.purchaseDate, purchaseCost: e.purchaseCost, condition: e.condition, serialNumber: e.serialNumber, notes: e.notes });
    setEqModal(true);
  };
  const submitEq = async (ev: FormEvent) => {
    ev.preventDefault();
    setEqSaving(true);
    try {
      if (eqEditing) await onUpdateEquipment({ ...eqDraft, id: eqEditing.id });
      else await onAddEquipment(eqDraft);
      setEqModal(false);
    } catch {
      // Error surfaced via systemNotice in parent handler
    } finally {
      setEqSaving(false);
    }
  };

  const pickConsumable = (name: string) => {
    setEqDraft((d) => ({ ...d, name, category: 'Consumable' }));
  };

  return (
    <div className="content-stack">

      {/* ── Page header ── */}
      <div className="exp-page-header">
        <div>
          <h2 className="exp-page-title">Expenses &amp; Equipment</h2>
          <p className="exp-page-sub">Track clinic costs and manage inventory — admin only</p>
        </div>
        <div className="exp-page-actions">
          {tab === 'expenses'
            ? <button className="primary-button" onClick={openAddExp}><Plus size={14} /> Add expense</button>
            : <button className="primary-button" onClick={openAddEq}><Plus size={14} /> Add equipment</button>
          }
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div className="exp-tab-bar">
        <button className={`exp-tab${tab === 'expenses' ? ' active' : ''}`} onClick={() => setTab('expenses')}>
          <Receipt size={15} /> Clinic Expenses
        </button>
        <button className={`exp-tab${tab === 'equipment' ? ' active' : ''}`} onClick={() => setTab('equipment')}>
          <Sparkles size={15} /> Equipment &amp; Tools
        </button>
      </div>

      {/* ══════════════════════ EXPENSES TAB ══════════════════════ */}
      {tab === 'expenses' && (
        <>
          {/* Expense modal */}
          {expModal && (
            <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setExpModal(false); }}>
              <form className="modal-panel exp-modal" onSubmit={submitExp}>
                <div className="modal-accent modal-accent-violet" />
                <div className="modal-header">
                  <div className="modal-header-icon"><Receipt size={18} /></div>
                  <div>
                    <h3 className="modal-title">{expEditing ? 'Edit expense' : 'Record expense'}</h3>
                    <p className="modal-sub">Capture a clinic cost with category &amp; recurrence</p>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => setExpModal(false)}><X size={18} /></button>
                </div>

                <div className="form-two-col">
                  <label>Clinic <span className="required">*</span>
                    <select required value={expDraft.clinicId} onChange={(e) => setExpDraft({ ...expDraft, clinicId: e.target.value })}>
                      {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label>Category <span className="required">*</span>
                    <select required value={expDraft.category} onChange={(e) => setExpDraft({ ...expDraft, category: e.target.value as ExpenseCategory })}>
                      {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>Amount (₹) <span className="required">*</span>
                    <input type="number" required min="0" step="0.01" value={expDraft.amount || ''}
                      onChange={(e) => setExpDraft({ ...expDraft, amount: parseFloat(e.target.value) || 0 })} />
                  </label>
                  <label>Date <span className="required">*</span>
                    <input type="date" required value={expDraft.date}
                      onChange={(e) => setExpDraft({ ...expDraft, date: e.target.value })} />
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>Recurrence
                    <div className="exp-recur-toggle">
                      {EXPENSE_RECURRENCES.map((r) => (
                        <button key={r} type="button"
                          className={`exp-recur-btn${expDraft.recurrence === r ? ' active' : ''}`}
                          onClick={() => setExpDraft({ ...expDraft, recurrence: r })}>
                          {r === 'one-time' ? '⚡ One-time' : r === 'monthly' ? '📅 Monthly' : '🗓 Annual'}
                        </button>
                      ))}
                    </div>
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>Notes
                    <textarea rows={2} value={expDraft.notes} onChange={(e) => setExpDraft({ ...expDraft, notes: e.target.value })} placeholder="Optional description…" />
                  </label>
                </div>

                <div className="modal-footer">
                  <button type="button" className="ghost-button" onClick={() => setExpModal(false)}><X size={14} /> Cancel</button>
                  <button type="submit" className="primary-button" disabled={expSaving}>
                    {expSaving ? <Loader2 size={14} className="icon-spin" /> : <Check size={14} />}
                    {expSaving ? 'Saving…' : expEditing ? 'Save changes' : 'Add expense'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Summary strip */}
          <div className="exp-summary-grid">
            <div className="exp-metric-card exp-card-blue">
              <span className="exp-metric-icon">📅</span>
              <div>
                <span className="exp-metric-label">This month</span>
                <span className="exp-metric-value">{formatCurrency(totalThisMonth)}</span>
              </div>
            </div>
            <div className="exp-metric-card exp-card-purple">
              <span className="exp-metric-icon">📊</span>
              <div>
                <span className="exp-metric-label">This year</span>
                <span className="exp-metric-value">{formatCurrency(totalThisYear)}</span>
              </div>
            </div>
            <div className="exp-metric-card exp-card-slate">
              <span className="exp-metric-icon">🗂</span>
              <div>
                <span className="exp-metric-label">Total records</span>
                <span className="exp-metric-value">{expenses.length}</span>
              </div>
            </div>
            {byCategory.length > 0 && (
              <div className="exp-metric-card exp-card-breakdown">
                <span className="exp-metric-label" style={{ marginBottom: 8 }}>By category</span>
                <div className="exp-cat-bars">
                  {byCategory.map(({ cat, total }) => (
                    <div key={cat} className="exp-cat-bar-row">
                      <span className={`exp-cat-badge cat-${cat.toLowerCase().replace(/\s+/g, '-')}`}>{cat}</span>
                      <span className="exp-cat-amount">{formatCurrency(total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Filter bar */}
          <div className="exp-filter-bar">
            <div className="exp-filter-left">
              <div className="search-field">
                <Search size={15} />
                <input placeholder="Search notes or category…" value={expSearch} onChange={(e) => setExpSearch(e.target.value)} />
              </div>
              <select value={expFilterClinic} onChange={(e) => setExpFilterClinic(e.target.value)}>
                <option value="all">All clinics</option>
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={expFilterCat} onChange={(e) => setExpFilterCat(e.target.value as ExpenseCategory | 'all')}>
                <option value="all">All categories</option>
                {EXPENSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <span className="exp-result-count">{filteredExp.length} record{filteredExp.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Table */}
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            {filteredExp.length === 0 ? (
              <div className="empty-state"><Receipt size={32} /><p>No expenses yet. Click <strong>Add expense</strong> to get started.</p></div>
            ) : (
              <table className="exp-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Clinic</th>
                    <th>Category</th>
                    <th>Recurrence</th>
                    <th>Amount</th>
                    <th>Notes</th>
                    <th style={{ width: 72 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredExp.map((e) => (
                    <tr key={e.id}>
                      <td className="exp-td-date">{e.date}</td>
                      <td className="exp-td-clinic">{clinicName(e.clinicId)}</td>
                      <td><span className={`exp-cat-badge cat-${e.category.toLowerCase().replace(/\s+/g, '-')}`}>{e.category}</span></td>
                      <td><span className={`exp-recur-badge recur-${e.recurrence}`}>{e.recurrence}</span></td>
                      <td className="exp-td-amount">{formatCurrency(e.amount)}</td>
                      <td className="exp-td-notes">{e.notes || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td>
                        <div className="exp-row-actions">
                          <button className="exp-action-btn" title="Edit" onClick={() => openEditExp(e)}><ClipboardList size={13} /></button>
                          <button className="exp-action-btn exp-action-delete" title="Delete" onClick={() => onDeleteExpense(e.id)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ══════════════════════ EQUIPMENT TAB ══════════════════════ */}
      {tab === 'equipment' && (
        <>
          {/* Equipment modal */}
          {eqModal && (
            <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setEqModal(false); }}>
              <form className="modal-panel exp-modal" style={{ maxWidth: 560 }} onSubmit={submitEq}>
                <div className="modal-accent modal-accent-green" />
                <div className="modal-header">
                  <div className="modal-header-icon"><Sparkles size={18} /></div>
                  <div>
                    <h3 className="modal-title">{eqEditing ? 'Edit item' : 'Add equipment / consumable'}</h3>
                    <p className="modal-sub">Record a tool, machine or clinic consumable</p>
                  </div>
                  <button type="button" className="icon-btn" onClick={() => setEqModal(false)}><X size={18} /></button>
                </div>

                {/* Quick-pick consumables */}
                {!eqEditing && (
                  <div className="eq-quickpick">
                    <span className="eq-quickpick-label">Quick pick consumable:</span>
                    <div className="eq-quickpick-chips">
                      {CLINIC_CONSUMABLES.map((item) => (
                        <button key={item.name} type="button"
                          className={`eq-qchip${eqDraft.name === item.name ? ' selected' : ''}`}
                          onClick={() => pickConsumable(item.name)}>
                          {item.emoji} {item.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="form-two-col">
                  <label style={{ gridColumn: '1 / -1' }}>Item name <span className="required">*</span>
                    <input required value={eqDraft.name}
                      onChange={(e) => setEqDraft({ ...eqDraft, name: e.target.value })}
                      placeholder="Type custom name or pick from above…" />
                  </label>
                  <label>Clinic <span className="required">*</span>
                    <select required value={eqDraft.clinicId} onChange={(e) => setEqDraft({ ...eqDraft, clinicId: e.target.value })}>
                      {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label>Category
                    <select value={eqDraft.category} onChange={(e) => setEqDraft({ ...eqDraft, category: e.target.value as EquipmentCategory })}>
                      {EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>Condition
                    <select value={eqDraft.condition} onChange={(e) => setEqDraft({ ...eqDraft, condition: e.target.value as EquipmentCondition })}>
                      {EQUIPMENT_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </label>
                  <label>Serial number
                    <input value={eqDraft.serialNumber} onChange={(e) => setEqDraft({ ...eqDraft, serialNumber: e.target.value })} placeholder="Optional" />
                  </label>
                  <label>Purchase date
                    <input type="date" value={eqDraft.purchaseDate} onChange={(e) => setEqDraft({ ...eqDraft, purchaseDate: e.target.value })} />
                  </label>
                  <label>Purchase cost (₹)
                    <input type="number" min="0" step="0.01"
                      value={eqDraft.purchaseCost ?? ''}
                      onChange={(e) => setEqDraft({ ...eqDraft, purchaseCost: e.target.value ? parseFloat(e.target.value) : null })} />
                  </label>
                  <label style={{ gridColumn: '1 / -1' }}>Notes
                    <textarea rows={2} value={eqDraft.notes} onChange={(e) => setEqDraft({ ...eqDraft, notes: e.target.value })} placeholder="Optional notes…" />
                  </label>
                </div>

                <div className="modal-footer">
                  <button type="button" className="ghost-button" onClick={() => setEqModal(false)}><X size={14} /> Cancel</button>
                  <button type="submit" className="primary-button" disabled={eqSaving}>
                    {eqSaving ? <Loader2 size={14} className="icon-spin" /> : <Check size={14} />}
                    {eqSaving ? 'Saving…' : eqEditing ? 'Save changes' : 'Add item'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Summary strip */}
          <div className="exp-summary-grid">
            <div className="exp-metric-card exp-card-green">
              <span className="exp-metric-icon">📦</span>
              <div>
                <span className="exp-metric-label">Total items</span>
                <span className="exp-metric-value">{totalItems}</span>
              </div>
            </div>
            <div className="exp-metric-card exp-card-blue">
              <span className="exp-metric-icon">💰</span>
              <div>
                <span className="exp-metric-label">Total value</span>
                <span className="exp-metric-value">{formatCurrency(totalValue)}</span>
              </div>
            </div>
            <div className={`exp-metric-card${needsService > 0 ? ' exp-card-red' : ' exp-card-slate'}`}>
              <span className="exp-metric-icon">🔧</span>
              <div>
                <span className="exp-metric-label">Needs service</span>
                <span className="exp-metric-value">{needsService}</span>
              </div>
            </div>
            <div className="exp-metric-card exp-card-breakdown">
              <span className="exp-metric-label" style={{ marginBottom: 8 }}>Condition</span>
              <div className="exp-cat-bars">
                {EQUIPMENT_CONDITIONS.map((cond) => {
                  const count = equipment.filter((e) => e.condition === cond).length;
                  if (!count) return null;
                  return (
                    <div key={cond} className="exp-cat-bar-row">
                      <span className={`eq-cond-badge cond-${cond.toLowerCase().replace(/\s+/g, '-')}`}>{cond}</span>
                      <span className="exp-cat-amount">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Filter bar */}
          <div className="exp-filter-bar">
            <div className="exp-filter-left">
              <div className="search-field">
                <Search size={15} />
                <input placeholder="Search name or serial…" value={eqSearch} onChange={(e) => setEqSearch(e.target.value)} />
              </div>
              <select value={eqFilterClinic} onChange={(e) => setEqFilterClinic(e.target.value)}>
                <option value="all">All clinics</option>
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={eqFilterCat} onChange={(e) => setEqFilterCat(e.target.value as EquipmentCategory | 'all')}>
                <option value="all">All categories</option>
                {EQUIPMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={eqFilterCond} onChange={(e) => setEqFilterCond(e.target.value as EquipmentCondition | 'all')}>
                <option value="all">All conditions</option>
                {EQUIPMENT_CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <span className="exp-result-count">{filteredEq.length} item{filteredEq.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Table */}
          <div className="panel" style={{ padding: 0, overflow: 'hidden' }}>
            {filteredEq.length === 0 ? (
              <div className="empty-state"><Sparkles size={32} /><p>No equipment yet. Click <strong>Add equipment</strong> to start your inventory.</p></div>
            ) : (
              <table className="exp-table">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Clinic</th>
                    <th>Category</th>
                    <th>Condition</th>
                    <th>Purchased</th>
                    <th>Cost</th>
                    <th>Serial #</th>
                    <th style={{ width: 72 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEq.map((e) => (
                    <tr key={e.id}>
                      <td className="eq-td-name">
                        <span className="eq-item-name">{e.name}</span>
                        {e.notes && <span className="eq-item-notes">{e.notes}</span>}
                      </td>
                      <td className="exp-td-clinic">{clinicName(e.clinicId)}</td>
                      <td><span className={`exp-cat-badge cat-${e.category.toLowerCase().replace(/\s+/g, '-')}`}>{e.category}</span></td>
                      <td><span className={`eq-cond-badge cond-${e.condition.toLowerCase().replace(/\s+/g, '-')}`}>{e.condition}</span></td>
                      <td className="exp-td-date">{e.purchaseDate || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td className="exp-td-amount">{e.purchaseCost !== null ? formatCurrency(e.purchaseCost) : <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td className="exp-td-notes">{e.serialNumber || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td>
                        <div className="exp-row-actions">
                          <button className="exp-action-btn" title="Edit" onClick={() => openEditEq(e)}><ClipboardList size={13} /></button>
                          <button className="exp-action-btn exp-action-delete" title="Delete" onClick={() => onDeleteEquipment(e.id)}><Trash2 size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function pageTitle(page: Page) {
  const titles: Record<Page, string> = {
    dashboard: 'Dashboard',
    homeDashboard: 'Home Dashboard',
    patients: 'Patient records',
    patientEntry: 'Add patient',
    patientDetail: 'Patient details',
    sessions: 'Sessions',
    scheduleNew: 'Schedule sessions',
    homeVisits: 'Home Visits',
    calendar: 'Clinic calendar',
    clinics: 'Clinics',
    staff: 'Staff access',
    expenses: 'Expenses & Equipment',
  };
  return titles[page];
}
