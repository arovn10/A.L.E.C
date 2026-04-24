import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * Wraps any routes that require a signed-in user. While hydrating, shows a
 * small skeleton so we don't flash the login page to returning visitors.
 */
export default function ProtectedRoute({ children }) {
  const { user, ready, needsMaster } = useAuth();
  const loc = useLocation();

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full text-alec-300">
        <div className="animate-pulse">Loading…</div>
      </div>
    );
  }
  if (needsMaster) return <Navigate to="/claim-master" replace state={{ from: loc }} />;
  if (!user)       return <Navigate to="/login" replace state={{ from: loc }} />;
  return children;
}
