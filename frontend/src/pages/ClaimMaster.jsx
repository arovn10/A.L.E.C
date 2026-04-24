import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { claimMaster } from '../api/auth';
import { useAuth } from '../context/AuthContext';

// Hardcoded in backend/auth/roles.js:MASTER_EMAIL — shown read-only for clarity.
const MASTER_EMAIL = 'arovner@stoagroup.com';

export default function ClaimMaster() {
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [busy,     setBusy]     = useState(false);
  const [err,      setErr]      = useState('');
  const { hydrate } = useAuth();
  const nav = useNavigate();

  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    if (password.length < 12)       return setErr('Password must be at least 12 characters.');
    if (password !== confirm)       return setErr('Passwords do not match.');
    setBusy(true);
    try {
      await claimMaster(password);  // claim + auto-login
      await hydrate();
      nav('/chat', { replace: true });
    } catch (e2) {
      const msg = e2.message || 'Could not claim master account';
      // Backend returns 409 "Master already claimed" — steer the user to /login.
      if (/already claimed/i.test(msg)) {
        setErr('Master already claimed — taking you to sign-in…');
        setTimeout(() => nav('/login', { replace: true }), 1200);
      } else {
        setErr(msg);
      }
    } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <form onSubmit={submit} className="w-full max-w-sm bg-alec-800 rounded-xl p-6 shadow-xl border border-alec-700">
        <h1 className="text-2xl font-semibold mb-1">First-time setup</h1>
        <p className="text-alec-400 text-sm mb-5">
          Set the master password. This can only be done once, from this machine.
        </p>

        {err && <div className="mb-3 text-sm text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2">{err}</div>}

        <label className="block text-sm text-alec-300 mb-1">Master email (fixed)</label>
        <input readOnly value={MASTER_EMAIL}
          className="w-full mb-4 bg-alec-900/60 border border-alec-700 rounded px-3 py-2 text-alec-400 cursor-not-allowed" />

        <label className="block text-sm text-alec-300 mb-1">Password (min 12 chars)</label>
        <input className="w-full mb-3 bg-alec-900 border border-alec-700 rounded px-3 py-2"
          type="password" minLength={12} autoFocus
          value={password} onChange={e => setPassword(e.target.value)} required />

        <label className="block text-sm text-alec-300 mb-1">Confirm password</label>
        <input className="w-full mb-5 bg-alec-900 border border-alec-700 rounded px-3 py-2"
          type="password" minLength={12}
          value={confirm} onChange={e => setConfirm(e.target.value)} required />

        <button disabled={busy} className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 rounded py-2 font-medium">
          {busy ? 'Setting up…' : 'Set password & sign in'}
        </button>

        <p className="mt-4 text-xs text-alec-500">
          This flow is restricted to <code>127.0.0.1</code>/<code>localhost</code> by the backend.
        </p>
      </form>
    </div>
  );
}
