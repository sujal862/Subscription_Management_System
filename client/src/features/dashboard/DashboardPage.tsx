import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, errorMessage } from '../../lib/api';
import type { DashboardSummary, DashboardOverdueInvoice, Page } from '../../../../shared/contracts';
import { formatMoney } from '../../../../shared/money';
import './dashboard.css';

const emptyFilters = { from: '', to: '', status: '' };
const date = (value: string) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium' }).format(new Date(value));
export function DashboardPage() {
  const [draft, setDraft] = useState(emptyFilters);
  const [filters, setFilters] = useState(emptyFilters);
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [overdue, setOverdue] = useState<Page<DashboardOverdueInvoice> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(''); setSummary(null); setOverdue(null);
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value));
    void Promise.all([
      api<DashboardSummary>(`/dashboard/summary?${query}`, { signal: controller.signal }),
      api<Page<DashboardOverdueInvoice>>(`/dashboard/overdue?${query}&page=${page}&pageSize=10`, { signal: controller.signal }),
    ]).then(([totals, invoices]) => {
      if (!controller.signal.aborted) { setSummary(totals); setOverdue(invoices); }
    }).catch(cause => { if (!controller.signal.aborted) setError(errorMessage(cause)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [filters, page, refresh]);
  function apply(event: FormEvent) {
    event.preventDefault();
    if (draft.from && draft.to && draft.from > draft.to) { setFormError('From date must be on or before to date.'); return; }
    setFormError(''); setPage(1); setFilters({ ...draft });
  }
  return <section className="dashboard">
    <div className="page-heading"><div><span className="eyebrow">BUSINESS OVERVIEW</span><h1>Brightloop workspace</h1><p className="muted">Revenue, collections and balances from your saved invoices.</p></div>
      <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>Refresh dashboard</button></div>
    <form className="panel dashboard-filters" onSubmit={apply}>
      <label>Issued from<input type="date" min="1900-01-01" max="9998-12-31" value={draft.from} onChange={event => setDraft({ ...draft, from: event.target.value })} /></label>
      <label>Issued to<input type="date" min="1900-01-01" max="9998-12-31" value={draft.to} onChange={event => setDraft({ ...draft, to: event.target.value })} /></label>
      <label>Invoice status<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value })}><option value="">Confirmed and paid</option><option value="CONFIRMED">Confirmed</option><option value="PAID">Paid</option></select></label>
      <button type="submit" disabled={loading}>Apply filters</button><button type="button" disabled={loading} onClick={() => { setDraft(emptyFilters); setFilters({ ...emptyFilters }); setPage(1); setFormError(''); }}>Clear filters</button>
    </form>
    {formError && <p role="alert">{formError}</p>}
    <p className="muted dashboard-explanation">Dates include the full issue day in Asia/Kolkata. Payments and current balances belong to those invoices, regardless of payment date. Draft and cancelled invoices are excluded. Active subscriptions is the current count across all dates.</p>
    {loading && <p className="notice" role="status">Loading dashboard…</p>}
    {error && <div role="alert" className="panel"><p>{error}</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Try again</button></div>}
    {!loading && summary && overdue && <>
      <dl className="dashboard-metrics">{[
        ['Active subscriptions', String(summary.activeSubscriptions)],
        ['Invoiced revenue', formatMoney(summary.invoicedRevenueMinor)],
        ['Collected', formatMoney(summary.collectedMinor)],
        ['Outstanding', formatMoney(summary.outstandingMinor)],
        ['Overdue balance', formatMoney(summary.overdueMinor)],
        ['Overdue invoices', String(summary.overdueInvoices)],
      ].map(([label, value]) => <div className="panel" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="muted">{summary.invoiceCount} qualifying invoices. Revenue excludes tax; collections and balances include tax. Updated {date(summary.asOf)}.</p>
      {summary.invoiceCount === 0 && <p className="notice" role="status">No confirmed or paid invoices match these filters. Create and confirm invoices in Billing to populate these totals.</p>}
      <section className="panel"><div className="page-heading"><div><h2>Overdue invoices</h2><p className="muted">Positive remaining balances past their due time. Oldest due first.</p></div><Link to="/billing">Open billing</Link></div>
        {overdue.total === 0 ? <p>No overdue invoices match these filters.</p> : <>
          <div className="dashboard-table-scroll" tabIndex={0} role="region" aria-label="Overdue invoice table"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Due date</th><th>Total</th><th>Paid</th><th>Remaining</th></tr></thead><tbody>{overdue.items.map(invoice => <tr key={invoice.id}><td>{invoice.number}</td><td>{invoice.customerName}</td><td>{date(invoice.dueDate)}</td><td>{formatMoney(invoice.totalMinor)}</td><td>{formatMoney(invoice.paidMinor)}</td><td>{formatMoney(invoice.outstandingMinor)}</td></tr>)}</tbody></table></div>
          {overdue.items.length === 0 && <p>No invoices on this page. Return to the previous page or refresh.</p>}
          <div className="dashboard-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><span>Page {page} · {overdue.total} invoices</span><button type="button" disabled={page * overdue.pageSize >= overdue.total} onClick={() => setPage(value => value + 1)}>Next</button></div>
        </>}
      </section>
    </>}
  </section>;
}
