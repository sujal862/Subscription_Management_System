import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import { formatMoney } from '../../../../shared/money';
import './billing.css';

interface CustomerInvoiceLine {
  id: string;
  productId: string;
  description: string;
  quantity: number;
  unitPriceMinor: number;
  discountMinor: number;
  taxRateBps: number;
  taxMinor: number;
  amountMinor: number;
}

interface CustomerInvoicePayment {
  id: string;
  amountMinor: number;
  method: string;
  paidAt: string;
  reference?: string | null;
  note?: string | null;
}

interface CustomerInvoice {
  id: string;
  number: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  customerAddress?: string | null;
  status: 'DRAFT' | 'CONFIRMED' | 'PAID' | 'CANCELLED';
  periodStart: string;
  periodEnd: string;
  issuedAt: string;
  dueDate: string;
  subtotalMinor: number;
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
  paidAmountMinor: number;
  remainingBalanceMinor: number;
  isOverdue?: boolean;
  sentAt?: string | null;
  lines?: CustomerInvoiceLine[];
  payments?: CustomerInvoicePayment[];
  discountRedemptions?: Array<{
    amountMinor: number;
    discount: { name: string; kind: string; value: number };
  }>;
}

interface CustomerInvoicesResponse {
  items: CustomerInvoice[];
  page: number;
  pageSize: number;
  total: number;
}

export function CustomerInvoicesPage() {
  const [searchParams] = useSearchParams();
  const [invoices, setInvoices] = useState<CustomerInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedInvoice, setSelectedInvoice] = useState<CustomerInvoice | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', '20');
      if (statusFilter !== 'ALL') {
        params.set('status', statusFilter);
      }

      const res = await api<CustomerInvoicesResponse>(`/portal/invoices?${params.toString()}`);
      setInvoices(res.items);
      setTotalCount(res.total);

      // Handle query param invoice ID if present
      const invoiceIdParam = searchParams.get('id');
      if (invoiceIdParam) {
        const match = res.items.find(i => i.id === invoiceIdParam);
        if (match) {
          const detail = await api<CustomerInvoice>(`/portal/invoices/${match.id}`);
          setSelectedInvoice(detail);
          if (searchParams.get('print')) {
            setTimeout(() => window.print(), 300);
          }
        }
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, searchParams]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const openInvoiceDetail = async (invoiceId: string, autoPrint = false) => {
    try {
      const detail = await api<CustomerInvoice>(`/portal/invoices/${invoiceId}`);
      setSelectedInvoice(detail);
      if (autoPrint) {
        setTimeout(() => window.print(), 300);
      }
    } catch (err) {
      alert(`Could not load invoice: ${errorMessage(err)}`);
    }
  };

  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.totalMinor, 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + inv.paidAmountMinor, 0);
  const totalOutstanding = invoices.reduce((sum, inv) => sum + inv.remainingBalanceMinor, 0);

  return (
    <div className="billing-container">
      <div className="page-heading no-print">
        <div>
          <span className="eyebrow">Customer Portal</span>
          <h1>Your invoices</h1>
          <p className="subtitle">
            View your active and historical subscription invoices, payments, and balances.
          </p>
        </div>
      </div>

      <div className="billing-stats-grid no-print">
        <div className="stat-card">
          <span className="stat-label">Total Invoiced (Page)</span>
          <span className="stat-value">{formatMoney(totalInvoiced)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Paid (Page)</span>
          <span className="stat-value" style={{ color: '#03543f' }}>{formatMoney(totalPaid)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Outstanding Balance (Page)</span>
          <span
            className="stat-value"
            style={{ color: totalOutstanding > 0 ? '#b91c1c' : '#03543f' }}
          >
            {formatMoney(totalOutstanding)}
          </span>
        </div>
      </div>

      <div className="billing-controls no-print">
        <div className="filter-group">
          <label htmlFor="portal-status-filter" style={{ fontSize: '0.88rem', fontWeight: 500 }}>
            Status:
          </label>
          <select
            id="portal-status-filter"
            className="filter-select"
            value={statusFilter}
            onChange={e => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="CONFIRMED">Confirmed (Pending Payment)</option>
            <option value="PAID">Paid</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>

        <button className="btn-secondary" onClick={() => fetchInvoices()} disabled={loading}>
          ↻ Refresh
        </button>
      </div>

      {error && (
        <div className="error-banner no-print" style={{ padding: '12px 16px', background: '#fde8e8', color: '#9b1c1c', borderRadius: 8 }}>
          {error}
        </div>
      )}

      <div className="billing-table-panel no-print">
        {loading && invoices.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
            Loading your invoices...
          </div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: 48, textAlign: 'center', color: 'var(--muted)' }}>
            <h3 style={{ margin: '0 0 8px', color: 'var(--dark)' }}>No invoices found</h3>
            <p style={{ margin: 0 }}>You do not have any invoices under this filter.</p>
          </div>
        ) : (
          <>
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Invoice Number</th>
                  <th>Issued Date</th>
                  <th>Due Date</th>
                  <th>Status</th>
                  <th>Total</th>
                  <th>Balance Due</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td>
                      <button
                        onClick={() => openInvoiceDetail(inv.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'var(--green)',
                          fontWeight: 600,
                          cursor: 'pointer',
                          padding: 0,
                          textDecoration: 'underline',
                          fontSize: 'inherit',
                        }}
                      >
                        {inv.number}
                      </button>
                    </td>
                    <td>
                      {new Date(inv.issuedAt).toLocaleDateString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                      })}
                    </td>
                    <td>
                      {new Date(inv.dueDate).toLocaleDateString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                      })}
                      {inv.isOverdue && (
                        <span
                          style={{
                            marginLeft: 6,
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: '#b91c1c',
                            background: '#fee2e2',
                            padding: '2px 5px',
                            borderRadius: 4,
                          }}
                        >
                          OVERDUE
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge status-${inv.status}`}>{inv.status}</span>
                    </td>
                    <td>
                      <strong>{formatMoney(inv.totalMinor)}</strong>
                    </td>
                    <td>
                      {inv.remainingBalanceMinor > 0 ? (
                        <span style={{ color: '#92400e', fontWeight: 600 }}>
                          {formatMoney(inv.remainingBalanceMinor)}
                        </span>
                      ) : (
                        <span style={{ color: '#03543f', fontWeight: 600 }}>Paid in Full</span>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        className="btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.8rem', marginRight: 6 }}
                        onClick={() => openInvoiceDetail(inv.id)}
                      >
                        View
                      </button>
                      <button
                        className="btn-secondary"
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                        onClick={() => openInvoiceDetail(inv.id, true)}
                      >
                        🖨 Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination-bar">
              <span>
                Showing {invoices.length} of {totalCount} invoices
              </span>
              <div className="pagination-controls">
                <button
                  className="btn-secondary"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <span style={{ alignSelf: 'center', padding: '0 8px' }}>Page {page}</span>
                <button
                  className="btn-secondary"
                  disabled={page * 20 >= totalCount || loading}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Invoice Detail / Printable View Modal */}
      {selectedInvoice && (
        <div className="modal-overlay printable-modal-overlay" onClick={() => setSelectedInvoice(null)}>
          <div className="modal-content printable-invoice-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header no-print">
              <div>
                <h2>Invoice {selectedInvoice.number}</h2>
                <span className={`status-badge status-${selectedInvoice.status}`} style={{ marginTop: 4 }}>
                  {selectedInvoice.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn-primary"
                  onClick={() => window.print()}
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                >
                  🖨 Print Invoice
                </button>
                <button className="btn-secondary" onClick={() => setSelectedInvoice(null)}>
                  ✕ Close
                </button>
              </div>
            </div>

            {/* Printable Area */}
            <div className="printable-body" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Printable Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid var(--border)', paddingBottom: 16 }}>
                <div>
                  <h1 style={{ margin: '0 0 4px', fontSize: '1.5rem', color: 'var(--green)' }}>
                    Brightloop Software
                  </h1>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted)' }}>
                    Subscription Management Platform &bull; Tax Invoice
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <h2 style={{ margin: '0 0 4px', fontSize: '1.2rem', color: 'var(--dark)' }}>
                    {selectedInvoice.number}
                  </h2>
                  <span className={`status-badge status-${selectedInvoice.status}`}>
                    {selectedInvoice.status}
                  </span>
                </div>
              </div>

              {/* Customer and Dates Snapshot */}
              <div className="snapshot-grid">
                <div className="snapshot-item">
                  <h4>Billed To</h4>
                  <p><strong>{selectedInvoice.customerName}</strong></p>
                  <p className="muted" style={{ fontSize: '0.85rem' }}>{selectedInvoice.customerEmail}</p>
                  {selectedInvoice.customerAddress && (
                    <p className="muted" style={{ fontSize: '0.82rem' }}>{selectedInvoice.customerAddress}</p>
                  )}
                </div>
                <div className="snapshot-item">
                  <h4>Invoice Details</h4>
                  <p>
                    <strong>Issued Date:</strong>{' '}
                    {new Date(selectedInvoice.issuedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </p>
                  <p>
                    <strong>Due Date:</strong>{' '}
                    {new Date(selectedInvoice.dueDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </p>
                  <p className="muted" style={{ fontSize: '0.82rem' }}>
                    Billing Period: {new Date(selectedInvoice.periodStart).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} to{' '}
                    {new Date(selectedInvoice.periodEnd).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </p>
                </div>
              </div>

              {/* Line Items Table */}
              <div>
                <h3 style={{ fontSize: '1rem', marginBottom: 10 }}>Line Items</h3>
                <table className="billing-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Unit Price</th>
                      <th>Tax Rate</th>
                      <th>Tax</th>
                      <th style={{ textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedInvoice.lines && selectedInvoice.lines.length > 0 ? (
                      selectedInvoice.lines.map(line => (
                        <tr key={line.id}>
                          <td>{line.description}</td>
                          <td>{line.quantity}</td>
                          <td>{formatMoney(line.unitPriceMinor)}</td>
                          <td>{(line.taxRateBps / 100).toFixed(2)}%</td>
                          <td>{formatMoney(line.taxMinor)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <strong>{formatMoney(line.amountMinor)}</strong>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)' }}>
                          No lines captured.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Recorded Payments Table */}
              {selectedInvoice.payments && selectedInvoice.payments.length > 0 && (
                <div>
                  <h3 style={{ fontSize: '1rem', marginBottom: 10 }}>Recorded Payments</h3>
                  <table className="billing-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Method</th>
                        <th>Reference</th>
                        <th style={{ textAlign: 'right' }}>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInvoice.payments.map(payment => (
                        <tr key={payment.id}>
                          <td>
                            {new Date(payment.paidAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                          </td>
                          <td>{payment.method}</td>
                          <td>{payment.reference || '—'}</td>
                          <td style={{ textAlign: 'right', color: '#03543f', fontWeight: 600 }}>
                            {formatMoney(payment.amountMinor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Totals Summary */}
              <div className="modal-totals">
                <div>Subtotal: <strong>{formatMoney(selectedInvoice.subtotalMinor)}</strong></div>
                {selectedInvoice.discountMinor > 0 ? (
                  <div style={{ color: '#03543f' }}>
                    Discount {selectedInvoice.discountRedemptions && selectedInvoice.discountRedemptions.length > 0 ? `(${selectedInvoice.discountRedemptions[0].discount.name})` : ''}: -{formatMoney(selectedInvoice.discountMinor)}
                  </div>
                ) : (
                  <div>Discount: <span>₹0.00</span></div>
                )}
                <div>Tax Total: <span>{formatMoney(selectedInvoice.taxMinor)}</span></div>
                <div className="grand-total">
                  Total: {formatMoney(selectedInvoice.totalMinor)}
                </div>
                {selectedInvoice.paidAmountMinor > 0 && (
                  <div style={{ color: '#03543f' }}>
                    Total Paid: -{formatMoney(selectedInvoice.paidAmountMinor)}
                  </div>
                )}
                <div style={{
                  fontSize: '1.05rem',
                  fontWeight: 700,
                  marginTop: 6,
                  color: selectedInvoice.remainingBalanceMinor > 0 ? '#b91c1c' : '#03543f',
                }}>
                  {selectedInvoice.remainingBalanceMinor > 0
                    ? `Balance Due: ${formatMoney(selectedInvoice.remainingBalanceMinor)}`
                    : 'Balance Due: ₹0.00 (Paid in Full)'}
                </div>
              </div>

              {/* Printable Footer */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 14, fontSize: '0.8rem', color: 'var(--muted)', textAlign: 'center' }}>
                Brightloop Software &bull; Thank you for your business! &bull; For billing queries contact support@brightloop.com
              </div>
            </div>

            <div className="modal-footer no-print">
              <button className="btn-secondary" onClick={() => setSelectedInvoice(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
