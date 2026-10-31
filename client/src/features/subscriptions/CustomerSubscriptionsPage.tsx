import { useEffect, useRef, useState } from 'react';
import { api, errorMessage } from '../../lib/api';
import { subscriptionStatuses, type Page } from '../../../../shared/contracts';
import { formatMoney } from '../../../../shared/money';
import { LifecycleActions } from './LifecycleActions';
import { businessDate, type PortalSubscriptionSummary, type PortalSubscriptionDetail } from './types';
import './subscriptions.css';

export function CustomerSubscriptionsPage() {
  const [result, setResult] = useState<Page<PortalSubscriptionSummary>>();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [detail, setDetail] = useState<PortalSubscriptionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notice, setNotice] = useState('');
  const detailRequest = useRef<AbortController | null>(null);
  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController(); setResult(undefined); setError('');
    const timer = setTimeout(() => {
      api<Page<PortalSubscriptionSummary>>(`/portal/subscriptions?${new URLSearchParams({ search, page: String(page), ...(status ? { status } : {}) })}`, { signal: controller.signal })
        .then(value => { if (!controller.signal.aborted) { const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize)); if (page > lastPage) setPage(lastPage); else setResult(value); } })
        .catch(error => { if (!controller.signal.aborted) setError(errorMessage(error)); });
    }, 250);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [search, status, page, revision]);
  async function view(id: string) {
    detailRequest.current?.abort(); const controller = new AbortController(); detailRequest.current = controller;
    setLoadingDetail(true); setDetailError(''); setDetail(null);
    try { const value = await api<PortalSubscriptionDetail>(`/portal/subscriptions/${encodeURIComponent(id)}`, { signal: controller.signal }); if (!controller.signal.aborted) setDetail(value); }
    catch (error) { if (!controller.signal.aborted) setDetailError(errorMessage(error)); }
    finally { if (!controller.signal.aborted) setLoadingDetail(false); }
  }
  return <div className="subscriptions-feature sub-customer-portal"><header className="page-heading"><div><span className="eyebrow">YOUR ACCOUNT</span><h1>Your subscriptions</h1><p className="muted">View your plans, upcoming billing dates and available subscription actions.</p></div><button className="sub-secondary" onClick={() => { setRevision(value => value + 1); if (detail) void view(detail.id); }}>Refresh subscriptions</button></header>
    {notice && <p className="notice" role="status">{notice}</p>}
    <section className="panel" aria-label="Subscription search"><div className="sub-grid"><label>Search your subscriptions<input type="search" maxLength={200} placeholder="Subscription number or plan" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label><label>Subscription status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{subscriptionStatuses.map(value => <option key={value} value={value}>{value}</option>)}</select></label></div>
      {error && <p role="alert" className="sub-error">{error} <button className="sub-secondary" onClick={() => setRevision(value => value + 1)}>Retry subscriptions</button></p>}
      {!result && !error && <div className="sub-loading" role="status" aria-label="Loading your subscriptions"><span /><span /><span /></div>}
      {result && <><div className="sub-portal-grid">{result.items.map(item => <article className="sub-portal-card" key={item.id}><div className="sub-section-heading"><h2>{item.plan.name}</h2><span className="badge">{item.status}</span></div><p className="sub-portal-number">{item.number}</p><dl className="sub-details"><div><dt>Start</dt><dd>{businessDate(item.startDate)}</dd></div><div><dt>Expiry</dt><dd>{businessDate(item.expiryDate)}</dd></div><div><dt>Billing frequency</dt><dd>{item.billingInterval.toLowerCase()}</dd></div><div><dt>Next billing date</dt><dd>{businessDate(item.nextBillingDate)}</dd></div></dl><button className="sub-secondary" disabled={loadingDetail} aria-label={`View ${item.number}`} onClick={() => void view(item.id)}>View subscription</button></article>)}</div>
        {!result.items.length && <div className="sub-empty"><h2>No subscriptions found</h2><p>{search || status ? 'Try changing your search or status filter.' : 'Your subscriptions will appear here when your account has a plan.'}</p></div>}
        <div className="sub-pager"><span>{result.total} subscriptions · Page {page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}</span><div className="sub-actions"><button className="sub-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous subscriptions</button><button className="sub-secondary" disabled={page * result.pageSize >= result.total} onClick={() => setPage(page + 1)}>Next subscriptions</button></div></div></>}
    </section>
    {loadingDetail && <p role="status">Loading subscription details…</p>}{detailError && <p className="sub-error" role="alert">{detailError}</p>}
    {detail && <section className="panel sub-editor" aria-label="Your subscription details"><div className="sub-section-heading"><h2>{detail.number}</h2><button className="sub-secondary" onClick={() => setDetail(null)}>Close subscription details</button></div><p>{detail.plan.name} · Payment terms: {detail.paymentTermDays} days</p>
      <LifecycleActions key={detail.id} portal detail={detail} onSaved={(value, renewed) => { setDetail(value); setNotice(renewed ? `Renewal ${value.number} created. Our team will review the new draft.` : `Subscription ${value.number} is now ${value.status.toLowerCase()}.`); setPage(1); setRevision(current => current + 1); }} />
      <div className="sub-portal-lines">{detail.lines.map(line => <article key={line.id}><h3>{line.description}</h3><p>{line.quantity} × {formatMoney(line.unitPriceMinor)} · Tax {line.taxRateBps / 100}% ({formatMoney(line.taxMinor)})</p><strong>{formatMoney(line.totalMinor)}</strong></article>)}</div><p className="sub-summary">Subtotal {formatMoney(detail.subtotalMinor)} · Tax {formatMoney(detail.taxMinor)} · Total {formatMoney(detail.totalMinor)}</p>
    </section>}
  </div>;
}
