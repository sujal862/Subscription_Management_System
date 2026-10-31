import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { PublicUser } from '../../../../shared/contracts';
import { api, ApiError, errorMessage, SESSION_EXPIRED_EVENT } from '../../lib/api';

interface SessionState {
  status: 'loading' | 'authenticated' | 'anonymous' | 'error';
  user: PublicUser | null;
  error: string;
  notice: string;
}
interface AuthState extends SessionState {
  refreshSession: () => Promise<void>;
  acceptUser: (user: PublicUser) => void;
  logout: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: 'loading', user: null, error: '', notice: '' });
  const version = useRef(0);
  const refreshSession = useCallback(async () => {
    const request = ++version.current;
    setSession({ status: 'loading', user: null, error: '', notice: '' });
    try {
      const user = await api<PublicUser>('/auth/me');
      if (request === version.current) setSession({ status: 'authenticated', user, error: '', notice: '' });
    } catch (error) {
      if (request !== version.current) return;
      setSession(error instanceof ApiError && error.status === 401
        ? { status: 'anonymous', user: null, error: '', notice: '' }
        : { status: 'error', user: null, error: errorMessage(error), notice: '' });
    }
  }, []);

  useEffect(() => {
    void refreshSession();
    const expired = () => {
      version.current++;
      setSession({ status: 'anonymous', user: null, error: '', notice: 'Your session has expired. Please sign in again.' });
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => { version.current++; window.removeEventListener(SESSION_EXPIRED_EVENT, expired); };
  }, [refreshSession]);

  const acceptUser = useCallback((user: PublicUser) => {
    version.current++;
    setSession({ status: 'authenticated', user, error: '', notice: '' });
  }, []);
  const logout = useCallback(async () => {
    // Keep the current workspace if logout fails; never pretend the cookie was revoked.
    await api('/auth/logout', { method: 'POST' });
    version.current++;
    setSession({ status: 'anonymous', user: null, error: '', notice: '' });
  }, []);

  const value = useMemo(() => ({ ...session, refreshSession, acceptUser, logout }), [session, refreshSession, acceptUser, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be inside AuthProvider');
  return context;
}
