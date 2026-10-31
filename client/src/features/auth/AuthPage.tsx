import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { signupSchema, loginSchema } from '../../../../shared/auth';
import type { PublicUser } from '../../../../shared/contracts';
import { api, errorMessage } from '../../lib/api';
import { useAuth } from './AuthContext';
import './auth.css';

export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const signup = mode === 'signup';
  const { acceptUser, notice } = useAuth();
  const location = useLocation();
  const id = useId();
  const [fields, setFields] = useState({ name: '', email: '', password: '' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);

  function update(field: keyof typeof fields, value: string) {
    setFields(previous => ({ ...previous, [field]: value }));
    setFieldErrors(previous => ({ ...previous, [field]: '' }));
    setError('');
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setError(''); setFieldErrors({});
    const parsed = signup ? signupSchema.safeParse(fields) : loginSchema.safeParse({ email: fields.email, password: fields.password });
    if (!parsed.success) {
      const errors: Record<string, string> = {};
      for (const issue of parsed.error.issues) errors[String(issue.path[0])] ??= issue.message;
      setFieldErrors(errors);
      const first = Object.keys(errors)[0];
      document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setSubmitting(true);
    const controller = new AbortController();
    request.current = controller;
    try {
      const user = await api<PublicUser>(`/auth/${mode}`, { method: 'POST', body: JSON.stringify(parsed.data), signal: controller.signal });
      if (!controller.signal.aborted) acceptUser(user);
    } catch (error) {
      if (!controller.signal.aborted) setError(errorMessage(error));
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setSubmitting(false);
    }
  }

  return <div className="auth-layout">
    <aside className="auth-story"><Link className="brand" to="/account/login">brightloop<span aria-hidden="true">●</span></Link><div><span className="eyebrow">A CLEARER BILLING MONTH</span><h1>Every subscription.<br />One place.</h1><p>Keep your plans, invoices and renewals connected, from the first quotation to the next billing cycle.</p></div><small>Your subscription workspace</small></aside>
    <main className="auth-main"><section className="auth-card" aria-labelledby={`${id}-title`}>
      <span className="eyebrow">{signup ? 'CUSTOMER ACCOUNT' : 'YOUR WORKSPACE'}</span>
      <h2 id={`${id}-title`}>{signup ? 'Create your account.' : 'Welcome back.'}</h2>
      <p className="muted">{signup ? 'View and manage your subscriptions in one place.' : 'Sign in to continue to Brightloop.'}</p>
      {notice && <p className="auth-notice" role="status">{notice}</p>}
      <form onSubmit={submit} noValidate aria-busy={submitting}>
        <fieldset disabled={submitting}>
          {signup && <div className="auth-field"><label htmlFor={`${id}-name`}>Full name</label><input id={`${id}-name`} name="name" autoComplete="name" value={fields.name} onChange={event => update('name', event.target.value)} minLength={2} maxLength={100} required aria-invalid={!!fieldErrors.name} aria-describedby={fieldErrors.name ? `${id}-name-error` : undefined} />{fieldErrors.name && <small className="auth-field-error" id={`${id}-name-error`}>{fieldErrors.name}</small>}</div>}
          <div className="auth-field"><label htmlFor={`${id}-email`}>Email address</label><input id={`${id}-email`} name="email" type="email" autoComplete={signup ? 'email' : 'username'} value={fields.email} onChange={event => update('email', event.target.value)} maxLength={254} required aria-invalid={!!fieldErrors.email} aria-describedby={fieldErrors.email ? `${id}-email-error` : undefined} />{fieldErrors.email && <small className="auth-field-error" id={`${id}-email-error`}>{fieldErrors.email}</small>}</div>
          <div className="auth-field"><label htmlFor={`${id}-password`}>Password</label><div className="auth-password"><input id={`${id}-password`} name="password" type={showPassword ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} value={fields.password} onChange={event => update('password', event.target.value)} maxLength={128} required aria-invalid={!!fieldErrors.password} aria-describedby={`${signup ? `${id}-password-hint ` : ''}${fieldErrors.password ? `${id}-password-error` : ''}`.trim() || undefined} /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? 'Hide' : 'Show'}</button></div>{signup && <small className="muted" id={`${id}-password-hint`}>Use at least 9 characters, with uppercase, lowercase and a special character.</small>}{fieldErrors.password && <small className="auth-field-error" id={`${id}-password-error`}>{fieldErrors.password}</small>}</div>
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-button auth-submit" type="submit">{submitting ? (signup ? 'Creating account…' : 'Signing in…') : (signup ? 'Create account' : 'Sign in')}</button>
          {submitting && <span className="auth-sr-only" role="status">{signup ? 'Creating your account' : 'Signing in'}</span>}
        </fieldset>
      </form>
      {!signup && <p className="auth-forgot"><Link to="/account/forgot-password">Forgot password?</Link></p>}
      <p className="auth-switch">{signup ? 'Already have an account?' : 'New to Brightloop?'} <Link to={signup ? '/account/login' : '/account/signup'} state={location.state}>{signup ? 'Sign in' : 'Create an account'}</Link></p>
    </section></main>
  </div>;
}
