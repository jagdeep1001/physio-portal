/**
 * WhatsApp session reminders (Meta Cloud API).
 *
 * Runs on a cron trigger every 15 minutes. For each SCHEDULED CLINIC session whose
 * start is now within its clinic's "lead hours before" window, it sends the patient a
 * WhatsApp template reminder and records it in `session_reminders` so it is only sent once.
 *
 * Session times are stored as clinic wall-clock with a +00:00 suffix that actually means
 * IST (see src/lib/datetime.ts in the app). We convert to the true instant by subtracting
 * the IST offset before comparing to the real clock.
 */

export interface Env {
  // vars
  META_API_VERSION: string;
  TEMPLATE_LANG: string;
  DEFAULT_COUNTRY_CODE: string;
  TEMPLATE_WITH_LOCATION: string;
  TEMPLATE_NO_LOCATION: string;
  // secrets
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  WHATSAPP_TOKEN: string;
  WHATSAPP_PHONE_NUMBER_ID: string;
  TRIGGER_TOKEN: string;
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +05:30
const MAX_LEAD_HOURS = 12;

type ReminderSettingsRow = {
  clinic_id: string | null;
  enabled: boolean;
  lead_hours: number | string | null;
  include_location: boolean;
};

type SessionRow = {
  id: string;
  scheduled_at: string;
  session_type: string;
  status: string;
  clinic_id: string | null;
  patient_id: string;
  patients: { name: string | null; phone: string | null } | null;
  clinics: { name: string | null; address: string | null } | null;
};

type EffectiveSettings = { enabled: boolean; leadHours: number; includeLocation: boolean };

type SendOutcome = {
  sessionId: string;
  status: 'sent' | 'failed' | 'skipped';
  toPhone: string;
  providerMessageId: string;
  error: string;
};

// ── Supabase REST helpers ──────────────────────────────────────────────────
async function sbFetch(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${path}`;
  const headers = new Headers(init.headers);
  headers.set('apikey', env.SUPABASE_SERVICE_KEY);
  headers.set('Authorization', `Bearer ${env.SUPABASE_SERVICE_KEY}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  return fetch(url, { ...init, headers });
}

function normalizeLeadHours(value: number | string | null): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  if (!Number.isFinite(parsed)) return 2;
  return Math.min(MAX_LEAD_HOURS, Math.max(0.5, parsed));
}

/** Digits-only E.164 number (no '+'), applying the default country code when missing. */
function normalizePhone(raw: string | null | undefined, countryCode: string): string | null {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return null;
  digits = digits.replace(/^0+/, '');
  const cc = countryCode.replace(/[^\d]/g, '');
  // Treat 10-digit numbers as local; prepend the country code.
  if (digits.length <= 10) digits = `${cc}${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return digits;
}

/** Format the stored wall-clock (IST) value for display, e.g. "11 Jul 2026" / "5:30 PM". */
function formatIstDate(scheduledAt: string): string {
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return scheduledAt.slice(0, 10);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric',
  }).format(d);
}

function formatIstTime(scheduledAt: string): string {
  const d = new Date(scheduledAt);
  if (Number.isNaN(d.getTime())) return scheduledAt.slice(11, 16);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', hour: 'numeric', minute: '2-digit',
  }).format(d);
}

/** Real UTC instant of a session whose wall-clock is actually IST. */
function sessionInstantMs(scheduledAt: string): number {
  const parsed = Date.parse(scheduledAt);
  if (Number.isNaN(parsed)) return NaN;
  return parsed - IST_OFFSET_MS;
}

async function loadSettings(env: Env): Promise<Map<string | null, EffectiveSettings>> {
  const res = await sbFetch(env, 'reminder_settings?select=clinic_id,enabled,lead_hours,include_location');
  if (!res.ok) throw new Error(`Failed to load reminder_settings: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as ReminderSettingsRow[];
  const map = new Map<string | null, EffectiveSettings>();
  for (const row of rows) {
    map.set(row.clinic_id, {
      enabled: Boolean(row.enabled),
      leadHours: normalizeLeadHours(row.lead_hours),
      includeLocation: Boolean(row.include_location),
    });
  }
  return map;
}

function effectiveFor(settings: Map<string | null, EffectiveSettings>, clinicId: string | null): EffectiveSettings {
  const global = settings.get(null) ?? { enabled: false, leadHours: 2, includeLocation: true };
  if (clinicId && settings.has(clinicId)) return settings.get(clinicId)!;
  return global;
}

async function loadCandidateSessions(env: Env): Promise<SessionRow[]> {
  const nowWallMs = Date.now() + IST_OFFSET_MS;
  const lower = new Date(nowWallMs - 60 * 60 * 1000).toISOString();
  const upper = new Date(nowWallMs + (MAX_LEAD_HOURS + 1) * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    select: 'id,scheduled_at,session_type,status,clinic_id,patient_id,patients(name,phone),clinics(name,address)',
    status: 'eq.scheduled',
    session_type: 'eq.clinic',
    'scheduled_at': `gte.${lower}`,
  });
  // Second bound (URLSearchParams can't repeat a key via the constructor object).
  params.append('scheduled_at', `lte.${upper}`);
  const res = await sbFetch(env, `therapy_sessions?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to load sessions: ${res.status} ${await res.text()}`);
  return (await res.json()) as SessionRow[];
}

async function loadAlreadySent(env: Env, sessionIds: string[]): Promise<Set<string>> {
  if (sessionIds.length === 0) return new Set();
  const inList = sessionIds.map((id) => `"${id}"`).join(',');
  const res = await sbFetch(env, `session_reminders?select=session_id&session_id=in.(${inList})`);
  if (!res.ok) throw new Error(`Failed to load session_reminders: ${res.status} ${await res.text()}`);
  const rows = (await res.json()) as Array<{ session_id: string }>;
  return new Set(rows.map((r) => r.session_id));
}

async function sendWhatsApp(env: Env, session: SessionRow, phone: string, includeLocation: boolean): Promise<{ id: string }> {
  const patientName = (session.patients?.name ?? 'there').trim() || 'there';
  const clinicName = (session.clinics?.name ?? 'our clinic').trim() || 'our clinic';
  const address = (session.clinics?.address ?? '').trim();
  const dateStr = formatIstDate(session.scheduled_at);
  const timeStr = formatIstTime(session.scheduled_at);

  const useLocation = includeLocation && address.length > 0;
  const templateName = useLocation ? env.TEMPLATE_WITH_LOCATION : env.TEMPLATE_NO_LOCATION;
  const parameters = [
    { type: 'text', text: patientName },
    { type: 'text', text: clinicName },
    { type: 'text', text: dateStr },
    { type: 'text', text: timeStr },
    ...(useLocation ? [{ type: 'text', text: address }] : []),
  ];

  const url = `https://graph.facebook.com/${env.META_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'template',
      template: {
        name: templateName,
        language: { code: env.TEMPLATE_LANG },
        components: [{ type: 'body', parameters }],
      },
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as {
    messages?: Array<{ id: string }>;
    error?: { message?: string };
  };
  if (!res.ok) {
    throw new Error(payload.error?.message ?? `Meta API error ${res.status}`);
  }
  return { id: payload.messages?.[0]?.id ?? '' };
}

async function logReminder(env: Env, outcome: SendOutcome): Promise<void> {
  const res = await sbFetch(env, 'session_reminders', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates' },
    body: JSON.stringify({
      session_id: outcome.sessionId,
      status: outcome.status,
      to_phone: outcome.toPhone,
      provider_message_id: outcome.providerMessageId,
      error: outcome.error.slice(0, 500),
    }),
  });
  if (!res.ok && res.status !== 409) {
    console.error(`Failed to log reminder for ${outcome.sessionId}: ${res.status} ${await res.text()}`);
  }
}

async function runReminders(env: Env): Promise<{ scanned: number; sent: number; failed: number; skipped: number }> {
  const settings = await loadSettings(env);
  const anyEnabled = [...settings.values()].some((s) => s.enabled);
  if (!anyEnabled) return { scanned: 0, sent: 0, failed: 0, skipped: 0 };

  const sessions = await loadCandidateSessions(env);
  const alreadySent = await loadAlreadySent(env, sessions.map((s) => s.id));
  const now = Date.now();

  let sent = 0, failed = 0, skipped = 0;

  for (const session of sessions) {
    if (alreadySent.has(session.id)) continue;

    const eff = effectiveFor(settings, session.clinic_id);
    if (!eff.enabled) continue;

    const instant = sessionInstantMs(session.scheduled_at);
    if (Number.isNaN(instant)) continue;

    const windowStart = instant - eff.leadHours * 60 * 60 * 1000;
    // Send once the session enters its lead window and is still upcoming.
    if (now < windowStart || now >= instant) continue;

    const phone = normalizePhone(session.patients?.phone, env.DEFAULT_COUNTRY_CODE);
    if (!phone) {
      skipped += 1;
      await logReminder(env, {
        sessionId: session.id, status: 'skipped', toPhone: '',
        providerMessageId: '', error: 'Missing or invalid patient phone number',
      });
      continue;
    }

    try {
      const { id } = await sendWhatsApp(env, session, phone, eff.includeLocation);
      sent += 1;
      await logReminder(env, { sessionId: session.id, status: 'sent', toPhone: phone, providerMessageId: id, error: '' });
    } catch (err) {
      failed += 1;
      await logReminder(env, {
        sessionId: session.id, status: 'failed', toPhone: phone,
        providerMessageId: '', error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { scanned: sessions.length, sent, failed, skipped };
}

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      runReminders(env)
        .then((summary) => console.log('Reminder run complete', summary))
        .catch((err) => console.error('Reminder run failed', err)),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/') {
      return Response.json({ ok: true, service: 'whatsapp-reminders' });
    }

    // Manual trigger for testing: POST /run with Authorization: Bearer <TRIGGER_TOKEN>.
    if (request.method === 'POST' && url.pathname === '/run') {
      const header = request.headers.get('Authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!env.TRIGGER_TOKEN || token !== env.TRIGGER_TOKEN) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
      }
      try {
        const summary = await runReminders(env);
        return Response.json({ ok: true, ...summary });
      } catch (err) {
        return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
      }
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },
};
