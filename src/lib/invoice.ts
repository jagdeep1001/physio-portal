import type { Clinic, Patient, Profile, TherapySession } from '../types';
import type { PaymentRecord } from '../types';
import { sessionDateKey } from '../lib/datetime';
import { formatTherapyTypeDisplay } from '../lib/therapy';
import { paidForSession, patientCredit, sessionBalance, sessionFee } from './payments';

export interface InvoiceLineItem {
  sessionId: string;
  date: string;
  description: string;
  amount: number;
  paid: number;
  balance: number;
}

export interface InvoiceClinicInfo {
  name: string;
  address: string;
  phone: string;
}

export interface Invoice {
  invoiceNumber: string;
  issuedAt: string;
  clinic: InvoiceClinicInfo | null;
  patient: { name: string; phone: string; address: string };
  period?: { from: string; to: string };
  lineItems: InvoiceLineItem[];
  subtotal: number;
  paidTotal: number;
  balanceDue: number;
  credit: number;
  notes?: string;
}

export type InvoiceMode = 'period' | 'single';

const FALLBACK_CLINIC: InvoiceClinicInfo = {
  name: 'PhysioCare',
  address: '',
  phone: '',
};

export function formatInvoiceCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatInvoiceDate(value: string): string {
  if (!value) return '';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(value.length === 10 ? `${value}T12:00:00` : value));
}

export function generateInvoiceNumber(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `INV-${date}-${suffix}`;
}

export function getMonthDateRange(reference = new Date()): { from: string; to: string } {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const from = new Date(year, month, 1).toISOString().slice(0, 10);
  const to = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  return { from, to };
}

export function getBillableSessions(
  sessions: TherapySession[],
  patientId: string,
  from?: string,
  to?: string
): TherapySession[] {
  return sessions
    .filter((s) => s.patientId === patientId)
    .filter((s) => s.status === 'completed' && sessionFee(s) > 0)
    .filter((s) => {
      const date = sessionDateKey(s.scheduledAt);
      if (from && date < from) return false;
      if (to && date > to) return false;
      return true;
    })
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

function therapyLevelLabel(level: TherapySession['therapyLevel']): string {
  if (level === 'advance') return 'Advance';
  if (level === 'rehab') return 'Rehab';
  return 'Basic';
}

export function sessionToLineItem(session: TherapySession, profiles: Profile[], payments: PaymentRecord[]): InvoiceLineItem {
  const sessionType = session.sessionType === 'home' ? 'Home visit' : 'Clinic';
  const staff = profiles.find((p) => p.id === session.assignedStaffId);
  const staffPart = staff ? ` · ${staff.name}` : '';
  const therapyPart = formatTherapyTypeDisplay(session.therapyType) || 'Physiotherapy session';
  const description = `${sessionType} · ${therapyLevelLabel(session.therapyLevel)} · ${therapyPart}${staffPart}`;

  return {
    sessionId: session.id,
    date: formatInvoiceDate(sessionDateKey(session.scheduledAt)),
    description,
    amount: sessionFee(session),
    paid: paidForSession(session.id, payments),
    balance: sessionBalance(session, payments),
  };
}

function resolveClinic(
  patient: Patient,
  sessions: TherapySession[],
  clinics: Clinic[]
): InvoiceClinicInfo | null {
  if (patient.clinicId) {
    const clinic = clinics.find((c) => c.id === patient.clinicId);
    if (clinic) {
      return { name: clinic.name, address: clinic.address, phone: clinic.phone };
    }
  }

  const sessionClinicId = sessions.find((s) => s.clinicId)?.clinicId;
  if (sessionClinicId) {
    const clinic = clinics.find((c) => c.id === sessionClinicId);
    if (clinic) {
      return { name: clinic.name, address: clinic.address, phone: clinic.phone };
    }
  }

  return FALLBACK_CLINIC;
}

function buildInvoiceBase(
  patient: Patient,
  lineItems: InvoiceLineItem[],
  sessions: TherapySession[],
  payments: PaymentRecord[],
  clinics: Clinic[],
  notes?: string,
  period?: { from: string; to: string }
): Invoice | null {
  if (lineItems.length === 0) return null;

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
  const paidTotal = lineItems.reduce((sum, item) => sum + item.paid, 0);

  return {
    invoiceNumber: generateInvoiceNumber(),
    issuedAt: new Date().toISOString().slice(0, 10),
    clinic: resolveClinic(patient, sessions, clinics),
    patient: {
      name: patient.name,
      phone: patient.phone,
      address: patient.address,
    },
    period,
    lineItems,
    subtotal,
    paidTotal,
    balanceDue: Math.max(0, subtotal - paidTotal),
    credit: patientCredit(patient.id, payments),
    notes: notes?.trim() || undefined,
  };
}

export function buildPeriodInvoice(
  patient: Patient,
  sessions: TherapySession[],
  payments: PaymentRecord[],
  clinics: Clinic[],
  profiles: Profile[],
  from: string,
  to: string,
  notes?: string
): Invoice | null {
  const billable = getBillableSessions(sessions, patient.id, from, to);
  const lineItems = billable.map((s) => sessionToLineItem(s, profiles, payments));
  return buildInvoiceBase(
    patient,
    lineItems,
    billable,
    payments,
    clinics,
    notes,
    { from, to }
  );
}

export function buildSessionInvoice(
  patient: Patient,
  session: TherapySession,
  sessions: TherapySession[],
  payments: PaymentRecord[],
  clinics: Clinic[],
  profiles: Profile[],
  notes?: string
): Invoice | null {
  if (session.status !== 'completed' || sessionFee(session) <= 0) return null;
  const lineItems = [sessionToLineItem(session, profiles, payments)];
  return buildInvoiceBase(patient, lineItems, [session], payments, clinics, notes);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderInvoiceHtml(invoice: Invoice): string {
  const clinic = invoice.clinic ?? FALLBACK_CLINIC;
  const periodLine = invoice.period
    ? `<p class="invoice-period">Billing period: ${escapeHtml(formatInvoiceDate(invoice.period.from))} – ${escapeHtml(formatInvoiceDate(invoice.period.to))}</p>`
    : '';

  const rows = invoice.lineItems
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.date)}</td>
          <td>${escapeHtml(item.description)}</td>
          <td class="amount">${escapeHtml(formatInvoiceCurrency(item.amount))}</td>
          <td class="amount">${escapeHtml(formatInvoiceCurrency(item.paid))}</td>
          <td class="amount">${escapeHtml(formatInvoiceCurrency(item.balance))}</td>
        </tr>`
    )
    .join('');

  const notesBlock = invoice.notes
    ? `<div class="invoice-notes"><strong>Notes</strong><p>${escapeHtml(invoice.notes)}</p></div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: Inter, system-ui, -apple-system, sans-serif;
      color: #0f1e24;
      margin: 0;
      padding: 24px;
      background: #fff;
    }
    .invoice-header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 3px solid #0e9f8e;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .clinic-name { font-size: 22px; font-weight: 800; color: #0a7a6d; margin: 0 0 6px; }
    .clinic-meta { font-size: 12px; color: #475569; line-height: 1.5; margin: 0; }
    .invoice-meta { text-align: right; }
    .invoice-title { font-size: 28px; font-weight: 800; letter-spacing: 0.08em; color: #0f1e24; margin: 0; }
    .invoice-number, .invoice-date { font-size: 12px; color: #475569; margin: 4px 0 0; }
    .bill-to { margin-bottom: 20px; }
    .bill-to h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; margin: 0 0 8px; }
    .bill-to p { margin: 0; line-height: 1.5; }
    .bill-to strong { font-size: 16px; color: #0f1e24; }
    .invoice-period { font-size: 13px; color: #475569; margin: 0 0 16px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
    th {
      text-align: left;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      border-bottom: 2px solid #e2e8f0;
      padding: 10px 8px;
    }
    th.amount, td.amount { text-align: right; }
    td { padding: 12px 8px; border-bottom: 1px solid #e2e8f0; font-size: 13px; vertical-align: top; }
    .totals { display: flex; justify-content: flex-end; margin-bottom: 24px; }
    .totals-box {
      min-width: 220px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 14px 16px;
      background: #f8fafc;
    }
    .totals-row { display: flex; justify-content: space-between; gap: 24px; font-size: 14px; margin-bottom: 8px; }
    .totals-row strong { font-size: 18px; color: #0a7a6d; }
    .invoice-notes { margin-bottom: 20px; font-size: 13px; color: #475569; }
    .invoice-notes p { margin: 6px 0 0; }
    .invoice-footer {
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e2e8f0;
      font-size: 12px;
      color: #64748b;
      text-align: center;
    }
    @media print {
      body { padding: 0; }
    }
  </style>
</head>
<body>
  <header class="invoice-header">
    <div>
      <h1 class="clinic-name">${escapeHtml(clinic.name)}</h1>
      <p class="clinic-meta">
        ${clinic.address ? `${escapeHtml(clinic.address)}<br />` : ''}
        ${clinic.phone ? `Phone: ${escapeHtml(clinic.phone)}` : ''}
      </p>
    </div>
    <div class="invoice-meta">
      <p class="invoice-title">INVOICE</p>
      <p class="invoice-number"># ${escapeHtml(invoice.invoiceNumber)}</p>
      <p class="invoice-date">Issued: ${escapeHtml(formatInvoiceDate(invoice.issuedAt))}</p>
    </div>
  </header>

  <section class="bill-to">
    <h2>Bill to</h2>
    <p><strong>${escapeHtml(invoice.patient.name)}</strong></p>
    ${invoice.patient.phone ? `<p>${escapeHtml(invoice.patient.phone)}</p>` : ''}
    ${invoice.patient.address ? `<p>${escapeHtml(invoice.patient.address)}</p>` : ''}
  </section>

  ${periodLine}

  <table>
    <thead>
      <tr>
        <th>Date</th>
        <th>Description</th>
        <th class="amount">Charge</th>
        <th class="amount">Paid</th>
        <th class="amount">Balance</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="totals">
    <div class="totals-box">
      <div class="totals-row">
        <span>Subtotal</span>
        <strong>${escapeHtml(formatInvoiceCurrency(invoice.subtotal))}</strong>
      </div>
      <div class="totals-row">
        <span>Paid</span>
        <strong>${escapeHtml(formatInvoiceCurrency(invoice.paidTotal))}</strong>
      </div>
      <div class="totals-row">
        <span>Balance due</span>
        <strong>${escapeHtml(formatInvoiceCurrency(invoice.balanceDue))}</strong>
      </div>
      <div class="totals-row">
        <span>Available credit</span>
        <strong>${escapeHtml(formatInvoiceCurrency(invoice.credit))}</strong>
      </div>
    </div>
  </div>

  ${notesBlock}

  <footer class="invoice-footer">
    Thank you for choosing ${escapeHtml(clinic.name)}.
  </footer>
</body>
</html>`;
}

export function openInvoicePrintWindow(invoice: Invoice): void {
  const html = renderInvoiceHtml(invoice);

  const iframe = document.createElement('iframe');
  iframe.setAttribute('title', `Invoice ${invoice.invoiceNumber}`);
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden;';
  document.body.appendChild(iframe);

  const frameWindow = iframe.contentWindow;
  const frameDoc = frameWindow?.document;
  if (!frameWindow || !frameDoc) {
    iframe.remove();
    throw new Error('Unable to prepare the print preview.');
  }

  frameDoc.open();
  frameDoc.write(html);
  frameDoc.close();

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 1000);
  };

  try {
    frameWindow.focus();
    frameWindow.print();
  } catch {
    iframe.remove();
    throw new Error('Unable to open the print dialog.');
  }

  cleanup();
}

/** Opens invoice in a new tab (for viewing without printing). */
export function openInvoicePreviewTab(invoice: Invoice): void {
  const html = renderInvoiceHtml(invoice);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, '_blank');
  if (!tab) {
    URL.revokeObjectURL(url);
    throw new Error('Pop-up blocked. Allow pop-ups to open the invoice in a new tab.');
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
