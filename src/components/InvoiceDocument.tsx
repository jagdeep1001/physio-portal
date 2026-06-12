import type { Invoice } from '../lib/invoice';
import { formatInvoiceCurrency, formatInvoiceDate } from '../lib/invoice';

export function InvoiceDocument({ invoice }: { invoice: Invoice }) {
  const clinic = invoice.clinic ?? { name: 'PhysioCare', address: '', phone: '' };

  return (
    <div className="invoice-document">
      <header className="invoice-doc-header">
        <div>
          <h1 className="invoice-doc-clinic">{clinic.name}</h1>
          {clinic.address && <p className="invoice-doc-meta">{clinic.address}</p>}
          {clinic.phone && <p className="invoice-doc-meta">Phone: {clinic.phone}</p>}
        </div>
        <div className="invoice-doc-meta-block">
          <p className="invoice-doc-title">INVOICE</p>
          <p className="invoice-doc-meta"># {invoice.invoiceNumber}</p>
          <p className="invoice-doc-meta">Issued: {formatInvoiceDate(invoice.issuedAt)}</p>
        </div>
      </header>

      <section className="invoice-doc-bill-to">
        <h2>Bill to</h2>
        <p className="invoice-doc-patient-name">{invoice.patient.name}</p>
        {invoice.patient.phone && <p>{invoice.patient.phone}</p>}
        {invoice.patient.address && <p>{invoice.patient.address}</p>}
      </section>

      {invoice.period && (
        <p className="invoice-doc-period">
          Billing period: {formatInvoiceDate(invoice.period.from)} – {formatInvoiceDate(invoice.period.to)}
        </p>
      )}

      <table className="invoice-doc-table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th>Charge</th>
            <th>Paid</th>
            <th>Balance</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((item) => (
            <tr key={item.sessionId}>
              <td>{item.date}</td>
              <td>{item.description}</td>
              <td className="invoice-doc-amount">{formatInvoiceCurrency(item.amount)}</td>
              <td className="invoice-doc-amount">{formatInvoiceCurrency(item.paid)}</td>
              <td className="invoice-doc-amount">{formatInvoiceCurrency(item.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="invoice-doc-totals">
        <div className="invoice-doc-totals-box">
          <div><span>Subtotal</span><strong>{formatInvoiceCurrency(invoice.subtotal)}</strong></div>
          <div><span>Paid</span><strong>{formatInvoiceCurrency(invoice.paidTotal)}</strong></div>
          <div><span>Balance due</span><strong>{formatInvoiceCurrency(invoice.balanceDue)}</strong></div>
          <div><span>Available credit</span><strong>{formatInvoiceCurrency(invoice.credit)}</strong></div>
        </div>
      </div>

      {invoice.notes && (
        <div className="invoice-doc-notes">
          <strong>Notes</strong>
          <p>{invoice.notes}</p>
        </div>
      )}

      <footer className="invoice-doc-footer">Thank you for choosing {clinic.name}.</footer>
    </div>
  );
}
