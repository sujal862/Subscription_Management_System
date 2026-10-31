import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../features/auth/AuthContext';
import { homeForUser, navigationForUser } from '../features/auth/access';
import { errorMessage } from '../lib/api';
import './layout.css';

export function Layout() {
  const { user, logout } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');
  if (!user) return null;
  async function signOut() {
    if (signingOut) return;
    setSigningOut(true); setError('');
    try { await logout(); } catch (error) { setError(errorMessage(error)); }
    finally { setSigningOut(false); }
  }
  return <div className="workspace"><aside className="sidebar">
    <NavLink className="brand" to={homeForUser(user)}>brightloop<span aria-hidden="true">●</span></NavLink>
    <nav aria-label={user.role === 'CUSTOMER' ? 'Customer portal navigation' : 'Workspace navigation'}>
      {navigationForUser(user).map(({ to, label }) => <NavLink key={to} to={to} end={to === '/'}>{label}</NavLink>)}
    </nav>
    <div className="workspace-identity"><div><strong>{user.name}</strong><small>{user.email}</small><small className="workspace-role">{user.role.toLowerCase()}</small></div>
      <button type="button" className="workspace-signout" disabled={signingOut} onClick={() => { void signOut(); }}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
      {error && <p className="workspace-logout-error" role="alert">{error}</p>}
    </div>
  </aside><main className="page-content"><Outlet /></main></div>;
}
