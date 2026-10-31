import { Navigate, Outlet, useLocation } from 'react-router-dom';
import type { Role } from '../../../../shared/contracts';
import { useAuth } from './AuthContext';
import { homeForUser, postLoginPath } from './access';

export function SessionStatus() {
  const { status, error, refreshSession } = useAuth();
  return <main className="auth-status"><span className="brand">brightloop<span aria-hidden="true">●</span></span>
    {status === 'error' ? <div className="panel"><h1>Unable to open your workspace.</h1><p className="muted" role="alert">{error}</p><button className="auth-button" onClick={() => { void refreshSession(); }}>Try again</button></div>
      : <p role="status" aria-live="polite">Checking your session…</p>}
  </main>;
}

export function ProtectedRoute({ roles }: { roles?: Role[] }) {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading' || status === 'error') return <SessionStatus />;
  if (!user) return <Navigate to="/account/login" state={{ from: `${location.pathname}${location.search}${location.hash}` }} replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={homeForUser(user)} replace />;
  return <Outlet />;
}

export function PublicAccountRoute() {
  const { status, user } = useAuth();
  const location = useLocation();
  if (status === 'loading' || status === 'error') return <SessionStatus />;
  if (user) return <Navigate to={postLoginPath(user, location.state?.from)} replace />;
  return <Outlet />;
}
