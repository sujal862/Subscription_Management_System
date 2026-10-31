import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { forgotPasswordSchema, passwordSchema } from '../../../../shared/auth';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useAuth } from './AuthContext';

export function PasswordRecoveryPage({ mode }: { mode: 'forgot' | 'reset' }) {
  const reset = mode === 'reset';
  const location = useLocation();
  const navigate = useNavigate();
  const { clearUser } = useAuth();
  const id = useId();
  const [token, setToken] = useState(() => new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => {
    if (reset && location.hash) {
      setToken(new URLSearchParams(location.hash.slice(1)).get('token') ?? '');
      navigate({ pathname: location.pathname, search: '', hash: '' }, { replace: true });
    }
  }, [reset, location.hash, location.pathname, navigate]);
  const missingToken = reset && !/^[a-f0-9]{64}$/.test(token);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setError(''); setMessage('');
    const parsed = reset ? passwordSchema.safeParse(password) : forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check your details'); return; }
    if (reset && password !== confirmation) { setError('Passwords do not match'); return; }
    if (missingToken) { setInvalid(true); return; }
    const controller = new AbortController(); request.current = controller; setBusy(true);
    try {
      const result = await api<{ message: string }>(reset ? '/auth/reset-password' : '/auth/forgot-password', {
        method: 'POST', signal: controller.signal,
        body: JSON.stringify(reset ? { token, password } : forgotPasswordSchema.parse({ email })),
      });
      if (!controller.signal.aborted) {
        setMessage(result.message);
        if (reset) { clearUser(); setPassword(''); setConfirmation(''); setToken(''); setSuccess(true); }
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(errorMessage(error));
        if (error instanceof ApiError && error.code === 'INVALID_RESET_TOKEN') setInvalid(true);
      }
    } finally { if (request.current === controller) request.current = null; if (!controller.signal.aborted) setBusy(false); }
  }
  return <main className="auth-recovery"><Link className="brand" to="/account/login">brightloop<span aria-hidden="true">●</span></Link><section className="auth-card panel" aria-labelledby={`${id}-title`}>
    <span className="eyebrow">ACCOUNT RECOVERY</span><h1 id={`${id}-title`}>{success ? 'Password updated.' : reset ? 'Choose a new password.' : 'Forgot your password?'}</h1>
    <p className="muted">{success ? 'All previous sessions for your account have been signed out.' : reset ? 'Use a new password to get back to your account.' : 'Enter your registered email address to request a reset link.'}</p>
    {message && <p className="auth-notice" role="status">{message}</p>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {!success && (missingToken || invalid) ? <><p className="auth-error">This reset link is invalid or expired. Request a new link.</p><Link to="/account/forgot-password">Request a new reset link</Link></> : !success && <form onSubmit={submit} noValidate aria-busy={busy}><fieldset disabled={busy}>
      {reset ? <><div className="auth-field"><label htmlFor={`${id}-new`}>New password</label><input id={`${id}-new`} type="password" name="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} maxLength={128} required aria-describedby={`${id}-hint`} /><small className="muted" id={`${id}-hint`}>At least 9 characters, with uppercase, lowercase and a special character.</small></div><div className="auth-field"><label htmlFor={`${id}-confirm`}>Confirm new password</label><input id={`${id}-confirm`} type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} maxLength={128} required /></div></>
        : <div className="auth-field"><label htmlFor={`${id}-email`}>Registered email address</label><input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={event => setEmail(event.target.value)} maxLength={254} required /></div>}
      <button className="auth-button auth-submit" type="submit">{busy ? 'Please wait…' : reset ? 'Update password' : 'Send reset link'}</button>
    </fieldset></form>}
    <p className="auth-switch"><Link to="/account/login">Back to sign in</Link></p>
  </section></main>;
}
