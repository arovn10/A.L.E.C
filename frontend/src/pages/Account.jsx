import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../api/client';

export default function Account() {
  const { user, signOut } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [oldPw, setOldPw]       = useState('');
  const [newPw, setNewPw]       = useState('');
  const [msg, setMsg]           = useState('');
  const [err, setErr]           = useState('');

  useEffect(() => {
    apiFetch('/auth/sessions').then(r => setSessions(r.sessions || [])).catch(() => {});
  }, []);

  const changePw = async (e) => {
    e.preventDefault(); setErr(''); setMsg('');
    try {
      await apiFetch('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ oldPassword: oldPw, newPassword: newPw }),
      });
      setMsg('Password updated.');
      setOldPw(''); setNewPw('');
    } catch (e2) { setErr(e2.message || 'Failed'); }
  };

  if (!user) return null;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Account</h1>
        <p className="text-alec-400 text-sm">Signed in as {user.email} ({user.role || 'user'})</p>
      </div>

      <section className="bg-alec-800 border border-alec-700 rounded-xl p-5">
        <h2 className="text-lg font-medium mb-3">Change password</h2>
        {msg && <div className="mb-2 text-sm text-emerald-400">{msg}</div>}
        {err && <div className="mb-2 text-sm text-red-400">{err}</div>}
        <form onSubmit={changePw} className="space-y-3">
          <input className="w-full bg-alec-900 border border-alec-700 rounded px-3 py-2"
            type="password" placeholder="Current password" value={oldPw} onChange={e=>setOldPw(e.target.value)} required />
          <input className="w-full bg-alec-900 border border-alec-700 rounded px-3 py-2"
            type="password" placeholder="New password (min 12)" minLength={12} value={newPw} onChange={e=>setNewPw(e.target.value)} required />
          <button className="bg-blue-600 hover:bg-blue-500 rounded px-4 py-2">Update password</button>
        </form>
      </section>

      <section className="bg-alec-800 border border-alec-700 rounded-xl p-5">
        <h2 className="text-lg font-medium mb-3">Active sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-alec-400 text-sm">No active sessions returned from server.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {sessions.map(s => (
              <li key={s.id} className="flex justify-between border-b border-alec-700 pb-1">
                <span>{s.device || 'Unknown'} — {s.lastSeen || ''}</span>
                <span className="text-alec-500">{s.current ? '(this device)' : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <button onClick={signOut} className="bg-red-700 hover:bg-red-600 rounded px-4 py-2">Sign out</button>
    </div>
  );
}
