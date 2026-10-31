import { useEffect, useId, useState, type FormEvent } from 'react';
import type { Page, PublicUser } from '../../../../shared/contracts';
import { signupSchema } from '../../../../shared/auth';
import { api, errorMessage } from '../../lib/api';
import './staff.css';

export function StaffPage() {
  const id = useId();
  const [list, setList] = useState<Page<PublicUser> | null>(null);
  const [search, setSearch] = useState(''); const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0); const [listError, setListError] = useState('');
  const [fields, setFields] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setList(null); setListError('');
    const timer = setTimeout(() => {
      api<Page<PublicUser>>(`/staff?${new URLSearchParams({ page: String(page), pageSize: '20', search })}`, { signal: controller.signal })
        .then(result => { if (!controller.signal.aborted) setList(result); })
        .catch(error => { if (!controller.signal.aborted) setListError(errorMessage(error)); });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [page, search, revision]);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setError(''); setMessage('');
    const parsed = signupSchema.safeParse(fields);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the form'); return; }
    setBusy(true);
    try {
      await api<PublicUser>('/staff', { method: 'POST', body: JSON.stringify(parsed.data) });
      setFields({ name: '', email: '', password: '' }); setPage(1); setSearch(''); setRevision(value => value + 1);
      setMessage('Staff account created. The new team member can sign in or request a password reset using their email.');
    } catch (error) { setError(errorMessage(error)); } finally { setBusy(false); }
  }
  return <section className="staff-feature"><header className="page-heading"><div><span className="eyebrow">ADMINISTRATION</span><h1>Team access</h1><p className="muted">Create staff accounts with access to day-to-day operations.</p></div><span className="badge">Administrator only</span></header>
    <div className="staff-grid"><section className="panel" aria-labelledby={`${id}-create`}><h2 id={`${id}-create`}>Add a staff member</h2><p className="muted staff-intro">Staff can manage customers and billing. Administration and catalog changes stay restricted.</p>
      <form onSubmit={submit} noValidate aria-busy={busy}><fieldset disabled={busy}>
        <label htmlFor={`${id}-name`}>Full name</label><input id={`${id}-name`} name="name" autoComplete="name" value={fields.name} onChange={event => setFields({ ...fields, name: event.target.value })} minLength={2} maxLength={100} required />
        <label htmlFor={`${id}-email`}>Staff email address</label><input id={`${id}-email`} name="email" type="email" autoComplete="off" value={fields.email} onChange={event => setFields({ ...fields, email: event.target.value })} maxLength={254} required />
        <label htmlFor={`${id}-password`}>Initial password</label><input id={`${id}-password`} name="password" type="password" autoComplete="new-password" value={fields.password} onChange={event => setFields({ ...fields, password: event.target.value })} maxLength={128} required aria-describedby={`${id}-hint`} /><small id={`${id}-hint`}>At least 9 characters, with uppercase, lowercase and a special character.</small>
        {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-notice" role="status">{message}</p>}
        <button className="auth-button" type="submit">{busy ? 'Creating account…' : 'Create staff account'}</button>
      </fieldset></form></section>
      <section className="panel" aria-labelledby={`${id}-list`}><div className="staff-list-heading"><h2 id={`${id}-list`}>Staff members</h2><button className="staff-secondary" onClick={() => setRevision(value => value + 1)}>Refresh list</button></div><label htmlFor={`${id}-search`}>Search staff</label><input id={`${id}-search`} type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder="Name or email" />
        {listError ? <p className="auth-error" role="alert">{listError}</p> : !list ? <p role="status">Loading staff members…</p> : <><div className="staff-table-wrap"><table><caption className="auth-sr-only">Staff accounts</caption><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>{list.items.map(user => <tr key={user.id}><td>{user.name}</td><td>{user.email}</td><td>Staff</td></tr>)}</tbody></table></div>{!list.items.length && <p className="muted">No staff members match your search.</p>}<div className="staff-pagination"><small>{list.total} staff accounts · Page {list.page} of {Math.max(1, Math.ceil(list.total / list.pageSize))}</small><div><button className="staff-secondary" disabled={page === 1} onClick={() => setPage(value => value - 1)}>Previous</button><button className="staff-secondary" disabled={page * list.pageSize >= list.total} onClick={() => setPage(value => value + 1)}>Next</button></div></div></>}
      </section></div>
  </section>;
}
