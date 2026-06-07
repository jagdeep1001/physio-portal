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
  LogOut,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Trash2,
  TrendingUp,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { demoPasswords, initialData } from './data/mockData';
import {
  isSupabaseConfigured,
  loadRemoteData,
  loginWithProfiles,
  supabase,
  toPatientRow,
  toProfileRow,
  toTherapySessionRow,
} from './lib/supabase';
import type {
  AppData,
  Clinic,
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
  | 'patients'
  | 'patientEntry'
  | 'patientDetail'
  | 'sessions'
  | 'scheduleNew'
  | 'calendar'
  | 'clinics'
  | 'staff';

type PatientDraft = Omit<Patient, 'id' | 'active'>;
type ClinicDraft = Omit<Clinic, 'id' | 'active'>;

const storageKey = 'physio-care-demo-data';
const todayStr = new Date().toISOString().slice(0, 10);

const emptyHomeVisitDetails = (): HomeVisitDetails => ({
  caregiverName: '',
  caregiverRelation: '',
  caregiverPhone: '',
  condition: '',
  dischargeDate: '',
  homeSessionLog: [],
  homeSessionNotes: {},
});

const emptyPatient = (clinicId: string): PatientDraft => ({
  clinicId,
  name: '',
  phone: '',
  dateOfBirth: '',
  gender: 'Female',
  address: '',
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
          complications: (p as Patient).complications ?? '',
          surgeries: (p as Patient).surgeries ?? '',
          homeVisitDetails: hvd
            ? { ...hvd, caregiverPhone: hvd.caregiverPhone ?? '', homeSessionLog: hvd.homeSessionLog ?? [], homeSessionNotes: hvd.homeSessionNotes ?? {} }
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

function formatDateTime(value: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatDate(value: string) {
  if (!value) return '';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(value)
  );
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

const SESSION_USER_KEY = 'physio_session_user_id';

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
    const message = error instanceof Error ? error.message : 'Something went wrong while saving data.';
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
      patients: data.patients.filter((p) => visibleClinicIds.includes(p.clinicId)),
      therapySessions: data.therapySessions.filter((s) => visibleClinicIds.includes(s.clinicId)),
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
  const savePatient = async (patient: PatientDraft, editingId: string | null) => {
    if (supabase) {
      try {
        const q = editingId
          ? await supabase.from('patients').update(toPatientRow(patient)).eq('id', editingId)
          : await supabase.from('patients').insert({ ...toPatientRow(patient), active: true });
        if (q.error) throw q.error;
        await refreshRemoteData(); setSystemNotice('');
      } catch (error) { reportRemoteError(error); }
      return;
    }
    persist((draftData) => ({
      ...draftData,
      patients: editingId
        ? draftData.patients.map((item) => (item.id === editingId ? { ...item, ...patient } : item))
        : [...draftData.patients, { ...patient, id: createId('patient'), active: true }],
    }));
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
        if ('scheduledAt' in updates)   row.scheduled_at     = updates.scheduledAt;
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
    { page: 'patients', label: 'Patients', icon: Users },
    { page: 'sessions', label: 'Sessions', icon: CalendarDays },
    { page: 'calendar', label: 'Calendar', icon: Calendar },
    { page: 'clinics', label: 'Clinics', icon: Building2, adminOnly: true },
    { page: 'staff', label: 'Staff', icon: UserCheck, adminOnly: true },
  ];

  const goToPatientDetail = (patientId: string) => {
    setSelectedPatientId(patientId);
    setPage('patientDetail');
  };

  const goToScheduleForPatient = (patientId: string, sessionType: SessionType) => {
    setSchedulePreset({ patientId, sessionType });
    setPage('scheduleNew');
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
            onSyncHomeVisitLog={syncHomeVisitLog}
            onBack={() => setPage('patients')}
            onGoToAddPatient={() => setPage('patientEntry')}
            onScheduleSession={goToScheduleForPatient}
          />
        )}
        {page === 'sessions' && (
          <SessionsView
            data={scoped}
            onUpdateSession={updateSession}
            onChangeStatus={changeSessionStatus}
            onDeleteSession={deleteSession}
            onScheduleNew={() => { setSchedulePreset({}); setPage('scheduleNew'); }}
            onRecordSession={addSession}
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
  const allSessions = data.therapySessions;

  // ── KPI numbers ──
  const totalRevenue   = allSessions
    .filter((s) => s.status === 'completed' && s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
  const completedSess  = allSessions.filter((s) => s.status === 'completed').length;
  const scheduledSess  = allSessions.filter((s) => s.status === 'scheduled').length;
  const activePatients = data.patients.filter((p) => p.active).length;
  const todayClinic    = allSessions.filter((s) => s.scheduledAt.startsWith(today) && s.sessionType === 'clinic').length;
  const todayHome      = allSessions.filter((s) => s.scheduledAt.startsWith(today) && s.sessionType === 'home').length;
  const clinicSessions = allSessions.filter((s) => s.sessionType === 'clinic').length;
  const homeSessions   = allSessions.filter((s) => s.sessionType === 'home').length;
  const totalSessions  = allSessions.length;
  const completionRate = totalSessions > 0 ? Math.round((completedSess / totalSessions) * 100) : 0;

  // ── Weekly volume (last 7 days) ──
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    return d.toISOString().slice(0, 10);
  });
  const weeklyVolume = weekDays.map((dateStr) => ({
    label: new Intl.DateTimeFormat('en', { weekday: 'short' }).format(new Date(dateStr + 'T12:00')),
    dateStr,
    clinic: allSessions.filter((s) => s.scheduledAt.startsWith(dateStr) && s.sessionType === 'clinic').length,
    home:   allSessions.filter((s) => s.scheduledAt.startsWith(dateStr) && s.sessionType === 'home').length,
  }));
  const maxWeekly = Math.max(...weeklyVolume.map((d) => d.clinic + d.home), 1);

  // ── Revenue last 7 days ──
  const weeklyRevenue = weekDays.map((dateStr) => ({
    dateStr,
    amount: allSessions
      .filter((s) => s.status === 'completed' && s.amountCollected !== null && s.scheduledAt.startsWith(dateStr))
      .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0),
  }));
  const maxRevenue = Math.max(...weeklyRevenue.map((d) => d.amount), 1);

  // ── This month revenue per clinic ──
  const thisMonth = today.slice(0, 7);
  const clinicRevenue = data.clinics.map((clinic) => {
    const amount = allSessions
      .filter((s) => s.clinicId === clinic.id && s.status === 'completed' && s.amountCollected !== null && s.scheduledAt.startsWith(thisMonth))
      .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);
    const count = allSessions.filter((s) => s.clinicId === clinic.id && s.scheduledAt.startsWith(thisMonth)).length;
    return { clinic, amount, count };
  });
  const maxClinicRev = Math.max(...clinicRevenue.map((c) => c.amount), 1);

  // ── Upcoming list ──
  const upcoming = allSessions
    .filter((s) => s.status === 'scheduled' && s.scheduledAt >= today)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 5);

  // ── Recent patients ──
  const recentPatients = data.patients.slice(0, 5);

  const pendingStaff = allData.profiles.filter((p) => p.status === 'pending');

  return (
    <div className="content-stack">
      {currentUser.role === 'admin' && pendingStaff.length > 0 && (
        <div className="alert-banner">
          <UserCheck size={16} />
          {pendingStaff.length} staff account{pendingStaff.length > 1 ? 's' : ''} awaiting approval — go to Staff to approve
        </div>
      )}

      {/* ── Row 1: KPI cards ── */}
      <section className="metric-grid">
        <MetricCard icon={Users}       label="Active patients"   value={activePatients.toString()} accent="teal" />
        <MetricCard icon={DollarSign}  label="Total revenue"     value={formatCurrency(totalRevenue)} accent="green" />
        <MetricCard icon={CalendarDays} label="Sessions today"   value={(todayClinic + todayHome).toString()} accent="blue" />
        <MetricCard icon={Activity}    label="Completion rate"   value={`${completionRate}%`} accent="amber" />
      </section>

      {/* ── Row 2: Charts ── */}
      <section className="dash-charts-row">

        {/* Weekly volume bar chart */}
        <div className="panel dash-chart-panel">
          <PanelTitle title="Weekly volume" subtitle="Sessions per day — last 7 days" />
          <div className="bar-chart">
            {weeklyVolume.map((day) => {
              const total = day.clinic + day.home;
              const clinicPct = maxWeekly > 0 ? (day.clinic / maxWeekly) * 100 : 0;
              const homePct   = maxWeekly > 0 ? (day.home   / maxWeekly) * 100 : 0;
              const isToday   = day.dateStr === today;
              return (
                <div key={day.dateStr} className={`bar-col ${isToday ? 'today' : ''}`}>
                  <span className="bar-value">{total > 0 ? total : ''}</span>
                  <div className="bar-stack">
                    {homePct > 0 && <div className="bar-segment home" style={{ height: `${homePct}%` }} />}
                    {clinicPct > 0 && <div className="bar-segment clinic" style={{ height: `${clinicPct}%` }} />}
                  </div>
                  <span className="bar-label">{day.label}</span>
                </div>
              );
            })}
          </div>
          <div className="chart-legend">
            <span><span className="legend-dot clinic" />Clinic</span>
            <span><span className="legend-dot home" />Home</span>
          </div>
        </div>

        {/* Attendance mix donut */}
        <div className="panel dash-chart-panel">
          <PanelTitle title="Attendance mix" subtitle="Clinic vs home breakdown" />
          <DonutChart
            segments={[
              { label: 'Clinic', value: clinicSessions, color: 'var(--teal)' },
              { label: 'Home',   value: homeSessions,   color: 'var(--amber)' },
            ]}
            total={totalSessions}
            centerLabel={totalSessions.toString()}
            centerSub="total"
          />
          <div className="donut-legend">
            <div className="donut-legend-item">
              <span className="donut-dot" style={{ background: 'var(--teal)' }} />
              <span>Clinic</span>
              <strong>{clinicSessions}</strong>
              <small>{totalSessions > 0 ? Math.round((clinicSessions / totalSessions) * 100) : 0}%</small>
            </div>
            <div className="donut-legend-item">
              <span className="donut-dot" style={{ background: 'var(--amber)' }} />
              <span>Home visits</span>
              <strong>{homeSessions}</strong>
              <small>{totalSessions > 0 ? Math.round((homeSessions / totalSessions) * 100) : 0}%</small>
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
            <div className="stat-num-item">
              <strong>{scheduledSess}</strong>
              <span className="status scheduled">Scheduled</span>
            </div>
            <div className="stat-num-item">
              <strong>{completedSess}</strong>
              <span className="status completed">Completed</span>
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
                      <strong>{session.therapyType}</strong>
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
    .filter((p) => clinicFilter === 'all' || p.clinicId === clinicFilter)
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
            const hasHomeVisit = sessions.some((s) => s.sessionType === 'home');
            return (
              <button key={patient.id} className="table-row patient-row" onClick={() => onOpenPatient(patient.id)}>
                <span className="patient-avatar">{patient.name.charAt(0)}</span>
                <span>
                  <strong>{patient.name}</strong>
                  <small>{patient.diagnosis}</small>
                </span>
                <span>
                  {clinicName(allClinics, patient.clinicId)}
                  {hasHomeVisit && <span className="home-badge-sm"><Home size={10} /></span>}
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
  onSavePatient: (patient: PatientDraft, editingId: string | null) => void;
  onBack: () => void;
}) {
  const [draft, setDraft] = useState<PatientDraft>(() => emptyPatient(defaultClinicId));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSavePatient(draft, null);
    onBack();
  };

  return (
    <div className="content-stack">
      <div className="back-row">
        <button className="ghost-button" type="button" onClick={onBack}>
          <ChevronLeft size={16} /> Back to patients
        </button>
      </div>
      <PatientForm
        title="Add new patient"
        draft={draft}
        setDraft={setDraft}
        clinics={clinics}
        onSubmit={submit}
        onCancel={onBack}
        editing={false}
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
  patientId, onSavePatient, onSyncHomeVisitLog, onBack, onGoToAddPatient, onScheduleSession,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  allClinics: Clinic[];
  staff: Profile[];
  currentUser: Profile;
  defaultClinicId: string;
  patientId: string;
  onSavePatient: (patient: PatientDraft, editingId: string | null) => void;
  onSyncHomeVisitLog: (patientId: string, updatedPatient: PatientDraft, sync: HomeVisitSync) => void;
  onBack: () => void;
  onGoToAddPatient: () => void;
  onScheduleSession: (patientId: string, sessionType: SessionType) => void;
}) {
  const patient = data.patients.find((p) => p.id === patientId);
  const [editing, setEditing] = useState(false);
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
  const homeVisitSessions = patientSessions.filter((s) => s.sessionType === 'home');
  const totalSpent = completedSessions
    .filter((s) => s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSavePatient(draft, patient.id);
    setEditing(false);
  };

  return (
    <div className="content-stack">
      <div className="back-row">
        <button className="ghost-button" type="button" onClick={onBack}>
          <ChevronLeft size={16} /> Back to patients
        </button>
        <button className="secondary-button" type="button" onClick={() => setEditing((v) => !v)}>
          {editing ? <><X size={15} /> Close edit</> : 'Edit patient'}
        </button>
      </div>

      {/* Profile card */}
      <section className="panel patient-profile-card">
        <div className="profile-header">
          <div className="profile-avatar">{patient.name.charAt(0)}</div>
          <div>
            <h2>{patient.name}</h2>
            <p>{patient.diagnosis}</p>
            <div className="badge-row">
              <span className="badge badge-teal">{patient.gender}</span>
              <span className="badge badge-slate">{calculateAge(patient.dateOfBirth)} yrs</span>
              <span className={`badge ${patient.active ? 'badge-green' : 'badge-muted'}`}>
                {patient.active ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
          <div className="profile-actions">
            <button
              className="primary-button"
              onClick={() => onScheduleSession(patient.id, 'clinic')}
            >
              <Stethoscope size={15} /> Schedule clinic session
            </button>
            <button
              className="amber-button"
              onClick={() => onScheduleSession(patient.id, 'home')}
            >
              <Home size={15} /> Schedule home visit
            </button>
          </div>
        </div>
        <div className="facts">
          <span><strong>Clinic</strong>{clinicName(allClinics, patient.clinicId)}</span>
          <span><strong>Phone</strong>{patient.phone}</span>
          <span><strong>Address</strong>{patient.address || '—'}</span>
          <span><strong>Emergency</strong>{patient.emergencyContact || '—'}</span>
          <span><strong>Referral</strong>{patient.referralSource || '—'}</span>
          <span><strong>DOB</strong>{patient.dateOfBirth ? formatDate(patient.dateOfBirth) : '—'}</span>
        </div>
        {(patient.complications || patient.surgeries) && (
          <div className="complications-row">
            {patient.complications && (
              <div className="complication-badge">
                <strong>Complications:</strong> {patient.complications}
              </div>
            )}
            {patient.surgeries && (
              <div className="complication-badge surgery">
                <strong>Surgeries:</strong> {patient.surgeries}
              </div>
            )}
          </div>
        )}
        {patient.notes && <p className="clinical-note">Notes: {patient.notes}</p>}
      </section>

      {/* Stats row */}
      <section className="metric-grid four-col">
        <MetricCard icon={CalendarDays} label="Total sessions" value={patientSessions.length.toString()} accent="blue" />
        <MetricCard icon={Check} label="Completed" value={completedSessions.length.toString()} accent="green" />
        <MetricCard icon={Home} label="Home visits" value={homeVisitSessions.length.toString()} accent="amber" />
        <MetricCard icon={DollarSign} label="Total paid" value={formatCurrency(totalSpent)} accent="teal" />
      </section>

      {/* Reports */}
      <section className="panel">
        <PanelTitle title="Reports" subtitle="Attached documents and notes" />
        {(patient.reports ?? []).length === 0 ? (
          <EmptyState message="No reports attached yet. Use Edit patient to add reports." />
        ) : (
          <div className="list">
            {(patient.reports ?? []).map((report) => (
              <div key={report.id} className="list-row report-row">
                <span className="report-icon"><FileText size={18} /></span>
                <span>
                  <strong>{report.title}</strong>
                  <small>{formatDate(report.date)}</small>
                  {report.notes && <p className="report-notes">{report.notes}</p>}
                </span>
                {report.fileUrl && (
                  <a className="secondary-button icon-only" href={report.fileUrl} target="_blank" rel="noreferrer" title="Open report">
                    <ExternalLink size={14} />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* All sessions */}
      <section className="panel">
        <PanelTitle title="Session history" subtitle={`${patientSessions.length} total sessions`} />
        <div className="list">
          {patientSessions.length === 0 ? (
            <EmptyState message="No sessions recorded yet." />
          ) : (
            patientSessions.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                data={data}
                showTreatmentNotes
                showAmount
              />
            ))
          )}
        </div>
      </section>

      {/* Home visit caregiver + session log */}
      {(homeVisitSessions.length > 0 || patient.homeVisitDetails) && (
        <HomeVisitPanel
          patient={patient}
          homeVisitSessions={homeVisitSessions}
          staff={staff}
          onToggleHomeLog={(date, record) => {
            const hvd   = patient.homeVisitDetails ?? emptyHomeVisitDetails();
            const log   = hvd.homeSessionLog ?? [];
            const notes = { ...(hvd.homeSessionNotes ?? {}) };

            // Build patient payload from live patient (never stale draft)
            const buildPayload = (newHvd: HomeVisitDetails): PatientDraft => ({
              clinicId: patient.clinicId, name: patient.name, phone: patient.phone,
              dateOfBirth: patient.dateOfBirth, gender: patient.gender, address: patient.address,
              diagnosis: patient.diagnosis, referralSource: patient.referralSource,
              emergencyContact: patient.emergencyContact, notes: patient.notes,
              complications: patient.complications ?? '', surgeries: patient.surgeries ?? '',
              reports: patient.reports ?? [], homeVisitDetails: newHvd,
            });

            if (record === null) {
              // ── Undo mark ──
              delete notes[date];
              const updated: HomeVisitDetails = {
                ...hvd, homeSessionLog: log.filter((d) => d !== date), homeSessionNotes: notes,
              };
              const matchingSession = patientSessions.find(
                (s) => s.sessionType === 'home' && s.scheduledAt.startsWith(date) && s.status === 'completed'
              );
              onSyncHomeVisitLog(patient.id, buildPayload(updated),
                matchingSession
                  ? { action: 'update', sessionId: matchingSession.id, updates: { status: 'scheduled', completedAt: null, amountCollected: null } }
                  : { action: 'none' }
              );
            } else {
              // ── Mark done ──
              notes[date] = record;
              const updated: HomeVisitDetails = {
                ...hvd, homeSessionLog: log.includes(date) ? log : [...log, date], homeSessionNotes: notes,
              };
              const existingSession = patientSessions.find(
                (s) => s.sessionType === 'home' && s.scheduledAt.startsWith(date)
              );
              onSyncHomeVisitLog(patient.id, buildPayload(updated),
                existingSession
                  ? { action: 'update', sessionId: existingSession.id, updates: {
                      status: 'completed', completedAt: `${date}T12:00:00.000Z`,
                      treatmentNotes: record.notes, amountCollected: record.amount,
                    }}
                  : { action: 'create', session: {
                      patientId: patient.id, clinicId: patient.clinicId,
                      sessionType: 'home', therapyType: 'Home Visit', therapyLevel: 'basic',
                      assignedStaffId: '', scheduledAt: `${date}T09:00:00.000Z`,
                      status: 'completed', completedAt: `${date}T09:00:00.000Z`,
                      notes: '', treatmentNotes: record.notes, amountCollected: record.amount,
                    }}
              );
            }
          }}
        />
      )}

      {/* Edit form */}
      {editing && (
        <PatientForm
          title="Update patient record"
          draft={draft}
          setDraft={setDraft}
          clinics={currentUser.role === 'admin' ? allClinics.filter((c) => c.active) : data.clinics}
          onSubmit={submit}
          onCancel={() => setEditing(false)}
          editing
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

  const sessionDates = new Set(homeVisitSessions.map((s) => s.scheduledAt.slice(0, 10)));

  return (
    <section className="panel home-visit-panel">
      {/* Mark-done popup */}
      {pendingDate && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setPendingDate(null); }}>
          <form className="modal-panel form-grid" onSubmit={submitMarkDone}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Mark session done</h3>
                <p className="modal-sub">{pendingDate}</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setPendingDate(null)}><X size={18} /></button>
            </div>
            <label>
              Treatment notes
              <textarea
                rows={3}
                value={popupForm.notes}
                onChange={(e) => setPopupForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="What was done in this session…"
              />
            </label>
            <label>
              Amount collected (₹)
              <input
                type="number" min="0" step="0.01"
                value={popupForm.amount}
                onChange={(e) => setPopupForm((f) => ({ ...f, amount: e.target.value }))}
                placeholder="0"
              />
            </label>
            <div className="button-row modal-footer-row">
              <button className="ghost-button" type="button" onClick={() => setPendingDate(null)}><X size={14} /> Cancel</button>
              <button className="primary-button" type="submit"><Check size={14} /> Mark done</button>
            </div>
          </form>
        </div>
      )}

      <PanelTitle title="Home visit record" subtitle={`${homeVisitSessions.length} home sessions scheduled`} />

      {/* Caregiver card */}
      {hvd && (hvd.caregiverName || hvd.condition) && (
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
                  <strong>{session.therapyType}</strong>
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

function PatientForm({
  title, draft, setDraft, clinics, onSubmit, onCancel, editing,
}: {
  title: string;
  draft: PatientDraft;
  setDraft: (d: PatientDraft) => void;
  clinics: Clinic[];
  onSubmit: (e: FormEvent) => void;
  onCancel: () => void;
  editing: boolean;
}) {
  const [newReport, setNewReport] = useState<Omit<PatientReport, 'id'>>({
    title: '', date: todayStr, notes: '', fileUrl: '',
  });

  const addReport = () => {
    if (!newReport.title.trim()) return;
    const report: PatientReport = { ...newReport, id: createId('report') };
    setDraft({ ...draft, reports: [...(draft.reports ?? []), report] });
    setNewReport({ title: '', date: todayStr, notes: '', fileUrl: '' });
  };

  const removeReport = (reportId: string) => {
    setDraft({ ...draft, reports: (draft.reports ?? []).filter((r) => r.id !== reportId) });
  };

  return (
    <form className="panel form-grid" onSubmit={onSubmit}>
      <PanelTitle title={title} subtitle="Clinical record details" />

      <div className="form-two-col">
        <label>
          Clinic
          <select value={draft.clinicId} onChange={(e) => setDraft({ ...draft, clinicId: e.target.value })}>
            {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>
          Gender
          <select value={draft.gender} onChange={(e) => setDraft({ ...draft, gender: e.target.value as Patient['gender'] })}>
            <option>Female</option><option>Male</option><option>Other</option>
          </select>
        </label>
        <label>
          Full name
          <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </label>
        <label>
          Phone
          <input required value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
        </label>
        <label>
          Date of birth
          <input required type="date" value={draft.dateOfBirth} onChange={(e) => setDraft({ ...draft, dateOfBirth: e.target.value })} />
        </label>
        <label>
          Address
          <input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
        </label>
        <label>
          Referral source
          <input value={draft.referralSource} onChange={(e) => setDraft({ ...draft, referralSource: e.target.value })} />
        </label>
        <label>
          Emergency contact
          <input value={draft.emergencyContact} onChange={(e) => setDraft({ ...draft, emergencyContact: e.target.value })} />
        </label>
      </div>

      <label>
        Diagnosis
        <textarea required value={draft.diagnosis} onChange={(e) => setDraft({ ...draft, diagnosis: e.target.value })} />
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
        <textarea value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
      </label>

      {/* Home visit details section */}
      <div className="form-section">
        <div className="form-section-header">
          <h3 className="form-section-title"><Home size={15} /> Home visit details</h3>
          {!draft.homeVisitDetails ? (
            <button
              type="button" className="ghost-button"
              onClick={() => setDraft({ ...draft, homeVisitDetails: emptyHomeVisitDetails() })}
            >
              <Plus size={14} /> Enable
            </button>
          ) : (
            <button
              type="button" className="ghost-button"
              onClick={() => setDraft({ ...draft, homeVisitDetails: undefined })}
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

      {/* Reports section */}
      <div className="form-section">
        <h3 className="form-section-title"><FileText size={15} /> Reports</h3>
        {(draft.reports ?? []).length > 0 && (
          <div className="list">
            {(draft.reports ?? []).map((report) => (
              <div key={report.id} className="list-row compact report-row">
                <span>
                  <strong>{report.title}</strong>
                  <small>{formatDate(report.date)}</small>
                </span>
                <button className="ghost-button icon-only" type="button" onClick={() => removeReport(report.id)} title="Remove">
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="add-report-form">
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
          <input
            placeholder="URL (optional)"
            value={newReport.fileUrl ?? ''}
            onChange={(e) => setNewReport({ ...newReport, fileUrl: e.target.value })}
          />
          <textarea
            placeholder="Notes (optional)"
            value={newReport.notes}
            onChange={(e) => setNewReport({ ...newReport, notes: e.target.value })}
          />
          <button className="secondary-button" type="button" onClick={addReport}>
            <Plus size={14} /> Add report
          </button>
        </div>
      </div>

      <div className="button-row">
        <button className="primary-button" type="submit">
          {editing ? 'Save changes' : 'Add patient'}
        </button>
        {editing && (
          <button className="ghost-button" type="button" onClick={onCancel}>Cancel</button>
        )}
      </div>
    </form>
  );
}

// ─── Sessions View (list + actions) ──────────────────────────────────────────

function SessionsView({
  data, onUpdateSession, onChangeStatus, onDeleteSession, onScheduleNew, onRecordSession,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  onUpdateSession: (sessionId: string, updates: Partial<TherapySession>) => void;
  onChangeStatus: (sessionId: string, status: SessionStatus) => void;
  onDeleteSession: (sessionId: string) => void;
  onScheduleNew: () => void;
  onRecordSession: (session: Omit<TherapySession, 'id'>) => void;
}) {
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [completionData, setCompletionData] = useState({ treatmentNotes: '', amountCollected: '' });
  const [editingSession, setEditingSession] = useState<TherapySession | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'clinic' | 'home'>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | SessionStatus>('all');
  const [filterLevel, setFilterLevel] = useState<'all' | TherapyLevel>('all');
  const [filterPatient, setFilterPatient] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [expandedPatients, setExpandedPatients] = useState<Set<string>>(new Set());

  const togglePatient = (patientId: string) =>
    setExpandedPatients((prev) => {
      const next = new Set(prev);
      next.has(patientId) ? next.delete(patientId) : next.add(patientId);
      return next;
    });

  const submitCompletion = (e: FormEvent) => {
    e.preventDefault();
    if (!completingId) return;
    onUpdateSession(completingId, {
      status: 'completed',
      completedAt: new Date().toISOString(),
      treatmentNotes: completionData.treatmentNotes,
      amountCollected: completionData.amountCollected ? parseFloat(completionData.amountCollected) : null,
    });
    setCompletingId(null);
    setCompletionData({ treatmentNotes: '', amountCollected: '' });
  };

  const filteredSessions = data.therapySessions
    .filter((s) => filterType === 'all' || s.sessionType === filterType)
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

  return (
    <>
      {/* Complete session modal */}
      {completingId && (
        <div className="modal-backdrop">
          <form className="modal-panel form-grid" onSubmit={submitCompletion}>
            <PanelTitle title="Complete session" subtitle="Record treatment notes and payment" />
            <label>
              Treatment notes
              <textarea
                required
                value={completionData.treatmentNotes}
                onChange={(e) => setCompletionData({ ...completionData, treatmentNotes: e.target.value })}
                placeholder="What was done in this session…"
              />
            </label>
            <label>
              Amount collected (₹)
              <input
                type="number" min="0" step="0.01"
                value={completionData.amountCollected}
                onChange={(e) => setCompletionData({ ...completionData, amountCollected: e.target.value })}
                placeholder="0"
              />
            </label>
            <div className="button-row">
              <button className="primary-button" type="submit"><Check size={15} /> Mark complete</button>
              <button className="ghost-button" type="button" onClick={() => setCompletingId(null)}><X size={15} /> Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* Edit session modal */}
      {editingSession && (
        <EditSessionModal
          session={editingSession}
          data={data}
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

      <div className="content-stack">
        {/* Summary metrics */}
        <section className="metric-grid">
          <MetricCard icon={Users}        label="Patients"    value={patientGroups.length.toString()}   accent="teal" />
          <MetricCard icon={Activity}     label="Scheduled"   value={totalScheduled.toString()}          accent="blue" />
          <MetricCard icon={Check}        label="Completed"   value={totalCompleted.toString()}          accent="green" />
          <MetricCard icon={DollarSign}   label="Revenue"     value={formatCurrency(totalRevenue)}       accent="amber" />
        </section>

        <section className="panel">
          <div className="sessions-toolbar">
            <PanelTitle title="Sessions by patient" subtitle="Grouped view — expand a patient to see all their sessions" />
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
            <select value={filterType} onChange={(e) => setFilterType(e.target.value as typeof filterType)}>
              <option value="all">All types</option>
              <option value="clinic">Clinic</option>
              <option value="home">Home visit</option>
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
                    {/* Patient header row */}
                    <button
                      className="patient-group-header"
                      onClick={() => togglePatient(patientId)}
                      type="button"
                    >
                      <span className="patient-group-avatar">{(patient?.name ?? '?').charAt(0)}</span>
                      <div className="patient-group-info">
                        <strong>{patient?.name ?? 'Unknown patient'}</strong>
                        {next && <small>Next: {formatDateTime(next.scheduledAt)} · {next.therapyType}</small>}
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

                    {/* Expanded session rows — grouped by date */}
                    {isExpanded && (
                      <div className="patient-group-sessions">
                        {(() => {
                          // Group sessions by calendar date
                          const byDate = new Map<string, TherapySession[]>();
                          sessions.forEach((s) => {
                            const key = s.scheduledAt.slice(0, 10);
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
                                      <strong>{session.therapyType}</strong>
                                      <small className="session-slot-time"><Clock size={10} /> {session.scheduledAt.slice(11, 16)}</small>
                                      {session.treatmentNotes && <p className="clinical-note">{session.treatmentNotes}</p>}
                                    </div>
                                    <div className="group-session-right">
                                      <span className={`status ${session.status}`}>{statusLabel(session.status)}</span>
                                      {session.amountCollected !== null && session.status === 'completed' && (
                                        <span className="revenue-badge">{formatCurrency(session.amountCollected)}</span>
                                      )}
                                    </div>
                                    <div className="group-session-actions">
                                      {session.status === 'scheduled' && (
                                        <>
                                          <button className="primary-button icon-only" title="Mark complete"
                                            onClick={() => { setCompletingId(session.id); setCompletionData({ treatmentNotes: session.treatmentNotes ?? '', amountCollected: '' }); }}>
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

// ─── Edit Session Modal ────────────────────────────────────────────────────────

function EditSessionModal({
  session, data, onSave, onClose,
}: {
  session: TherapySession;
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  onSave: (updates: Partial<TherapySession>) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    therapyType:   session.therapyType,
    sessionType:   session.sessionType as SessionType,
    therapyLevel:  session.therapyLevel as TherapyLevel,
    scheduledAt:   session.scheduledAt.slice(0, 16),
    notes:         session.notes,
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSave({
      therapyType:  form.therapyType,
      sessionType:  form.sessionType,
      therapyLevel: form.therapyLevel,
      scheduledAt:  form.scheduledAt,
      notes:        form.notes,
    });
  };

  const patient = data.patients.find((p) => p.id === session.patientId);

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-panel form-grid" onSubmit={handleSubmit}>
        <div className="modal-header">
          <div>
            <h3 className="modal-title">Edit session</h3>
            <p className="modal-sub">{patient?.name ?? 'Unknown'} · scheduled</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose}><X size={18} /></button>
        </div>

        <label>
          Therapy type <span className="required">*</span>
          <input required value={form.therapyType} onChange={(e) => set('therapyType', e.target.value)} />
        </label>

        <label>
          Date &amp; time
          <input type="datetime-local" value={form.scheduledAt} onChange={(e) => set('scheduledAt', e.target.value)} />
        </label>

        <label>
          Session type
          <div className="toggle-row">
            {(['clinic', 'home'] as SessionType[]).map((t) => (
              <button key={t} type="button" className={`toggle-btn ${form.sessionType === t ? 'active' : ''}`} onClick={() => set('sessionType', t)}>
                {t === 'clinic' ? <Stethoscope size={13} /> : <Home size={13} />}
                {t === 'clinic' ? 'Clinic' : 'Home visit'}
              </button>
            ))}
          </div>
        </label>

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
          Notes
          <textarea rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any notes for this session…" />
        </label>

        <div className="button-row modal-footer-row">
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

  const toISO = (d: Date) => {
    const dateStr = d.toISOString().slice(0, 10);
    return `${dateStr}T${startTime}`;
  };

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
  const nowLocal = (() => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  })();

  const [form, setForm] = useState({
    patientId: '',
    clinicId: data.clinics[0]?.id ?? '',
    therapyType: '',
    sessionType: 'clinic' as SessionType,
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
      sessionType:      form.sessionType,
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
      <form className="modal-panel record-session-modal form-grid" onSubmit={handleSubmit}>
        <div className="modal-header">
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
                {data.patients.map((p) => (
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
              <input
                required
                value={form.therapyType}
                onChange={(e) => set('therapyType', e.target.value)}
                placeholder="e.g. Ultrasound therapy, Manual therapy…"
              />
            </label>

            <label>
              Session type
              <div className="toggle-row">
                {(['clinic', 'home'] as SessionType[]).map((t) => (
                  <button
                    key={t} type="button"
                    className={`toggle-btn ${form.sessionType === t ? 'active' : ''}`}
                    onClick={() => set('sessionType', t)}
                  >
                    {t === 'clinic' ? <Stethoscope size={14} /> : <Home size={14} />}
                    {t === 'clinic' ? 'Clinic' : 'Home visit'}
                  </button>
                ))}
              </div>
            </label>

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

        <div className="button-row modal-footer-row">
          <button className="ghost-button" type="button" onClick={onClose}><X size={15} /> Cancel</button>
          <button className="primary-button" type="submit"><Check size={15} /> Save session</button>
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
  const [patientId, setPatientId] = useState(preset.patientId ?? data.patients[0]?.id ?? '');
  const [sessionType, setSessionType] = useState<SessionType>(preset.sessionType ?? 'clinic');
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

  // Sync preset
  useEffect(() => {
    if (preset.patientId) setPatientId(preset.patientId);
    if (preset.sessionType) setSessionType(preset.sessionType);
  }, [preset.patientId, preset.sessionType]);

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
    const withTime = (iso: string, hhmm: string) => iso.slice(0, 10) + 'T' + hhmm;

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

    setTimeout(() => {
      setTherapyType('');
      setTherapyType2('');
      setStartTime2('11:00');
      setNotes('');
      setAmountPerSession('');
      setConfirmed(false);
      setSuccessCount(0);
    }, 3000);
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
            <button type="button" className="ghost-link" onClick={() => { onClearPreset(); setPatientId(data.patients[0]?.id ?? ''); }}>
              Clear
            </button>
          </div>
        )}
      </div>

      {confirmed && (
        <div className="success-banner">
          <Check size={18} />
          <strong>{successCount} session{successCount > 1 ? 's' : ''} scheduled successfully!</strong>
        </div>
      )}

      <div className="schedule-new-layout">
        {/* Left: form */}
        <form className="panel form-grid" onSubmit={handleSubmit}>
          <PanelTitle title="Schedule sessions" subtitle="Set up single or bulk recurring sessions" />

          {/* Session type */}
          <label>
            Session type
            <div className="segmented-small">
              <button type="button" className={sessionType === 'clinic' ? 'active' : ''} onClick={() => setSessionType('clinic')}>
                <Stethoscope size={14} /> Clinic
              </button>
              <button type="button" className={sessionType === 'home' ? 'active' : ''} onClick={() => setSessionType('home')}>
                <Home size={14} /> Home visit
              </button>
            </div>
          </label>

          {/* Patient */}
          <label>
            Patient
            <select required value={patientId} onChange={(e) => setPatientId(e.target.value)}>
              {data.patients.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
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
            <input
              required
              value={therapyType}
              onChange={(e) => setTherapyType(e.target.value)}
              placeholder="e.g. Manual therapy, Gait training…"
            />
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
              <input
                required
                value={therapyType2}
                onChange={(e) => setTherapyType2(e.target.value)}
                placeholder="Second therapy type…"
              />
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
                  {sessionType === 'home' ? <Home size={12} /> : <Stethoscope size={12} />}
                  {sessionType === 'home' ? 'Home visit' : 'Clinic session'}
                </span>
                {selectedPatient && <span className="badge badge-slate">{selectedPatient.name}</span>}
                {therapyType && <span className="badge badge-blue">{therapyType}</span>}
                {amountPerSession && (
                  <span className="badge badge-green">₹{amountPerSession} / session</span>
                )}
              </div>

              <div className="preview-total">
                <strong>Total estimated cost:</strong>{' '}
                {amountPerSession
                  ? formatCurrency(parseFloat(amountPerSession) * previewDates.length)
                  : '—'}
              </div>

              <div className="preview-list">
                {(() => {
                  // Group preview dates by calendar date; also include therapy-2 slot
                  const byDate = new Map<string, string[]>();
                  previewDates.forEach((dt) => {
                    const dateKey = dt.slice(0, 10);
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
                          const time = slot.slice(11, 16);
                          const label = dualTherapy
                            ? si === 0 ? `${therapyType || 'Therapy 1'} · ${therapyLevel}` : `${therapyType2 || 'Therapy 2'} · ${therapyLevel2}`
                            : (therapyType || 'Session');
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

function CalendarView({
  data, allClinics, currentUser, onOpenPatient,
}: {
  data: Pick<AppData, 'clinics' | 'patients' | 'therapySessions'>;
  allClinics: Clinic[];
  currentUser: Profile;
  onOpenPatient: (patientId: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedClinicId, setSelectedClinicId] = useState(
    currentUser.role === 'staff' && currentUser.clinicId ? currentUser.clinicId : 'all'
  );
  const [popover, setPopover] = useState<TherapySession | null>(null);

  const clinicsForSelector = currentUser.role === 'admin' ? allClinics : data.clinics;

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  };

  const monthName = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' }).format(new Date(year, month));

  // Build calendar grid
  const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstDayOfMonth + daysInMonth) / 7) * 7;

  const cells: Array<{ date: number | null; dateStr: string | null }> = [];
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - firstDayOfMonth + 1;
    if (dayNum < 1 || dayNum > daysInMonth) {
      cells.push({ date: null, dateStr: null });
    } else {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(dayNum).padStart(2, '0');
      cells.push({ date: dayNum, dateStr: `${year}-${mm}-${dd}` });
    }
  }

  const filteredSessions = data.therapySessions.filter((s) =>
    selectedClinicId === 'all' || s.clinicId === selectedClinicId
  );

  const sessionsByDate = (dateStr: string) =>
    filteredSessions.filter((s) => s.scheduledAt.startsWith(dateStr));

  const todayDateStr = todayStr;

  // Monthly stats
  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;
  const monthSessions  = filteredSessions.filter((s) => s.scheduledAt.startsWith(monthStr));
  const monthScheduled = monthSessions.filter((s) => s.status === 'scheduled').length;
  const monthCompleted = monthSessions.filter((s) => s.status === 'completed').length;
  const monthHome      = monthSessions.filter((s) => s.sessionType === 'home').length;
  const monthRevenue   = monthSessions.filter((s) => s.status === 'completed' && s.amountCollected !== null)
    .reduce((sum, s) => sum + (s.amountCollected ?? 0), 0);

  return (
    <div className="content-stack">

      {/* ── Session detail popover ── */}
      {popover && (() => {
        const patient  = data.patients.find((p) => p.id === popover.patientId);
        const clinic   = allClinics.find((c) => c.id === popover.clinicId);
        const isHome   = popover.sessionType === 'home';
        const time     = popover.scheduledAt.slice(11, 16);
        const dateDisp = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
          .format(new Date(popover.scheduledAt.slice(0, 10) + 'T12:00'));
        return (
          <div className="modal-backdrop" onClick={() => setPopover(null)}>
            <div className="cal-popover" onClick={(e) => e.stopPropagation()}>
              {/* Coloured header strip */}
              <div className={`cal-popover-header ${isHome ? 'home' : 'clinic'} status-${popover.status}`}>
                <div className="cal-popover-title-row">
                  <span className="cal-popover-icon">{isHome ? <Home size={16} /> : <Stethoscope size={16} />}</span>
                  <div>
                    <h3 className="cal-popover-title">{popover.therapyType}</h3>
                    <p className="cal-popover-sub">{dateDisp} · {time}</p>
                  </div>
                </div>
                <button className="cal-popover-close" onClick={() => setPopover(null)}><X size={16} /></button>
              </div>

              {/* Status + level strip */}
              <div className="cal-popover-badges">
                <span className={`status ${popover.status}`}>{statusLabel(popover.status)}</span>
                <span className={`therapy-level-badge ${popover.therapyLevel ?? 'basic'}`}>{popover.therapyLevel ?? 'basic'}</span>
                <span className={`badge ${isHome ? 'badge-amber' : 'badge-teal'}`}>
                  {isHome ? <Home size={10} /> : <Stethoscope size={10} />}
                  {isHome ? 'Home visit' : 'Clinic'}
                </span>
              </div>

              {/* Detail rows */}
              <div className="cal-popover-rows">
                <div className="cal-popover-row">
                  <Users size={14} />
                  <div>
                    <span className="cal-row-label">Patient</span>
                    <button className="ghost-link cal-row-value"
                      onClick={() => { onOpenPatient(popover.patientId); setPopover(null); }}>
                      {patient?.name ?? 'Unknown'} ↗
                    </button>
                  </div>
                </div>
                <div className="cal-popover-row">
                  <Building2 size={14} />
                  <div>
                    <span className="cal-row-label">Clinic</span>
                    <span className="cal-row-value">{clinic?.name ?? '—'}</span>
                  </div>
                </div>
                <div className="cal-popover-row">
                  <Clock size={14} />
                  <div>
                    <span className="cal-row-label">Date &amp; time</span>
                    <span className="cal-row-value">{dateDisp} at {time}</span>
                  </div>
                </div>
                {popover.amountCollected !== null && (
                  <div className="cal-popover-row">
                    <DollarSign size={14} />
                    <div>
                      <span className="cal-row-label">Amount</span>
                      <span className="cal-row-value">{formatCurrency(popover.amountCollected)}</span>
                    </div>
                  </div>
                )}
                {popover.treatmentNotes && (
                  <div className="cal-popover-row">
                    <FileText size={14} />
                    <div>
                      <span className="cal-row-label">Treatment notes</span>
                      <span className="cal-row-value">{popover.treatmentNotes}</span>
                    </div>
                  </div>
                )}
                {popover.notes && (
                  <div className="cal-popover-row">
                    <FileText size={14} />
                    <div>
                      <span className="cal-row-label">Notes</span>
                      <span className="cal-row-value">{popover.notes}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Actions */}
              <div className="cal-popover-actions">
                <button className="primary-button" onClick={() => { onOpenPatient(popover.patientId); setPopover(null); }}>
                  <Users size={14} /> View patient
                </button>
                <button className="ghost-button" onClick={() => setPopover(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Toolbar ── */}
      <div className="calendar-toolbar">
        <div className="cal-nav-group">
          <button className="ghost-button icon-only" onClick={prevMonth}><ChevronLeft size={18} /></button>
          <h2 className="calendar-month-title">{monthName}</h2>
          <button className="ghost-button icon-only" onClick={nextMonth}><ChevronRight size={18} /></button>
          <button
            className="ghost-button cal-today-btn"
            onClick={() => { setMonth(now.getMonth()); setYear(now.getFullYear()); }}
          >
            Today
          </button>
        </div>
        <div className="cal-month-stats">
          <span className="cal-stat scheduled"><Activity size={11} />{monthScheduled} scheduled</span>
          <span className="cal-stat completed"><Check size={11} />{monthCompleted} done</span>
          <span className="cal-stat home"><Home size={11} />{monthHome} home</span>
          {monthRevenue > 0 && <span className="cal-stat revenue"><DollarSign size={11} />{formatCurrency(monthRevenue)}</span>}
        </div>
        <select
          className="clinic-selector"
          value={selectedClinicId}
          onChange={(e) => setSelectedClinicId(e.target.value)}
        >
          {currentUser.role === 'admin' && <option value="all">All clinics</option>}
          {clinicsForSelector.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* ── Calendar grid ── */}
      <section className="calendar-grid-wrapper panel">
        <div className="calendar-header-row">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, di) => (
            <div key={d} className={`calendar-dow ${di === 0 || di === 6 ? 'weekend' : ''}`}>{d}</div>
          ))}
        </div>
        <div className="calendar-grid">
          {cells.map((cell, i) => {
            const sessions = cell.dateStr ? sessionsByDate(cell.dateStr) : [];
            const isToday   = cell.dateStr === todayDateStr;
            const isWeekend = i % 7 === 0 || i % 7 === 6;
            const hasSessions = sessions.length > 0;
            return (
              <div
                key={i}
                className={`calendar-cell${!cell.date ? ' empty' : ''}${isToday ? ' today' : ''}${isWeekend ? ' weekend' : ''}${hasSessions ? ' has-sessions' : ''}`}
              >
                {cell.date !== null && (
                  <>
                    <span className="calendar-date">{cell.date}</span>
                    <div className="calendar-sessions">
                      {sessions.slice(0, 3).map((s) => (
                        <button
                          key={s.id}
                          className={`cal-session-chip ${s.sessionType === 'home' ? 'home' : 'clinic'} level-${s.therapyLevel ?? 'basic'} status-${s.status}`}
                          onClick={() => setPopover(s)}
                          title={`${s.therapyType} · ${s.scheduledAt.slice(11, 16)} [${s.therapyLevel ?? 'basic'}]`}
                        >
                          {s.sessionType === 'home' ? <Home size={9} /> : <Stethoscope size={9} />}
                          <span className="chip-time">{s.scheduledAt.slice(11, 16)}</span>
                          <span className="chip-label">{s.therapyType.slice(0, 12)}</span>
                        </button>
                      ))}
                      {sessions.length > 3 && (
                        <span className="cal-more">+{sessions.length - 3} more</span>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Legend ── */}
      <div className="calendar-legend">
        <span className="legend-item"><span className="legend-dot teal" />Clinic · scheduled</span>
        <span className="legend-item"><span className="legend-dot amber" />Home visit</span>
        <span className="legend-item"><span className="legend-dot green" />Completed</span>
        <span className="legend-item"><span className="legend-dot coral" />Cancelled / No-show</span>
        <span className="legend-item"><span className="legend-bar rehab" />Rehab level</span>
        <span className="legend-item"><span className="legend-bar advance" />Advance level</span>
      </div>
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
          <form className="modal-panel form-grid clinic-modal" onSubmit={submit}>
            <div className="modal-header">
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

            <div className="button-row modal-footer-row">
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

  const generatePassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789!@#';
    const pw = Array.from({ length: 12 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    setDraft((d) => ({ ...d, password: pw }));
  };

  const startEdit = (p: Profile) => {
    setEditingProfile(p);
    setDraft({ name: p.name, email: p.email, password: '', phone: p.phone, title: p.title, clinicId: p.clinicId ?? '', role: p.role, status: p.status });
    setShowForm(true);
  };

  const cancelForm = () => { setShowForm(false); setDraft(emptyStaff()); setEditingProfile(null); };

  const submitForm = (e: FormEvent) => {
    e.preventDefault();
    if (editingProfile) {
      onUpdateProfile({ ...editingProfile, name: draft.name, email: draft.email, phone: draft.phone, title: draft.title, clinicId: draft.clinicId || null, role: draft.role, status: draft.status });
    } else {
      onAddProfile({ name: draft.name, email: draft.email, password: draft.password, phone: draft.phone, title: draft.title, clinicId: draft.clinicId || null, role: draft.role, status: draft.status });
    }
    cancelForm();
  };

  const pending = profiles.filter((p) => p.status === 'pending');
  const active  = profiles.filter((p) => p.status === 'active');
  const inactive = profiles.filter((p) => p.status === 'inactive');

  return (
    <div className="workspace-grid">
      {/* Staff list */}
      <div className="content-stack">
        {pending.length > 0 && (
          <section className="panel">
            <PanelTitle title="Pending approval" subtitle="These accounts are waiting to be activated" />
            <div className="staff-cards">
              {pending.map((p) => <StaffCard key={p.id} profile={p} clinics={clinics} onUpdate={onUpdateProfile} onEdit={startEdit} onDelete={onDeleteProfile} />)}
            </div>
          </section>
        )}
        <section className="panel">
          <div className="toolbar">
            <PanelTitle title="All staff" subtitle={`${profiles.length} account${profiles.length !== 1 ? 's' : ''}`} />
            <button className="primary-button" onClick={() => { setShowForm(true); setEditingProfile(null); setDraft(emptyStaff()); }}>
              <Plus size={16} /> Add staff
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
        </section>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <form className="panel form-grid staff-form" onSubmit={submitForm}>
          <div className="modal-header">
            <div>
              <h3 className="modal-title">{editingProfile ? 'Edit staff member' : 'Add new staff'}</h3>
              <p className="modal-sub">{editingProfile ? 'Update account details' : 'Create a login and set up their access'}</p>
            </div>
            <button type="button" className="icon-btn" onClick={cancelForm}><X size={18} /></button>
          </div>

          <div className="form-two-col">
            <label>Full name <span className="required">*</span>
              <input required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Dr. Jane Smith" />
            </label>
            <label>Job title <span className="required">*</span>
              <input required value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Physiotherapist" />
            </label>
            <label>Email <span className="required">*</span>
              <input required type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} placeholder="staff@clinic.com" />
            </label>
            <label>Phone
              <input type="tel" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} placeholder="+1 555 0000" />
            </label>
          </div>

          {!editingProfile && (
            <label>
              Password <span className="required">*</span>
              <div className="password-field-row">
                <div className="password-input-wrap">
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    placeholder="Set a login password"
                    autoComplete="new-password"
                  />
                  <button type="button" className="pw-toggle" onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button type="button" className="ghost-button" onClick={generatePassword}>
                  Generate
                </button>
              </div>
              {draft.password && (
                <small className="pw-strength">Password set — share securely with the staff member</small>
              )}
            </label>
          )}

          <div className="form-two-col">
            <label>
              Role
              <select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Role })}>
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <label>
              Status
              <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value as StaffStatus })}>
                <option value="active">Active</option>
                <option value="pending">Pending</option>
                <option value="inactive">Inactive</option>
              </select>
            </label>
          </div>

          <label>
            Clinic assignment
            <select value={draft.clinicId} onChange={(e) => setDraft({ ...draft, clinicId: e.target.value })}>
              <option value="">— All clinics (admin scope) —</option>
              {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>

          <div className="button-row">
            <button className="primary-button" type="submit">
              {editingProfile ? 'Save changes' : <><Plus size={15} /> Create account</>}
            </button>
            <button className="ghost-button" type="button" onClick={cancelForm}><X size={14} /> Cancel</button>
          </div>
        </form>
      )}
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
  icon: Icon, label, value, accent,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: 'teal' | 'blue' | 'amber' | 'green';
}) {
  return (
    <div className={`metric-card accent-${accent}`}>
      <div className="metric-icon-wrap"><Icon size={20} /></div>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
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
        <strong>{session.therapyType}</strong>
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
  if (!clinicId) return 'All clinics';
  return clinics.find((c) => c.id === clinicId)?.name ?? 'Unknown clinic';
}

function pageTitle(page: Page) {
  const titles: Record<Page, string> = {
    dashboard: 'Dashboard',
    patients: 'Patient records',
    patientEntry: 'Add patient',
    patientDetail: 'Patient details',
    sessions: 'Sessions',
    scheduleNew: 'Schedule sessions',
    calendar: 'Clinic calendar',
    clinics: 'Clinics',
    staff: 'Staff access',
  };
  return titles[page];
}
