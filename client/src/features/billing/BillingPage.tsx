import { useState, useEffect, useCallback } from 'react';
import { api, errorMessage } from '../../lib/api';
import { formatMoney } from '../../../../shared/money';
import './billing.css';

interface InvoiceLineItem {
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

interface InvoicePayment {
  id: string;
  amountMinor: number;
  method: string;
  paidAt: string;
  reference?: string | null;
  note?: string | null;
}

interface DiscountRedemptionItem {
  id: string;
  amountMinor: number;
  discount: {
    id: string;
    name: string;
    kind: string;
    value: number;
  };
}

interface InvoiceItem {
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
  isOverdue: boolean;
  lines?: InvoiceLineItem[];
  payments?: InvoicePayment[];
  discountRedemptions?: DiscountRedemptionItem[];
}

interface InvoicesResponse {
  items: InvoiceItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface BillingRunResponse {
  targetDate: string;
  processedSubscriptions: number;
  invoicesCreated: number;
  skippedDuplicates: number;
  errors: Array<{ subscriptionId: string; subscriptionNumber: string; error: string }>;
}

export function BillingPage() {
  const [invoices, setInvoices] = useState<InvoiceItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Billing Run modal & state
  const [runningBilling, setRunningBilling] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [showRunModal, setShowRunModal] = useState(false);
  const [runTargetDate, setRunTargetDate] = useState<string>(new Date().toISOString().split('T')[0]);

  // Payment Recording modal & state
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [paymentAmountMajor, setPaymentAmountMajor] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<string>('BANK_TRANSFER');
  const [paymentReference, setPaymentReference] = useState<string>('');
  const [paymentNote, setPaymentNote] = useState<string>('');
  const [paymentDate, setPaymentDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [recordingPayment, setRecordingPayment] = useState(false);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const queryParams = new URLSearchParams();
      queryParams.set('page', String(page));
      queryParams.set('pageSize', '20');
      if (overdueOnly) {
        queryParams.set('overdue', 'true');
      } else if (statusFilter !== 'ALL') {
        queryParams.set('status', statusFilter);
      }
      const data = await api<InvoicesResponse>(`/billing/invoices?${queryParams.toString()}`);
      setInvoices(data.items);
      setTotalCount(data.total);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, statusFilter, overdueOnly]);

  useEffect(() => {
    fetchInvoices();
  }, [fetchInvoices]);

  const viewInvoiceDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const data = await api<InvoiceItem>(`/billing/invoices/${id}`);
      setSelectedInvoice(data);
    } catch (err) {
      alert(`Could not load invoice: ${errorMessage(err)}`);
    } finally {
      setDetailLoading(false);
    }
  };

  const openPaymentModal = (invoice: InvoiceItem) => {
    setSelectedInvoice(invoice);
    setPaymentAmountMajor((invoice.remainingBalanceMinor / 100).toFixed(2));
    setPaymentMethod('BANK_TRANSFER');
    setPaymentReference('');
    setPaymentNote('');
    setPaymentDate(new Date().toISOString().split('T')[0]);
    setShowPaymentModal(true);
  };

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedInvoice) return;

    const parsed = parseFloat(paymentAmountMajor);
    const amountMinor = Math.round(parsed * 100);
    if (isNaN(parsed) || amountMinor <= 0) {
      alert('Please enter a valid positive payment amount');
      return;
    }
    if (amountMinor > selectedInvoice.remainingBalanceMinor) {
      alert(`Amount exceeds remaining balance of ${formatMoney(selectedInvoice.remainingBalanceMinor)}`);
      return;
    }

    setRecordingPayment(true);
    try {
      await api(`/billing/invoices/${selectedInvoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          method: paymentMethod,
          amountMinor,
          paidAt: paymentDate ? `${paymentDate}T12:00:00.000Z` : undefined,
          reference: paymentReference.trim() || undefined,
          note: paymentNote.trim() || undefined,
        }),
      });

      setShowPaymentModal(false);
      await fetchInvoices();
      const updated = await api<InvoiceItem>(`/billing/invoices/${selectedInvoice.id}`);
      setSelectedInvoice(updated);
    } catch (err) {
      alert(`Payment recording failed: ${errorMessage(err)}`);
    } finally {
      setRecordingPayment(false);
    }
  };

  const handleConfirmInvoice = async (id: string) => {
    if (!confirm('Are you sure you want to confirm this invoice?')) return;
    setActionLoading(true);
    try {
      const updated = await api<InvoiceItem>(`/billing/invoices/${id}/confirm`, { method: 'POST' });
      setSelectedInvoice(updated);
      await fetchInvoices();
    } catch (err) {
      alert(`Could not confirm invoice: ${errorMessage(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancelInvoice = async (id: string) => {
    if (!confirm('Are you sure you want to cancel this invoice? This cannot be undone.')) return;
    setActionLoading(true);
    try {
      const updated = await api<InvoiceItem>(`/billing/invoices/${id}/cancel`, { method: 'POST' });
      setSelectedInvoice(updated);
      await fetchInvoices();
    } catch (err) {
      alert(`Could not cancel invoice: ${errorMessage(err)}`);
    } finally {
      setActionLoading(false);
    }
  };

  const executeBillingRun = async () => {
    setRunningBilling(true);
    setRunMessage(null);
    try {
      const res = await api<BillingRunResponse>('/billing/run', {
        method: 'POST',
        body: JSON.stringify({
          targetDate: runTargetDate ? `${runTargetDate}T23:59:59.999Z` : undefined,
        }),
      });
      setRunMessage(
        `✓ Billing cycle processed: ${res.processedSubscriptions} subscriptions checked, ${res.invoicesCreated} invoices created, ${res.skippedDuplicates} duplicates skipped.`
      );
      setShowRunModal(false);
      await fetchInvoices();
    } catch (err) {
      alert(`Billing run failed: ${errorMessage(err)}`);
    } finally {
      setRunningBilling(false);
    }
  };

  const totalInvoiced = invoices.reduce((sum, inv) => sum + inv.totalMinor, 0);
  const totalPaid = invoices.reduce((sum, inv) => sum + inv.paidAmountMinor, 0);
  const totalOutstanding = invoices.reduce((sum, inv) => sum + inv.remainingBalanceMinor, 0);

  return (
    <div className="billing-container">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Finance & Operations</span>
          <h1>Invoices & Billing</h1>
          <p className="muted">
            Manage recurring invoices, line calculations, snapshot records and customer payment balances.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn-secondary" onClick={() => fetchInvoices()} disabled={loading}>
            {loading ? 'Refreshing...' : '↻ Refresh'}
          </button>
          <button className="btn-primary" onClick={() => setShowRunModal(true)} disabled={runningBilling}>
            ⚡ Run Billing Engine
          </button>
        </div>
      </div>

      {runMessage && (
        <div className="notice" style={{ background: '#eaf4e9', borderColor: '#b7dcbb', color: '#175039' }}>
          <strong>{runMessage}</strong>
        </div>
      )}

      <div className="billing-stats-grid">
        <div className="stat-card">
          <span className="stat-label">Invoices Count</span>
          <span className="stat-value">{totalCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Invoiced (Page)</span>
          <span className="stat-value">{formatMoney(totalInvoiced)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Cash Collected</span>
          <span className="stat-value" style={{ color: '#03543f' }}>{formatMoney(totalPaid)}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Outstanding Balance</span>
          <span className="stat-value" style={{ color: totalOutstanding > 0 ? '#92400e' : 'inherit' }}>
            {formatMoney(totalOutstanding)}
          </span>
        </div>
      </div>

      <div className="billing-controls">
        <div className="filter-group">
          <label htmlFor="statusFilter" className="muted" style={{ fontSize: '0.85rem' }}>
            Status:
          </label>
          <select
            id="statusFilter"
            className="filter-select"
            value={statusFilter}
            disabled={overdueOnly}
            onChange={e => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="ALL">All Statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="PAID">Paid</option>
            <option value="CANCELLED">Cancelled</option>
          </select>

          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer', marginLeft: 16 }}>
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={e => {
                setOverdueOnly(e.target.checked);
                setPage(1);
              }}
            />
            <span style={{ color: overdueOnly ? '#b91c1c' : 'inherit', fontWeight: overdueOnly ? 600 : 'normal' }}>
              ⚠️ Overdue Invoices Only
            </span>
          </label>
        </div>
      </div>

      {error && (
        <div className="notice" style={{ background: '#fdf2f2', borderColor: '#f8b4b4', color: '#9b1c1c' }}>
          <strong>Error loading invoices:</strong> {error}
        </div>
      )}

      <div className="billing-table-panel">
        {loading && invoices.length === 0 ? (
          <div className="empty-state">
            <p className="muted">Loading invoices...</p>
          </div>
        ) : invoices.length === 0 ? (
          <div className="empty-state">
            <span className="empty-symbol">🧾</span>
            <h2>No invoices found</h2>
            <p className="muted">
              {overdueOnly
                ? 'There are no overdue invoices at this time.'
                : statusFilter !== 'ALL'
                ? `There are no invoices matching the "${statusFilter}" filter.`
                : 'Invoices will appear here once generated from active customer subscriptions.'}
            </p>
          </div>
        ) : (
          <>
            <table className="billing-table">
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Customer</th>
                  <th>Billing Period</th>
                  <th>Due Date</th>
                  <th>Total</th>
                  <th>Balance</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map(inv => (
                  <tr key={inv.id}>
                    <td>
                      <strong>{inv.number}</strong>
                    </td>
                    <td>
                      <div>{inv.customerName}</div>
                      <small className="muted">{inv.customerEmail}</small>
                    </td>
                    <td>
                      {new Date(inv.periodStart).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} –{' '}
                      {new Date(inv.periodEnd).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td>
                      <span style={{ color: inv.isOverdue ? '#b91c1c' : 'inherit', fontWeight: inv.isOverdue ? 600 : 'normal' }}>
                        {new Date(inv.dueDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        {inv.isOverdue && ' (Overdue)'}
                      </span>
                    </td>
                    <td>
                      <strong>{formatMoney(inv.totalMinor)}</strong>
                    </td>
                    <td>
                      {inv.remainingBalanceMinor > 0 ? (
                        <span style={{ color: '#92400e', fontWeight: 600 }}>{formatMoney(inv.remainingBalanceMinor)}</span>
                      ) : (
                        <span className="muted">₹0.00</span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge status-${inv.status}`}>{inv.status}</span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          className="btn-secondary"
                          style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                          onClick={() => viewInvoiceDetail(inv.id)}
                          disabled={detailLoading}
                        >
                          View Details
                        </button>
                        {inv.status === 'CONFIRMED' && inv.remainingBalanceMinor > 0 && (
                          <button
                            className="btn-primary"
                            style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                            onClick={() => openPaymentModal(inv)}
                          >
                            + Pay
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="pagination-bar">
              <span>
                Showing {invoices.length} of {totalCount} records
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

      {selectedInvoice && (
        <div className="modal-overlay" onClick={() => setSelectedInvoice(null)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2>Invoice {selectedInvoice.number}</h2>
                <span className={`status-badge status-${selectedInvoice.status}`} style={{ marginTop: 4 }}>
                  {selectedInvoice.status}
                </span>
              </div>
              <button className="btn-secondary" onClick={() => setSelectedInvoice(null)}>
                ✕ Close
              </button>
            </div>

            <div className="modal-body">
              <div className="snapshot-grid">
                <div className="snapshot-item">
                  <h4>Customer Snapshot</h4>
                  <p>{selectedInvoice.customerName}</p>
                  <p className="muted" style={{ fontSize: '0.85rem' }}>{selectedInvoice.customerEmail}</p>
                  {selectedInvoice.customerAddress && (
                    <p className="muted" style={{ fontSize: '0.82rem' }}>{selectedInvoice.customerAddress}</p>
                  )}
                </div>
                <div className="snapshot-item">
                  <h4>Billing Dates</h4>
                  <p>
                    <strong>Issued:</strong>{' '}
                    {new Date(selectedInvoice.issuedAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </p>
                  <p>
                    <strong>Due Date:</strong>{' '}
                    {new Date(selectedInvoice.dueDate).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </p>
                  <p className="muted" style={{ fontSize: '0.82rem' }}>
                    Period: {new Date(selectedInvoice.periodStart).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })} to{' '}
                    {new Date(selectedInvoice.periodEnd).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                  </p>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: '1rem', marginBottom: 10 }}>Line Items (Snapshotted)</h3>
                <table className="billing-table">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th>Qty</th>
                      <th>Unit Price</th>
                      <th>Tax Rate</th>
                      <th>Tax</th>
                      <th>Total</th>
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
                          <td>
                            <strong>{formatMoney(line.amountMinor)}</strong>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6} className="muted" style={{ textAlign: 'center' }}>
                          No lines recorded for this invoice.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <h3 style={{ fontSize: '1rem', margin: 0 }}>Recorded Payments</h3>
                  {selectedInvoice.status === 'CONFIRMED' && selectedInvoice.remainingBalanceMinor > 0 && (
                    <button
                      className="btn-primary"
                      style={{ padding: '4px 12px', fontSize: '0.8rem' }}
                      onClick={() => openPaymentModal(selectedInvoice)}
                    >
                      + Record Payment
                    </button>
                  )}
                </div>

                {selectedInvoice.payments && selectedInvoice.payments.length > 0 ? (
                  <table className="billing-table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Method</th>
                        <th>Reference</th>
                        <th>Note</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedInvoice.payments.map(p => (
                        <tr key={p.id}>
                          <td>{new Date(p.paidAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</td>
                          <td><strong>{p.method}</strong></td>
                          <td>{p.reference || <span className="muted">—</span>}</td>
                          <td>{p.note || <span className="muted">—</span>}</td>
                          <td style={{ color: '#03543f', fontWeight: 600 }}>{formatMoney(p.amountMinor)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted" style={{ fontSize: '0.85rem' }}>No payments recorded yet against this invoice.</p>
                )}
              </div>

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
                  Invoice Total: {formatMoney(selectedInvoice.totalMinor)}
                </div>
                {selectedInvoice.paidAmountMinor > 0 && (
                  <div style={{ color: '#03543f' }}>
                    Amount Paid: -{formatMoney(selectedInvoice.paidAmountMinor)}
                  </div>
                )}
                {selectedInvoice.remainingBalanceMinor > 0 && (
                  <div style={{ color: '#92400e', fontWeight: 600 }}>
                    Remaining Balance: {formatMoney(selectedInvoice.remainingBalanceMinor)}
                  </div>
                )}
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                {selectedInvoice.status === 'DRAFT' && (
                  <button
                    className="btn-primary"
                    onClick={() => handleConfirmInvoice(selectedInvoice.id)}
                    disabled={actionLoading}
                  >
                    {actionLoading ? 'Confirming...' : '✓ Confirm Invoice'}
                  </button>
                )}
                {selectedInvoice.status === 'CONFIRMED' && selectedInvoice.remainingBalanceMinor > 0 && (
                  <button
                    className="btn-primary"
                    onClick={() => openPaymentModal(selectedInvoice)}
                  >
                    + Record Payment
                  </button>
                )}
                {(selectedInvoice.status === 'DRAFT' || selectedInvoice.status === 'CONFIRMED') && (
                  <button
                    className="btn-secondary"
                    style={{ color: '#b91c1c', borderColor: '#fca5a5' }}
                    onClick={() => handleCancelInvoice(selectedInvoice.id)}
                    disabled={actionLoading || (selectedInvoice.payments && selectedInvoice.payments.length > 0)}
                    title={selectedInvoice.payments && selectedInvoice.payments.length > 0 ? 'Cannot cancel an invoice with payments' : ''}
                  >
                    {actionLoading ? 'Cancelling...' : '✕ Cancel Invoice'}
                  </button>
                )}
              </div>
              <button className="btn-secondary" onClick={() => setSelectedInvoice(null)} disabled={actionLoading}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {showPaymentModal && selectedInvoice && (
        <div className="modal-overlay" onClick={() => !recordingPayment && setShowPaymentModal(false)}>
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <form onSubmit={handleRecordPayment}>
              <div className="modal-header">
                <h2>Record Payment for {selectedInvoice.number}</h2>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPaymentModal(false)}
                  disabled={recordingPayment}
                >
                  ✕
                </button>
              </div>

              <div className="modal-body">
                <div style={{ background: '#f7faf8', padding: 14, borderRadius: 8, fontSize: '0.88rem' }}>
                  <div>Total Invoiced: <strong>{formatMoney(selectedInvoice.totalMinor)}</strong></div>
                  <div>Already Paid: <span style={{ color: '#03543f' }}>{formatMoney(selectedInvoice.paidAmountMinor)}</span></div>
                  <div>Remaining Balance: <strong style={{ color: '#92400e' }}>{formatMoney(selectedInvoice.remainingBalanceMinor)}</strong></div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                      Payment Method *
                    </label>
                    <select
                      className="filter-select"
                      style={{ width: '100%' }}
                      value={paymentMethod}
                      onChange={e => setPaymentMethod(e.target.value)}
                      required
                    >
                      <option value="BANK_TRANSFER">Bank Transfer (NEFT/RTGS/IMPS)</option>
                      <option value="UPI">UPI</option>
                      <option value="CREDIT_CARD">Credit Card</option>
                      <option value="CASH">Cash</option>
                      <option value="CHEQUE">Cheque</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                      Payment Amount (₹) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      max={(selectedInvoice.remainingBalanceMinor / 100).toFixed(2)}
                      className="filter-select"
                      style={{ width: '100%' }}
                      value={paymentAmountMajor}
                      onChange={e => setPaymentAmountMajor(e.target.value)}
                      required
                    />
                    <small className="muted">Maximum allowed: {(selectedInvoice.remainingBalanceMinor / 100).toFixed(2)}</small>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                      Payment Date *
                    </label>
                    <input
                      type="date"
                      className="filter-select"
                      style={{ width: '100%' }}
                      value={paymentDate}
                      onChange={e => setPaymentDate(e.target.value)}
                      required
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                      Reference / Transaction ID (Optional)
                    </label>
                    <input
                      type="text"
                      className="filter-select"
                      style={{ width: '100%' }}
                      placeholder="e.g. TXN-UPI-984210"
                      value={paymentReference}
                      onChange={e => setPaymentReference(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, marginBottom: 4 }}>
                      Internal Note (Optional)
                    </label>
                    <input
                      type="text"
                      className="filter-select"
                      style={{ width: '100%' }}
                      placeholder="e.g. Cleared in current account"
                      value={paymentNote}
                      onChange={e => setPaymentNote(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowPaymentModal(false)}
                  disabled={recordingPayment}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={recordingPayment}
                >
                  {recordingPayment ? 'Recording...' : 'Confirm Payment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showRunModal && (
        <div className="modal-overlay" onClick={() => !runningBilling && setShowRunModal(false)}>
          <div className="modal-content" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Run Recurring Billing</h2>
              <button
                className="btn-secondary"
                onClick={() => setShowRunModal(false)}
                disabled={runningBilling}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="muted" style={{ margin: 0 }}>
                This runs the recurring billing engine against all active customer subscriptions. Subscriptions due on or before the target date will generate invoices with snapshotted pricing and advance their next billing dates atomically.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label htmlFor="targetDateInput" style={{ fontSize: '0.85rem', fontWeight: 600 }}>
                  Billing Cutoff Date:
                </label>
                <input
                  id="targetDateInput"
                  type="date"
                  className="filter-select"
                  value={runTargetDate}
                  onChange={e => setRunTargetDate(e.target.value)}
                  disabled={runningBilling}
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn-secondary"
                onClick={() => setShowRunModal(false)}
                disabled={runningBilling}
              >
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={executeBillingRun}
                disabled={runningBilling}
              >
                {runningBilling ? 'Processing Invoices...' : 'Start Billing Run'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
