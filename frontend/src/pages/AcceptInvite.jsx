import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { acceptInvite } from '../api/auth';
import { useAuth } from '../context/AuthContext';

export default function AcceptInvite() {
  const [sp] = useSearchParams();
  const [token, setToken]       = useState(sp.get('token') || '');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState('');
  const { hydrate } = useAuth();
  const nav = useNavigate();

  // If the invite came via a link with ?token=…, autofocus the name field
  useEffect(() => { if (sp.get('token')) setToken(sp.get('token')); }, [sp]);

  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      await acceptInvite(token, password, fullName);
      await hydrate();
      nav('/chat', { replace: true });
    } catch (e2) {
      setErr(e2.message || 'Invite could not be accepted');
    } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center justify-center h-full">
      <form onSubmit={submit} className="w-full max-w-sm bg-alec-800 rounded-xl p-6 shadow-xl border border-alec-700">
        <h1 className="text-2xl font-semibold mb-1">Accept invite</h1>
        <p className="text-alec-400 text-sm mb-5">Paste the invite token from your email to finish setup.</p>

        {err && <div className="mb-3 text-sm text-red-400 bg-red-900/30 border border-red-800 rounded px-3 py-2">{err}</div>}

        <label className="block text-sm text-alec-300 mb-1">Invite token</label>
        <input className="w-full mb-3 bg-alec-900 border border-alec-700 rounded px-3 py-2 font-mono text-xs"
          value={token} onChange={e => setToken(e.target.value)} required />

        <label className="block text-sm text-alec-300 mb-1">Your name</label>
        <input className="w-full mb-3 bg-alec-900 border border-alec-700 rounded px-3 py-2"
          value={fullName} onChange={e => setFullName(e.target.value)} required />

        <label className="block text-sm text-alec-300 mb-1">Choose a password (min 12)</label>
        <input className="w-full mb-5 bg-alec-900 border border-alec-700 rounded px-3 py-2"
          type="password" minLength={12} value={password} onChange={e => setPassword(e.target.value)} required />

        <button disabled={busy} className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded py-2 font-medium">
          {busy ? 'Accepting…' : 'Accept & sign in'}
        </button>
      </form>
    </div>
  );
}
