import { FileText, Printer, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Clinic, Patient, PaymentRecord, Profile, TherapySession } from '../types';
import { sessionDateKey } from '../lib/datetime';
import { formatTherapyTypeDisplay } from '../lib/therapy';
import { InvoiceDocument } from './InvoiceDocument';
import {
  buildPeriodInvoice,
  buildSessionInvoice,
  formatInvoiceCurrency,
  formatInvoiceDate,
  getBillableSessions,
  getMonthDateRange,
  openInvoicePreviewTab,
  openInvoicePrintWindow,
  type Invoice,
  type InvoiceMode,
} from '../lib/invoice';

export interface InvoiceModalProps {
  patient: Patient;
  sessions: TherapySession[];
  payments: PaymentRecord[];
  clinics: Clinic[];
  profiles: Profile[];
  initialMode?: InvoiceMode;
  initialSessionId?: string;
  onClose: () => void;
}

export function InvoiceModal({
  patient,
  sessions,
  payments,
  clinics,
  profiles,
  initialMode = 'period',
  initialSessionId,
  onClose,
}: InvoiceModalProps) {
  const defaultRange = getMonthDateRange();
  const billableAll = useMemo(
    () => getBillableSessions(sessions, patient.id),
    [sessions, patient.id]
  );

  const [mode, setMode] = useState<InvoiceMode>(initialMode);
  const [fromDate, setFromDate] = useState(defaultRange.from);
  const [toDate, setToDate] = useState(defaultRange.to);
  const [sessionId, setSessionId] = useState(
    initialSessionId ?? billableAll[billableAll.length - 1]?.id ?? ''
  );
  const [notes, setNotes] = useState('');
  const [printError, setPrintError] = useState('');

  const billableInRange = useMemo(
    () => getBillableSessions(sessions, patient.id, fromDate, toDate),
    [sessions, patient.id, fromDate, toDate]
  );

  const selectedSession = sessions.find((s) => s.id === sessionId);

  const invoice: Invoice | null = useMemo(() => {
    if (mode === 'period') {
      return buildPeriodInvoice(patient, sessions, payments, clinics, profiles, fromDate, toDate, notes);
    }
    if (!selectedSession) return null;
    return buildSessionInvoice(patient, selectedSession, sessions, payments, clinics, profiles, notes);
  }, [mode, patient, sessions, payments, clinics, profiles, fromDate, toDate, notes, selectedSession]);

  const handlePrint = () => {
    if (!invoice) return;
    setPrintError('');
    try {
      openInvoicePrintWindow(invoice);
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Unable to open print dialog.');
    }
  };

  const handleOpenTab = () => {
    if (!invoice) return;
    setPrintError('');
    try {
      openInvoicePreviewTab(invoice);
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Unable to open invoice tab.');
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-panel invoice-modal-panel">
        <div className="modal-accent modal-accent-teal" />
        <div className="modal-header">
          <div className="modal-header-icon"><FileText size={18} /></div>
          <div>
            <h3 className="modal-title">Generate invoice</h3>
            <p className="modal-sub">{patient.name}</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body invoice-modal-body">
          <div className="invoice-mode-toggle">
            <button
              type="button"
              className={mode === 'period' ? 'primary-button' : 'ghost-button'}
              onClick={() => setMode('period')}
            >
              Period statement
            </button>
            <button
              type="button"
              className={mode === 'single' ? 'primary-button' : 'ghost-button'}
              onClick={() => setMode('single')}
            >
              Single session
            </button>
          </div>

          {mode === 'period' ? (
            <div className="invoice-filters">
              <label>
                From
                <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </label>
              <label>
                To
                <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </label>
              <div className="invoice-filter-summary">
                <strong>{billableInRange.length}</strong>
                <span>billable session{billableInRange.length === 1 ? '' : 's'}</span>
                {billableInRange.length > 0 && (
                  <span className="invoice-filter-total">
                    Total {formatInvoiceCurrency(billableInRange.reduce((sum, s) => sum + (s.amountCollected ?? 0), 0))}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <label>
              Session
              <select value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
                {billableAll.length === 0 && <option value="">No billable sessions</option>}
                {billableAll.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatInvoiceDate(sessionDateKey(s.scheduledAt))} · {formatTherapyTypeDisplay(s.therapyType)} · {formatInvoiceCurrency(s.amountCollected)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label>
            Notes (optional)
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Payment terms, reference number, etc."
            />
          </label>

          {!invoice ? (
            <div className="invoice-empty-state">
              Complete sessions and set session fees first.
            </div>
          ) : (
            <div className="invoice-preview-wrap">
              <p className="invoice-preview-label">Preview</p>
              <InvoiceDocument invoice={invoice} />
            </div>
          )}

          {printError && <p className="form-error">{printError}</p>}
          {invoice && !printError && (
            <p className="invoice-print-hint">
              Click <strong>Print / Save PDF</strong>, then choose &quot;Save as PDF&quot; as the destination in the print dialog.
            </p>
          )}
        </div>

        <div className="modal-footer">
          <button className="ghost-button" type="button" onClick={onClose}>
            <X size={14} /> Close
          </button>
          <button
            className="secondary-button"
            type="button"
            disabled={!invoice}
            onClick={handleOpenTab}
          >
            <FileText size={14} /> Open in tab
          </button>
          <button
            className="primary-button"
            type="button"
            disabled={!invoice}
            onClick={handlePrint}
          >
            <Printer size={14} /> Print / Save PDF
          </button>
        </div>
      </div>
    </div>
  );
}
