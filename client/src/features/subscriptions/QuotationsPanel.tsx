import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import type { Page } from '../../../../shared/contracts';
import { formatMoney } from '../../../../shared/money';
import { DraftForm } from './DraftForm';
import { businessDate, type Customer, type Detail, type Template, type TemplateSummary } from './types';

function TemplateLines({ template }: { template: Template }) {
  return <><div className="sub-table-wrap"><table><caption>Template product lines</caption><thead><tr><th>Product / variant</th><th>Quantity</th><th>Unit price</th><th>Tax</th><th>Total</th></tr></thead><tbody>{template.lines.map(line => <tr key={line.id}><td>{line.description}</td><td>{line.quantity}</td><td>{formatMoney(line.unitPriceMinor)}</td><td>{line.taxRateBps / 100}% · {formatMoney(line.taxMinor)}</td><td>{formatMoney(line.totalMinor)}</td></tr>)}</tbody></table></div><p className="sub-summary">Subtotal {formatMoney(template.subtotalMinor)} · Tax {formatMoney(template.taxMinor)} · Total {formatMoney(template.totalMinor)}</p></>;
}
function QuotationForm({ template, onSaved, onClose }: { template: Template; onSaved: (data: Detail) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [customers, setCustomers] = useState<Page<Customer>>();
  const [customerId, setCustomerId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [error, setError] = useState('');
  const [customerError, setCustomerError] = useState('');
  const [saving, setSaving] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setCustomers(undefined); setCustomerError('');
    const timer = setTimeout(() => {
      api<Page<Customer>>(`/subscriptions/customers?${new URLSearchParams({ search, page: String(page) })}`).then(data => { if (active) setCustomers(data); }).catch(error => { if (active) setCustomerError(errorMessage(error)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [search, page, retry]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (expiryDate && expiryDate <= startDate) { setError('Expiry date must be after start date.'); return; }
    setSaving(true);
    try { onSaved(await api<Detail>('/subscriptions', { method: 'POST', body: JSON.stringify({ templateId: template.id, customerId, startDate, expiryDate: expiryDate || null }) })); }
    catch (error) { setError(errorMessage(error)); } finally { setSaving(false); }
  }
  return <form className="sub-editor" onSubmit={submit}><h3>Create quotation from {template.name}</h3><p>Plan: {template.plan.name} · Payment terms: {template.paymentTermDays} days · Valid for {template.validDays} days from creation.</p><fieldset disabled={saving}><legend>Customer and subscription dates</legend><div className="sub-grid"><label>Find customer<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); setCustomerId(''); }} /></label><label>Customer<select required value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Select customer</option>{customers?.items.map(customer => <option key={customer.id} value={customer.id}>{customer.name} · {customer.email}</option>)}</select></label><label>Start date<input required type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label><label>Expiry date (optional)<input type="date" min={startDate} value={expiryDate} onChange={event => setExpiryDate(event.target.value)} /></label></div>
      {!customers && !customerError && <p role="status">Loading customers…</p>}{customerError && <p className="sub-error" role="alert">{customerError} <button type="button" onClick={() => setRetry(value => value + 1)}>Retry</button></p>}{customers && <div className="sub-pager"><span>{customers.total} customers · Page {page}</span><div className="sub-actions"><button type="button" className="sub-secondary" disabled={page === 1} onClick={() => { setPage(page - 1); setCustomerId(''); }}>Previous</button><button type="button" className="sub-secondary" disabled={page * 20 >= customers.total} onClick={() => { setPage(page + 1); setCustomerId(''); }}>Next</button></div></div>}</fieldset>
      <TemplateLines template={template} /><p className="muted">Saved template prices are copied once. Tax rates are validated and captured when the quotation is created.</p>{error && <p role="alert" className="sub-error">{error}</p>}<div className="sub-actions"><button disabled={saving || !customerId}>{saving ? 'Creating…' : 'Create quotation'}</button><button type="button" className="sub-secondary" disabled={saving} onClick={onClose}>Cancel</button></div>
    </form>;
}
export function QuoteDraftAction({ detail, onSaved }: { detail: Detail; onSaved: (data: Detail) => void }) {
  const [validDays, setValidDays] = useState(14);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  if (detail.status !== 'DRAFT') return null;
  async function submit(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { onSaved(await api<Detail>(`/subscriptions/${detail.id}/transition`, { method: 'POST', body: JSON.stringify({ action: 'QUOTATION', validDays }) })); }
    catch (error) { setError(errorMessage(error)); } finally { setSaving(false); }
  }
  return <form onSubmit={submit}><div className="sub-grid"><label>Quotation validity (days)<input required type="number" min="1" max="365" value={validDays} disabled={saving} onChange={event => setValidDays(Number(event.target.value))} /></label></div><button disabled={saving}>{saving ? 'Converting…' : 'Convert draft to quotation'}</button>{error && <p className="sub-error" role="alert">{error}</p>}</form>;
}
export function QuotationsPanel({ onCreated }: { onCreated: (data: Detail) => void }) {
  const [result, setResult] = useState<Page<TemplateSummary>>();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Template | null>(null);
  const [editor, setEditor] = useState<Template | 'new' | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true; setResult(undefined); setError('');
    const timer = setTimeout(() => {
      api<Page<TemplateSummary>>(`/subscriptions/templates?${new URLSearchParams({ search, page: String(page) })}`).then(data => { if (active) setResult(data); }).catch(error => { if (active) setError(errorMessage(error)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [search, page, revision]);
  async function open(id: string, mode: 'view' | 'edit' | 'quote' | 'delete') {
    setBusy(true); setError(''); setNotice('');
    try {
      const template = await api<Template>(`/subscriptions/templates/${id}`);
      setEditor(mode === 'edit' ? template : null); setSelected(mode === 'edit' ? null : template); setQuoting(mode === 'quote'); setDeleting(mode === 'delete');
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!selected) return;
    setBusy(true); setError('');
    try { await api(`/subscriptions/templates/${selected.id}`, { method: 'DELETE' }); setSelected(null); setDeleting(false); setPage(1); setRevision(value => value + 1); setNotice('Template deleted. Existing quotations retain their copied lines.'); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <section className="panel" aria-labelledby="templates-title"><div className="sub-section-heading"><h2 id="templates-title">Quotation templates</h2><div className="sub-actions"><button className="sub-secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>Refresh</button><button onClick={() => { setEditor('new'); setSelected(null); }}>Add template</button></div></div>
    {notice && <p className="notice" role="status">{notice}</p>}{error && <p className="sub-error" role="alert">{error}</p>}{busy && <p role="status">Loading…</p>}
    {editor && <DraftForm key={editor === 'new' ? 'new' : editor.id} template={editor === 'new' ? null : editor} onSaved={() => {}} onClose={() => setEditor(null)} onTemplateSaved={() => { setEditor(null); setRevision(value => value + 1); setNotice('Quotation template saved.'); }} />}
    {selected && <div className="sub-template-detail"><div className="sub-section-heading"><h3>{selected.name}</h3><button className="sub-secondary" disabled={busy} onClick={() => setSelected(null)}>Close template</button></div>{deleting ? <><p>Delete this template? Existing quotations will keep their copied lines and prices.</p><div className="sub-actions"><button disabled={busy} onClick={() => void remove()}>Delete template</button><button className="sub-secondary" disabled={busy} onClick={() => setDeleting(false)}>Cancel</button></div></> : quoting ? <QuotationForm key={selected.id} template={selected} onClose={() => setQuoting(false)} onSaved={data => { setSelected(null); setQuoting(false); onCreated(data); }} /> : <><p>{selected.plan.name} · Valid for {selected.validDays} days · Payment terms {selected.paymentTermDays} days</p><TemplateLines template={selected} /></>}</div>}
    <label className="sub-search">Search templates<input type="search" value={search} placeholder="Template or plan name" onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
    {!result && !error && <div className="sub-loading" role="status" aria-label="Loading templates"><span /><span /></div>}{result && <><div className="sub-table-wrap"><table><caption className="sub-sr-only">Quotation templates</caption><thead><tr><th>Name / plan</th><th>Validity</th><th>Payment terms</th><th>Lines</th><th>Created</th><th>Actions</th></tr></thead><tbody>{result.items.map(template => <tr key={template.id}><td><strong>{template.name}</strong><small>{template.plan.name}</small></td><td>{template.validDays} days</td><td>{template.paymentTermDays} days</td><td>{template._count.lines}</td><td>{businessDate(template.createdAt)}</td><td><div className="sub-actions">{(['view', 'edit', 'quote', 'delete'] as const).map(mode => <button key={mode} className="sub-secondary" disabled={busy} onClick={() => void open(template.id, mode)}>{mode === 'quote' ? 'Create quotation' : mode.charAt(0).toUpperCase() + mode.slice(1)}</button>)}</div></td></tr>)}</tbody></table></div>{!result.items.length && <p className="sub-empty">No templates found. Add a template or change your search.</p>}<div className="sub-pager"><span>{result.total} templates · Page {page}</span><div className="sub-actions"><button className="sub-secondary" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><button className="sub-secondary" disabled={page * 20 >= result.total} onClick={() => setPage(page + 1)}>Next</button></div></div></>}
  </section>;
}
