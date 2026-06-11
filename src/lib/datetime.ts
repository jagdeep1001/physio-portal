/**
 * Session times are clinic wall-clock values (e.g. 17:30 means 5:30 PM at the clinic).
 * Postgres timestamptz stores the clock face with a +00:00 suffix; we never shift by timezone.
 */

const WALL_CLOCK_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/;

export function localTodayStr(reference = new Date()): string {
  const y = reference.getFullYear();
  const m = String(reference.getMonth() + 1).padStart(2, '0');
  const d = String(reference.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildLocalDateTime(date: string, time: string): string {
  const hhmm = time.length === 5 ? time : time.slice(0, 5);
  return `${date}T${hhmm}`;
}

/** 30-minute visit slots between startH (inclusive) and endH (exclusive). */
export function genVisitSlots(startH: number, endH: number): string[] {
  const out: string[] = [];
  for (let h = startH; h < endH; h++) {
    out.push(`${String(h).padStart(2, '0')}:00`);
    out.push(`${String(h).padStart(2, '0')}:30`);
  }
  return out;
}

/** Home visits: 9:00 AM through 6:00 PM (30-minute slots, including 6 PM). */
export const HOME_VISIT_SLOTS = [...genVisitSlots(9, 18), '18:00'];
export const HOME_VISIT_SLOT_SET = new Set(HOME_VISIT_SLOTS);

export function isHomeVisitSlot(time: string): boolean {
  const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
  return HOME_VISIT_SLOT_SET.has(hhmm);
}

export function formatVisitSlotLabel(slot: string): string {
  return formatSessionTime(buildLocalDateTime('2000-01-01', slot));
}

export function snapToHomeVisitSlot(time: string): string {
  const hhmm = time.length >= 5 ? time.slice(0, 5) : time;
  if (isHomeVisitSlot(hhmm)) return hhmm;
  return HOME_VISIT_SLOTS[0];
}

/** Canonical app form: YYYY-MM-DDTHH:mm (no timezone). */
export function normalizeScheduledAt(value: string): string {
  if (!value) return value;
  const m = WALL_CLOCK_RE.exec(value);
  if (!m) return value;
  return `${m[1]}T${m[2]}`;
}

/** Parse a plain calendar date (YYYY-MM-DD) as local midnight. */
export function parseCalendarDate(value: string): Date {
  if (!value) return new Date(NaN);
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
}

/** Parse either a session datetime or a plain calendar date. */
export function parseAppDate(value: string): Date {
  if (!value) return new Date(NaN);
  if (value.includes('T')) return parseScheduledAt(value);
  return parseCalendarDate(value);
}

/** Parse a wall-clock datetime in the browser's local calendar (for display only). */
export function parseScheduledAt(value: string): Date {
  const normalized = normalizeScheduledAt(value);
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(normalized);
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], 0, 0);
}

/** Write to Postgres timestamptz without timezone shift. */
export function toDbScheduledAt(local: string): string {
  return `${normalizeScheduledAt(local)}:00+00:00`;
}

/** Read from Postgres timestamptz back to app wall-clock string. */
export function fromDbScheduledAt(db: string): string {
  return normalizeScheduledAt(db);
}

export function sessionDateKey(value: string): string {
  const d = parseScheduledAt(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function sessionTimeKey(value: string): string {
  const d = parseScheduledAt(value);
  if (Number.isNaN(d.getTime())) return value.slice(11, 16);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function formatSessionTime(value: string): string {
  if (!value) return '';
  const d = parseScheduledAt(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatSessionDateTime(value: string): string {
  if (!value) return '';
  const d = parseScheduledAt(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatLocalDateFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatLocalDateTimeFromDate(d: Date, time: string): string {
  return buildLocalDateTime(formatLocalDateFromDate(d), time);
}

export function sessionOnDate(value: string, dateKey: string): boolean {
  return sessionDateKey(value) === dateKey;
}

export function sessionInMonth(value: string, monthKey: string): boolean {
  return sessionDateKey(value).startsWith(monthKey);
}

export function localDateTimeInputValue(reference = new Date()): string {
  const d = new Date(reference);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function toDateTimeLocalInput(value: string): string {
  const d = parseScheduledAt(value);
  if (Number.isNaN(d.getTime())) return value.slice(0, 16);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

/** Replace time portion of a local datetime string. */
export function withLocalTime(iso: string, hhmm: string): string {
  return `${sessionDateKey(iso)}T${hhmm}`;
}
