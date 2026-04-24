/**
 * AuthContext — single source of truth for the signed-in user.
 *
 * On mount we call /api/auth/me. If it returns 401, we try /auth/refresh once;
 * if that also fails the user is treated as signed-out and ProtectedRoute
 * redirects to /login.
 */
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { me, refresh, logout as apiLogout } from '../api/auth';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [ready, setReady]     = useState(false);
  const [error, setError]     = useState(null);
  const [needsMaster, setNeedsMaster] = useState(false);

  const hydrate = useCallback(async () => {
    try {
      setUser(await me());
      return true;
    } catch (e) {
      // Try one refresh before giving up (refresh token may still be valid
      // even after the short-lived access token expired).
      try {
        await refresh();
        setUser(await me());
        return true;
      } catch (e2) {
        // Backend returns 409 "Account not yet claimed" when PasswordHash='UNCLAIMED'
        if (/not.?yet.?claimed|claim.?master|no.?master|first.?run/i.test(e2.message || '')) {
          setNeedsMaster(true);
        }
        setUser(null);
        return false;
      }
    }
  }, []);

  useEffect(() => { hydrate().finally(() => setReady(true)); }, [hydrate]);

  const signOut = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, ready, error, needsMaster, hydrate, signOut, setUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
