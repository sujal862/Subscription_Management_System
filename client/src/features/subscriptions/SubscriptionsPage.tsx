import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { subscriptionStatuses, type Page } from '../../../../shared/contracts';
import { formatMoney } from '../../../../shared/money';
import { DraftForm } from './DraftForm';
import { QuotationsPanel, QuoteDraftAction } from './QuotationsPanel';
import { businessDate, type Customer, type Subscription, type Detail } from './types';
import './subscriptions.css';

const blankCustomer = { name: '', email: '', company: '', phone: '', address: '' };
type CustomerFields = typeof blankCustomer;
function CustomerForm({ customer, onSaved, onClose }: { customer: Customer | null; onSaved: () => void; onClose: () => void }) {
  const [fields, setFields] = useState<CustomerFields>(customer ? Object.fromEntries(Object.keys(blankCustomer).map(key => [key, customer[key as keyof Customer] ?? ''])) as CustomerFields : blankCustomer);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!fields.name.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.trim())) { setError('Enter a name and a valid email address.'); return; }
    setSaving(true);
    try { await api(`/subscriptions/customers${customer ? `/${customer.id}` : ''}`, { method: customer ? 'PATCH' : 'POST', body: JSON.stringify(fields) }); onSaved(); }
    catch (error) { setError(errorMessage(error)); } finally { setSaving(false); }
  }
  return <section className="panel sub-editor" aria-labelledby="customer-form-title"><h2 id="customer-form-title">{customer ? 'Edit customer' : 'Add customer'}</h2>
    <form onSubmit={submit}><div className="sub-grid">{Object.keys(blankCustomer).map(key => <label key={key}>{key === 'name' ? 'Full name' : key.charAt(0).toUpperCase() + key.slice(1)}
      <input name={key} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} required={key === 'name' || key === 'email'} maxLength={key === 'address' ? 2000 : key === 'email' ? 254 : key === 'phone' ? 40 : 200} value={fields[key as keyof CustomerFields]} onChange={event => setFields({ ...fields, [key]: event.target.value })} />
    </label>)}</div>{error && <p role="alert" className="sub-error">{error}</p>}
      <div className="sub-actions"><button disabled={saving}>{saving ? 'Saving…' : 'Save customer'}</button><button type="button" className="sub-secondary" onClick={onClose} disabled={saving}>Cancel</button></div>
    </form></section>;
}

function Pager({ page, total, setPage }: { page: number; total: number; setPage: (value: number) => void }) {
  return <div className="sub-pager"><span>{total} records · Page {page} of {Math.max(1, Math.ceil(total / 20))}</span><div className="sub-actions"><button className="sub-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="sub-secondary" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>Next</button></div></div>;
}
function Failure({ message }: { message: string }) { return <p className="sub-error" role="alert">{message}</p>; }
function Loading() { return <div className="sub-loading" role="status" aria-label="Loading records"><span /><span /><span /></div>; }

export function SubscriptionsPage() {
  const [customers, setCustomers] = useState<Page<Customer>>();
  const [subscriptions, setSubscriptions] = useState<Page<Subscription>>();
  const [customerSearch, setCustomerSearch] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [customerError, setCustomerError] = useState('');
  const [subscriptionError, setSubscriptionError] = useState('');
  const [editor, setEditor] = useState<Customer | 'new' | null>(null);
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [customerDetail, setCustomerDetail] = useState<Customer | null>(null);
  const [detailError, setDetailError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true; setCustomers(undefined); setCustomerError('');
    const timer = setTimeout(() => {
      api<Page<Customer>>(`/subscriptions/customers?${new URLSearchParams({ page: String(customerPage), search: customerSearch })}`).then(data => { if (active) setCustomers(data); }).catch(error => { if (active) setCustomerError(error instanceof ApiError && error.status === 501 ? 'Customer management requires Member 1’s authentication implementation.' : errorMessage(error)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [customerPage, customerSearch, revision]);
  useEffect(() => {
    let active = true; setSubscriptions(undefined); setSubscriptionError('');
    const timer = setTimeout(() => {
      api<Page<Subscription>>(`/subscriptions?${new URLSearchParams({ page: String(page), search, ...(status ? { status } : {}), ...(customerFilter ? { customerId: customerFilter } : {}) })}`).then(data => { if (active) setSubscriptions(data); }).catch(error => { if (active) setSubscriptionError(error instanceof ApiError && error.status === 501 ? 'Subscription management requires Member 1’s authentication implementation.' : errorMessage(error)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [page, search, status, customerFilter, revision]);
  async function view(id: string, customer = false) {
    setDetailError(''); setNotice('Loading details…');
    try {
      if (customer) { setCustomerDetail(await api<Customer>(`/subscriptions/customers/${id}`)); setDetail(null); }
      else { setDetail(await api<Detail>(`/subscriptions/${id}`)); setCustomerDetail(null); }
      setNotice('');
    } catch (error) { setDetailError(errorMessage(error)); setNotice(''); }
  }
  return <div className="subscriptions-feature">
    <header className="page-heading"><div><span className="eyebrow">CUSTOMERS & SALES</span><h1>Subscription Management</h1><p className="muted">Manage customer relationships and prepare subscription drafts.</p></div><div className="sub-actions"><button className="sub-secondary" onClick={() => { setEditor('new'); setCreating(false); }}>Add Customer</button><button onClick={() => { setCreating(true); setEditor(null); }}>Create Subscription</button></div></header>
    {notice && <p role="status" className="notice">{notice}</p>}{detailError && <Failure message={detailError} />}
    {editor && <CustomerForm key={editor === 'new' ? 'new' : editor.id} customer={editor === 'new' ? null : editor} onClose={() => setEditor(null)} onSaved={() => { setNotice('Customer saved.'); setEditor(null); setCustomerDetail(null); setRevision(value => value + 1); }} />}
    {creating && <DraftForm onClose={() => setCreating(false)} onSaved={value => { setCreating(false); setDetail(value); setCustomerDetail(null); setNotice(`Created ${value.number} · DRAFT`); setRevision(value => value + 1); }} />}
    {customerDetail && <section className="panel sub-editor" aria-label="Customer details"><div className="sub-section-heading"><h2>{customerDetail.name}</h2><button className="sub-secondary" onClick={() => setCustomerDetail(null)}>Close details</button></div><dl className="sub-details">{[['Email', customerDetail.email], ['Company', customerDetail.company], ['Phone', customerDetail.phone], ['Address', customerDetail.address], ['Subscriptions', customerDetail._count.subscriptions], ['Created', businessDate(customerDetail.createdAt)]].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value ?? '—'}</dd></div>)}</dl></section>}
    {detail && <section className="panel sub-editor" aria-label="Subscription details"><div className="sub-section-heading"><h2>{detail.number} <span className="badge">{detail.status}</span></h2><button className="sub-secondary" onClick={() => setDetail(null)}>Close details</button></div><QuoteDraftAction key={detail.id} detail={detail} onSaved={value => { setDetail(value); setNotice(`${value.number} converted to QUOTATION.`); setRevision(current => current + 1); }} /><dl className="sub-details">{[['Customer', detail.customer.name], ['Email', detail.customer.email], ['Address', detail.customer.address], ['Plan', detail.plan.name], ['Billing interval', detail.billingInterval], ['Start date', businessDate(detail.startDate)], ['Expiry date', businessDate(detail.expiryDate)], ['Payment terms', `${detail.paymentTermDays} days`], ['Quotation valid until', businessDate(detail.quotationValidUntil)]].map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value ?? '—'}</dd></div>)}</dl><div className="sub-table-wrap"><table><caption>Saved product lines</caption><thead><tr><th>Description</th><th>Quantity</th><th>Unit price</th><th>Tax rate</th><th>Tax</th><th>Total</th></tr></thead><tbody>{detail.lines.map(line => <tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{formatMoney(line.unitPriceMinor)}</td><td>{line.taxRateBps / 100}%</td><td>{formatMoney(line.taxMinor)}</td><td>{formatMoney(line.totalMinor)}</td></tr>)}</tbody></table></div><p className="sub-summary">Subtotal {formatMoney(detail.subtotalMinor)} · Tax {formatMoney(detail.taxMinor)} · Total {formatMoney(detail.totalMinor)}</p></section>}
    <QuotationsPanel onCreated={value => { setDetail(value); setCustomerDetail(null); setNotice(`Created ${value.number} � QUOTATION`); setRevision(current => current + 1); }} />
    <section className="panel"><div className="sub-section-heading"><h2>Customers</h2><button className="sub-secondary" onClick={() => setRevision(value => value + 1)}>Refresh</button></div><label className="sub-search">Search customers<input type="search" placeholder="Name, email, company or phone" value={customerSearch} onChange={event => { setCustomerSearch(event.target.value); setCustomerPage(1); }} /></label>
      {customerError ? <Failure message={customerError} /> : !customers ? <Loading /> : <><div className="sub-table-wrap"><table><caption className="sub-sr-only">Customers</caption><thead><tr><th>Name / email</th><th>Company</th><th>Phone</th><th>Subscriptions</th><th>Created</th><th>Actions</th></tr></thead><tbody>{customers.items.map(customer => <tr key={customer.id}><td><strong>{customer.name}</strong><small>{customer.email}</small></td><td>{customer.company ?? '—'}</td><td>{customer.phone ?? '—'}</td><td>{customer._count.subscriptions}</td><td>{businessDate(customer.createdAt)}</td><td><div className="sub-actions"><button className="sub-secondary" onClick={() => void view(customer.id, true)}>View</button><button className="sub-secondary" onClick={() => { setEditor(customer); setCreating(false); }}>Edit</button><button className="sub-secondary" onClick={() => { setCustomerFilter(customer.id); setPage(1); }}>Subscriptions</button></div></td></tr>)}</tbody></table></div>{!customers.items.length && <p className="sub-empty">No customers found. Add a customer or adjust your search.</p>}<Pager page={customerPage} total={customers.total} setPage={setCustomerPage} /></>}
    </section>
    <section className="panel"><div className="sub-section-heading"><h2>Subscriptions</h2><button className="sub-secondary" onClick={() => setRevision(value => value + 1)}>Refresh</button></div><div className="sub-grid"><label>Search subscriptions<input type="search" placeholder="Number, customer or plan" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label><label>Status<select value={status} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">All statuses</option>{subscriptionStatuses.map(value => <option key={value}>{value}</option>)}</select></label></div>{customerFilter && <p>Showing selected customer’s subscriptions. <button className="sub-secondary" onClick={() => { setCustomerFilter(''); setPage(1); }}>Clear customer filter</button></p>}
      {subscriptionError ? <Failure message={subscriptionError} /> : !subscriptions ? <Loading /> : <><div className="sub-table-wrap"><table><caption className="sub-sr-only">Subscriptions</caption><thead><tr><th>Number</th><th>Customer / plan</th><th>Start</th><th>Expiry</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{subscriptions.items.map(item => <tr key={item.id}><td>{item.number}</td><td><strong>{item.customer.name}</strong><small>{item.plan.name}</small></td><td>{businessDate(item.startDate)}</td><td>{businessDate(item.expiryDate)}</td><td><span className="badge">{item.status}</span></td><td>{businessDate(item.createdAt)}</td><td><button className="sub-secondary" onClick={() => void view(item.id)}>View</button></td></tr>)}</tbody></table></div>{!subscriptions.items.length && <p className="sub-empty">No subscriptions found. Create a draft or adjust your filters.</p>}<Pager page={page} total={subscriptions.total} setPage={setPage} /></>}
    </section>
  </div>;
}
