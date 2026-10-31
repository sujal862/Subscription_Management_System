import { useEffect, useId, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import type { Page } from '../../../../shared/contracts';
import { formatMoney } from '../../../../shared/money';
import type { Customer, Product, Plan, Tax, LineInput, Detail, Template } from './types';

// Read only documented catalog endpoints. Paginate rather than silently truncating selectors.
async function catalogRecords<T>(path: string): Promise<T[]> {
  const records: T[] = [];
  for (let page = 1; ; page++) {
    const result = await api<Page<T>>(`${path}?page=${page}&pageSize=100`);
    if (!Array.isArray(result.items) || !Number.isInteger(result.total)) throw new Error('Catalog response does not match the shared paginated list contract.');
    records.push(...result.items);
    if (records.length >= result.total) return records;
    if (!result.items.length) throw new Error('Catalog pagination is incomplete.');
  }
}
const newLine = (productId = '', quantity = 1): LineInput => ({ productId, quantity, variantId: null, taxRuleId: null, unitPriceMinor: 0 });
export function DraftForm({ onClose, onSaved, template, onTemplateSaved }: { onClose: () => void; onSaved: (detail: Detail) => void; template?: Template | null; onTemplateSaved?: () => void }) {
  const formTitle = useId();
  const isTemplate = template !== undefined;
  const [name, setName] = useState(template?.name ?? '');
  const [validDays, setValidDays] = useState(template?.validDays ?? 14);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [catalogError, setCatalogError] = useState('');
  const [taxError, setTaxError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [customers, setCustomers] = useState<Page<Customer>>();
  const [customerSearch, setCustomerSearch] = useState('');
  const [customerPage, setCustomerPage] = useState(1);
  const [customerError, setCustomerError] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [planId, setPlanId] = useState(template?.planId ?? '');
  const [startDate, setStartDate] = useState(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
  const [expiryDate, setExpiryDate] = useState('');
  const [paymentTermDays, setPaymentTermDays] = useState(template?.paymentTermDays ?? 7);
  const [lines, setLines] = useState<LineInput[]>(template?.lines ?? []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setCatalogError(''); setTaxError('');
    Promise.allSettled([catalogRecords<Plan>('/catalog/plans'), catalogRecords<Product>('/catalog/products'), catalogRecords<Tax>('/catalog/taxes')]).then(results => {
      if (!active) return;
      if (results[0].status === 'fulfilled' && results[1].status === 'fulfilled') {
        setPlans(results[0].value.filter(item => item.isActive)); setProducts(results[1].value.filter(item => item.isActive));
      } else setCatalogError('Plan and product selection is unavailable. Member 2’s catalog APIs and Member 1’s authentication must be ready before creating a draft.');
      if (results[2].status === 'fulfilled') setTaxes(results[2].value.filter(item => item.isActive));
      else setTaxError('Tax selection is unavailable until the catalog tax API is ready. No tax will be applied.');
      setLoading(false);
    });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    if (isTemplate) return;
    let active = true; setCustomers(undefined); setCustomerError('');
    const timer = setTimeout(() => {
      api<Page<Customer>>(`/subscriptions/customers?${new URLSearchParams({ search: customerSearch, page: String(customerPage) })}`).then(result => { if (active) setCustomers(result); }).catch(error => { if (active) setCustomerError(errorMessage(error)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [customerSearch, customerPage, retry, isTemplate]);
  const plan = plans.find(item => item.id === planId);
  const priced = lines.map((line, index) => {
    const product = products.find(item => item.id === line.productId);
    const variant = product?.variants?.find(item => item.id === line.variantId);
    const unitPriceMinor = (index === 0 ? plan?.priceMinor ?? 0 : product?.salesPriceMinor ?? 0) + (variant?.priceAdjustmentMinor ?? 0);
    const subtotalMinor = Number.isInteger(line.quantity) && line.quantity > 0 ? unitPriceMinor * line.quantity : 0;
    const taxRate = taxes.find(item => item.id === line.taxRuleId)?.rateBps ?? 0;
    const taxMinor = Number.isSafeInteger(subtotalMinor) && subtotalMinor >= 0 ? Number((BigInt(subtotalMinor) * BigInt(taxRate) + 5000n) / 10000n) : 0;
    return { ...line, unitPriceMinor, subtotalMinor, taxMinor };
  });
  const subtotal = priced.reduce((sum, line) => sum + line.subtotalMinor, 0);
  const tax = priced.reduce((sum, line) => sum + line.taxMinor, 0);
  function update(index: number, value: Partial<LineInput>) { setLines(current => current.map((line, i) => i === index ? { ...line, ...value } : line)); }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    if (!plan || (!isTemplate && !customerId) || !lines.length) { setError('Complete the required selections and product lines.'); return; }
    if (isTemplate && !name.trim()) { setError('Enter a template name.'); return; }
    if (!isTemplate && expiryDate && expiryDate <= startDate) { setError('Expiry date must be after start date.'); return; }
    if (subtotal + tax > 2147483647 || priced.some(line => line.unitPriceMinor < 0)) { setError('The total or catalog price is outside the supported range.'); return; }
    setSaving(true);
    try {
      if (isTemplate) {
        await api(`/subscriptions/templates${template ? `/${template.id}` : ''}`, { method: template ? 'PATCH' : 'POST', body: JSON.stringify({ name, validDays, paymentTermDays, planId, lines: priced.map(({ productId, variantId, quantity, unitPriceMinor, taxRuleId }) => ({ productId, variantId, quantity, unitPriceMinor, taxRuleId })) }) });
        onTemplateSaved?.(); return;
      }
      onSaved(await api<Detail>('/subscriptions', { method: 'POST', body: JSON.stringify({ customerId, planId, startDate, expiryDate: expiryDate || null, paymentTermDays, lines: priced.map(({ productId, variantId, quantity, unitPriceMinor, taxRuleId }) => ({ productId, variantId, quantity, unitPriceMinor, taxRuleId })) }) }));
    } catch (error) { setError(errorMessage(error)); } finally { setSaving(false); }
  }
  return <section className="panel sub-editor" aria-labelledby={formTitle}><div className="sub-section-heading"><h2 id={formTitle}>{isTemplate ? template ? 'Edit quotation template' : 'Create quotation template' : 'Create subscription draft'}</h2><span className="badge">{isTemplate ? 'TEMPLATE' : 'DRAFT'}</span></div>
    {loading ? <p role="status">Loading catalog…</p> : catalogError ? <p role="alert" className="sub-error">{catalogError} <button type="button" className="sub-secondary" onClick={() => setRetry(value => value + 1)}>Retry</button></p> : !plans.length || !products.length ? <p className="notice">No active plans or products are available. Ask an administrator to configure the catalog.</p> : null}
    {taxError && <p className="notice">{taxError}</p>}
    <form onSubmit={submit}><fieldset disabled={saving}><legend>{isTemplate ? 'Template and plan' : 'Customer and plan'}</legend><div className="sub-grid">
      {isTemplate ? <><label>Template name<input required maxLength={200} value={name} onChange={event => setName(event.target.value)} /></label><label>Quotation validity (days)<input required type="number" min="1" max="365" step="1" value={validDays} onChange={event => setValidDays(Number(event.target.value))} /></label></> : <><label>Find customer<input type="search" value={customerSearch} onChange={event => { setCustomerSearch(event.target.value); setCustomerPage(1); setCustomerId(''); }} placeholder="Search customer records" /></label><label>Customer<select required value={customerId} onChange={event => setCustomerId(event.target.value)}><option value="">Select customer</option>{customers?.items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.email}</option>)}</select></label></>}
      <label>Plan<select required disabled={loading || !!catalogError} value={planId} onChange={event => { const next = plans.find(item => item.id === event.target.value); setPlanId(event.target.value); setLines(next ? [newLine(next.productId, next.minimumQuantity)] : []); }}><option value="">Select plan</option>{plans.filter(item => products.some(product => product.id === item.productId)).map(item => <option key={item.id} value={item.id}>{item.name} · {formatMoney(item.priceMinor)} / {item.interval.toLowerCase()}</option>)}</select></label>
    </div>{customerError && <p role="alert" className="sub-error">{customerError}</p>}{!isTemplate && !customers && !customerError && <p role="status">Loading customers…</p>}{customers && <div className="sub-pager"><span>{customers.total ? `${customers.total} customers · Page ${customerPage}` : 'No customers found. Add a customer first.'}</span><div className="sub-actions"><button type="button" className="sub-secondary" disabled={customerPage === 1} onClick={() => { setCustomerPage(customerPage - 1); setCustomerId(''); }}>Previous</button><button type="button" className="sub-secondary" disabled={customerPage * 20 >= customers.total} onClick={() => { setCustomerPage(customerPage + 1); setCustomerId(''); }}>Next</button></div></div>}</fieldset>
      <fieldset disabled={saving}><legend>{isTemplate ? 'Payment terms' : 'Dates and payment'}</legend><div className="sub-grid">{!isTemplate && <><label>Start date<input type="date" required value={startDate} onChange={event => setStartDate(event.target.value)} /></label><label>Expiry date (optional)<input type="date" min={startDate} value={expiryDate} onChange={event => setExpiryDate(event.target.value)} /></label></>}<label>Payment terms (days)<input type="number" min="0" max="365" step="1" required value={paymentTermDays} onChange={event => setPaymentTermDays(Number(event.target.value))} /></label></div></fieldset>
      <fieldset disabled={saving || !plan}><legend>Product lines</legend>{priced.map((line, index) => {
        const product = products.find(item => item.id === line.productId);
        return <div className="sub-line" key={index}><h3>{index === 0 ? 'Primary plan product' : `Add-on ${index}`}</h3><div className="sub-grid"><label>Product<select required disabled={index === 0} value={line.productId} onChange={event => update(index, { productId: event.target.value, variantId: null })}><option value="">Select product</option>{products.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Variant<select value={line.variantId ?? ''} onChange={event => update(index, { variantId: event.target.value || null })}><option value="">No variant</option>{product?.variants?.filter(item => item.isActive).map(item => <option key={item.id} value={item.id}>{item.name} ({formatMoney(item.priceAdjustmentMinor)})</option>)}</select></label><label>Quantity<input required type="number" step="1" min={index === 0 ? plan?.minimumQuantity : 1} max="1000000" value={line.quantity} onChange={event => update(index, { quantity: Number(event.target.value) })} /></label><label>Tax rule<select value={line.taxRuleId ?? ''} disabled={!!taxError} onChange={event => update(index, { taxRuleId: event.target.value || null })}><option value="">No tax</option>{taxes.map(item => <option key={item.id} value={item.id}>{item.name} · {item.rateBps / 100}%</option>)}</select></label></div><p>Unit price: {formatMoney(line.unitPriceMinor)} · Subtotal: {formatMoney(line.subtotalMinor)} · Tax: {formatMoney(line.taxMinor)}</p>{index > 0 && <button className="sub-secondary" type="button" onClick={() => setLines(current => current.filter((_, i) => i !== index))}>Remove add-on</button>}</div>;
      })}<button type="button" className="sub-secondary" disabled={lines.length >= 100} onClick={() => setLines(current => [...current, newLine()])}>Add product line</button></fieldset>
      <p className="sub-summary">Subtotal {formatMoney(subtotal)} · Tax {formatMoney(tax)} · Total {formatMoney(subtotal + tax)}</p><p className="muted">Prices follow the catalog. The server validates prices and calculates the saved total.</p>
      {error && <p role="alert" className="sub-error">{error}</p>}<div className="sub-actions"><button disabled={saving || loading || !!catalogError || !plan || (!isTemplate && !customerId)}>{saving ? 'Creating…' : isTemplate ? 'Save template' : 'Create draft'}</button><button type="button" className="sub-secondary" disabled={saving} onClick={onClose}>Cancel</button></div>
    </form>
  </section>;
}
