import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Sidebar from './components/layout/Sidebar';
import TopBar from './components/layout/TopBar';
import ErrorBoundary from './components/layout/ErrorBoundary';
import ProtectedRoute from './components/auth/ProtectedRoute';
import Chat from './pages/Chat';
import Dashboard from './pages/Dashboard';
import Finance from './pages/Finance';
import Deals from './pages/Deals';
import Review from './pages/Review';
import PdfUpload from './pages/PdfUpload';
import Admin from './pages/Admin';
import Settings from './pages/Settings';
import SettingsPage from './pages/Settings/SettingsPage.jsx';
import Login from './pages/Login';
import ClaimMaster from './pages/ClaimMaster';
import AcceptInvite from './pages/AcceptInvite';
import Account from './pages/Account';
import { useAuth } from './context/AuthContext';

function RouteBoundary({ children }) {
  const loc = useLocation();
  return <ErrorBoundary key={loc.pathname}>{children}</ErrorBoundary>;
}

// Unauthenticated layout — no sidebar/topbar, just the form
function PublicShell({ children }) {
  return <div className="flex items-center justify-center h-screen bg-alec-900 text-white">{children}</div>;
}

// Authenticated layout — sidebar + topbar
function AppShell({ children }) {
  return (
    <div className="flex h-screen bg-alec-900 text-white overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <TopBar />
        <main className="flex-1 overflow-auto"><RouteBoundary>{children}</RouteBoundary></main>
      </div>
    </div>
  );
}

export default function App() {
  const { user, ready } = useAuth();

  // During hydration we still render routes so public pages (/login etc.) are usable;
  // ProtectedRoute handles the spinner-or-redirect for authed pages.
  return (
    <Routes>
      {/* Public routes — always accessible */}
      <Route path="/login"         element={<PublicShell><Login /></PublicShell>} />
      <Route path="/claim-master"  element={<PublicShell><ClaimMaster /></PublicShell>} />
      <Route path="/accept-invite" element={<PublicShell><AcceptInvite /></PublicShell>} />

      {/* Protected routes — wrapped in AppShell behind ProtectedRoute */}
      <Route path="/*" element={
        <ProtectedRoute>
          <AppShell>
            <Routes>
              <Route path="/" element={<Navigate to="/chat" replace />} />
              <Route path="/chat"      element={<Chat />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/finance"   element={<Finance />} />
              <Route path="/deals"     element={<Deals />} />
              <Route path="/review"    element={<Review />} />
              <Route path="/pdf"       element={<PdfUpload />} />
              <Route path="/admin"     element={<Admin />} />
              <Route path="/account"   element={<Account />} />
              <Route path="/settings"  element={<SettingsPage />} />
              <Route path="/settings-legacy" element={<Settings />} />
            </Routes>
          </AppShell>
        </ProtectedRoute>
      } />
    </Routes>
  );
}
