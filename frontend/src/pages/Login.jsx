import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { login } from '../api/auth';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');
  const { hydrate } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const redirectTo = loc.state?.from?.pathname || '/chat';

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await login(email, password);
      await hydrate();
      nav(redirectTo, { replace: true });
    } catch (e2) {
      setErr(e2.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <form onSubmit={submit} className="w-full max-w-sm bg-alec-800 rounded-xl p-6 shadow-xl border border-alec-700">
        <h1 className="text-2xl font-semibold mb-1">A.L.E.C.</h1>
        <p className="text-alec-400 text-sm mb-5">Sign in to continue</p>

        {err && <div className="mb-3 text-sm text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2">{err}</div>}

        <label className="block text-sm text-alec-300 mb-1">Email</label>
        <input className="w-full mb-3 bg-alec-900 border border-alec-700 rounded px-3 py-2"
          type="email" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />

        <label className="block text-sm text-alec-300 mb-1">Password</label>
        <input className="w-full mb-5 bg-alec-900 border border-alec-700 rounded px-3 py-2"
          type="password" value={password} onChange={e => setPassword(e.target.value)} required />

        <button disabled={busy} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded py-2 font-medium">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <div className="mt-4 text-xs text-alec-500">
          Invited? <Link to="/accept-invite" className="text-blue-400 hover:underline">Accept invite</Link>
        </div>
      </form>
    </div>
  );
}
