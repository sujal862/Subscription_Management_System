import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import { businessDate, type Detail } from './types';

const timestamp = (value: string | null) => value ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
export function LifecycleActions({ detail, onSaved }: { detail: Detail; onSaved: (value: Detail, renewed?: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [renewing, setRenewing] = useState(false);
  const [startDate, setStartDate] = useState(detail.expiryDate?.slice(0, 10) ?? '');
  const [expiryDate, setExpiryDate] = useState('');
  async function transition(action: string) {
    setBusy(true); setError('');
    try { onSaved(await api<Detail>(`/subscriptions/${detail.id}/transition`, { method: 'POST', body: JSON.stringify({ action }) })); setConfirmClose(false); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  async function renew(event: FormEvent) {
    event.preventDefault(); setError('');
    if (expiryDate <= startDate) { setError('Renewal expiry must be after the new start date.'); return; }
    setBusy(true);
    try { onSaved(await api<Detail>(`/subscriptions/${detail.id}/renew`, { method: 'POST', body: JSON.stringify({ startDate, expiryDate }) }), true); setRenewing(false); }
    catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  const expired = !!detail.expiryDate && Date.parse(detail.expiryDate) <= Date.now();
  const canClose = detail.plan.allowEarlyClose || expired;
  const renewable = ['ACTIVE', 'PAUSED', 'CLOSED'].includes(detail.status) && detail.plan.allowRenew;
  return <div className="sub-lifecycle" aria-label="Subscription lifecycle">
    <p className="muted">Draft → Quotation → Confirmed → Active → Closed{detail.status === 'PAUSED' ? ' · Currently paused' : ''}</p>
    <dl className="sub-details"><div><dt>Current status</dt><dd>{detail.status}</dd></div><div><dt>Next billing date</dt><dd>{businessDate(detail.nextBillingDate)}</dd></div><div><dt>Billing anchor day</dt><dd>{detail.billingAnchorDay ?? 'Set on activation'}</dd></div>{detail.pausedAt && <div><dt>Paused at</dt><dd>{timestamp(detail.pausedAt)}</dd></div>}{detail.closedAt && <div><dt>Closed at</dt><dd>{timestamp(detail.closedAt)}</dd></div>}</dl>
    {detail.status === 'QUOTATION' && <p>Quotation valid until {timestamp(detail.quotationValidUntil)}.</p>}
    {detail.status === 'CONFIRMED' && <p className="notice">Scheduled to activate from {businessDate(detail.startDate)}. Due subscriptions are checked automatically every minute. Activation preserves the saved billing interval and prices.</p>}
    {detail.status === 'PAUSED' && <p className="notice">Billing is stopped. Resume starts a new billing schedule from the resume date; paused periods are not caught up.</p>}
    <div className="sub-actions">
      {detail.status === 'QUOTATION' && <button disabled={busy || !detail.quotationValidUntil || Date.parse(detail.quotationValidUntil) <= Date.now()} onClick={() => void transition('CONFIRMED')}>Confirm quotation</button>}
      {detail.status === 'CONFIRMED' && <button disabled={busy || Date.parse(detail.startDate) > Date.now()} onClick={() => void transition('ACTIVE')}>Activate subscription</button>}
      {detail.status === 'ACTIVE' && <button className="sub-secondary" disabled={busy || !detail.plan.allowPause || expired} onClick={() => void transition('PAUSED')}>Pause</button>}
      {detail.status === 'PAUSED' && <button disabled={busy || !detail.plan.allowPause || expired} onClick={() => void transition('RESUME')}>Resume</button>}
      {['ACTIVE', 'PAUSED'].includes(detail.status) && <button className="sub-secondary" disabled={busy || !canClose} onClick={() => { setConfirmClose(true); setRenewing(false); }}>Close subscription</button>}
      {renewable && <button className="sub-secondary" disabled={busy} onClick={() => { setRenewing(true); setConfirmClose(false); }}>Renew subscription</button>}
    </div>
    {detail.status === 'ACTIVE' && <p className="muted">Pause and closure require all due billing periods to be processed first. Plan permissions apply. <a href="/billing">Open billing</a></p>}
    {['ACTIVE', 'PAUSED'].includes(detail.status) && detail.expiryDate && <p className="muted">{detail.plan.autoClose ? 'Automatic closure is enabled after expiry and completion of eligible billing periods.' : 'This plan requires manual closure after expiry.'}</p>}
    {confirmClose && <div className="notice"><p>Close {detail.number}? Future billing will stop. Existing invoices and payments are retained.</p><div className="sub-actions"><button disabled={busy} onClick={() => void transition('CLOSED')}>Confirm closure</button><button className="sub-secondary" disabled={busy} onClick={() => setConfirmClose(false)}>Cancel</button></div></div>}
    {renewing && <form onSubmit={renew}><fieldset disabled={busy}><legend>New renewal term</legend><p>The new term starts as a separate draft, linked to this subscription in its line description. Existing invoices are retained.</p><div className="sub-grid"><label>New start date<input required type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label><label>New expiry date<input required type="date" min={startDate} value={expiryDate} onChange={event => setExpiryDate(event.target.value)} /></label></div><div className="sub-actions"><button disabled={busy}>Create renewal draft</button><button type="button" className="sub-secondary" disabled={busy} onClick={() => setRenewing(false)}>Cancel</button></div></fieldset></form>}
    {busy && <p role="status">Updating subscription…</p>}{error && <p className="sub-error" role="alert">{error}</p>}
  </div>;
}

export function ProcessLifecycleButton({ onProcessed }: { onProcessed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  async function process() {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api<{ activated: string[]; closed: string[]; deferred: { id: string; number: string; reason: string }[] }>('/subscriptions/process-lifecycle', { method: 'POST', body: '{}' });
      setNotice(`${result.activated.length} activated · ${result.closed.length} closed · ${result.deferred.length} deferred`);
      if (result.deferred.length) setError(result.deferred.map(item => `${item.number}: ${item.reason}`).join('; '));
      onProcessed();
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <div className="sub-lifecycle-run"><button className="sub-secondary" disabled={busy} onClick={() => void process()}>{busy ? 'Checking due changes…' : 'Process due activations and closures'}</button>{notice && <p role="status">{notice}</p>}{error && <p className="sub-error" role="alert">{error}</p>}</div>;
}
