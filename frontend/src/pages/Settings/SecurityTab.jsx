/**
 * frontend/src/pages/Settings/SecurityTab.jsx
 *
 * Account-security surface. Two sections:
 *   1. Change password — requires current password; server-side hashed with
 *      argon2id (or scrypt fallback) in backend/auth/password.js.
 *   2. Recent account activity — last 50 audit-log entries for this user
 *      (logins, password changes, invite actions, etc.), newest first.
 *
 * No 2FA / session-manager yet — tracked in a follow-on spec. The current
 * security model is single-factor password + short-lived access tokens +
 * rotating refresh tokens.
 */
import { useState, useEffect, useCallback } from 'react';
import { changePassword, listAudit } from '../../api/auth.js';
import { useToast } from '../../components/ui/Toast.jsx';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function ChangePasswordCard() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 10) {
      toast.error('New password must be at least 10 characters.');
      return;
    }
    if (next !== confirm) {
      toast.error('New password and confirmation do not match.');
      return;
    }
    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent(''); setNext(''); setConfirm('');
      toast.success('Password updated.');
    } catch (err) {
      toast.error(err?.message || 'Failed to change password', err?.detail);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-alec-700 bg-alec-800 p-5">
      <h3 className="text-base font-semibold text-white">Change password</h3>
      <p className="mt-1 text-xs text-gray-400">
        Minimum 10 characters. Current password required for confirmation.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3 max-w-md">
        <label className="block">
          <span className="text-xs text-gray-300">Current password</span>
          <input
            type="password" autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)}
            className="mt-1 w-full rounded border border-alec-700 bg-alec-900 px-3 py-2 text-sm text-white"
            required
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-300">New password</span>
          <input
            type="password" autoComplete="new-password"
            value={next} onChange={(e) => setNext(e.target.value)}
            className="mt-1 w-full rounded border border-alec-700 bg-alec-900 px-3 py-2 text-sm text-white"
            minLength={10} required
          />
        </label>
        <label className="block">
          <span className="text-xs text-gray-300">Confirm new password</span>
          <input
            type="password" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(e.target.value)}
            className="mt-1 w-full rounded border border-alec-700 bg-alec-900 px-3 py-2 text-sm text-white"
            minLength={10} required
          />
        </label>
        <button
          type="submit" disabled={busy}
          className="rounded bg-alec-accent/80 px-4 py-2 text-sm font-medium text-white hover:bg-alec-accent disabled:opacity-50"
        >
          {busy ? 'Updating…' : 'Update password'}
        </button>
      </form>
    </section>
  );
}

function AuditCard() {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  const reload = useCallback(async () => {
    setErr(null);
    try {
      const r = await listAudit(50);
      setRows(r.entries || []);
    } catch (e) {
      setErr(e?.message || 'Failed to load audit log');
      setRows([]);
    }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  return (
    <section className="mt-6 rounded-lg border border-alec-700 bg-alec-800 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-white">Recent account activity</h3>
        <button
          onClick={reload}
          className="rounded border border-alec-700 px-2 py-1 text-xs text-gray-300 hover:bg-alec-700"
        >
          Refresh
        </button>
      </div>
      {err && <p className="mt-3 text-sm text-red-400">{err}</p>}
      {rows == null && <p className="mt-3 text-sm text-gray-400">Loading…</p>}
      {rows && rows.length === 0 && !err && (
        <p className="mt-3 text-sm text-gray-400">No activity yet.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-alec-700 text-left text-xs uppercase text-gray-500">
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Target</th>
                <th className="py-2 pr-4">IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.AuditId} className="border-b border-alec-900/50">
                  <td className="py-2 pr-4 text-gray-300 whitespace-nowrap">{formatTime(r.CreatedAt)}</td>
                  <td className="py-2 pr-4 text-gray-100">{r.Action}</td>
                  <td className="py-2 pr-4 text-gray-400">{r.Target || '—'}</td>
                  <td className="py-2 pr-4 text-gray-400 font-mono text-xs">{r.Ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default function SecurityTab() {
  return (
    <div className="p-6 max-w-3xl">
      <h2 className="text-lg font-semibold text-white">Security</h2>
      <p className="mt-1 text-sm text-gray-400">
        Manage your account password and review recent activity.
      </p>
      <div className="mt-5">
        <ChangePasswordCard />
        <AuditCard />
      </div>
    </div>
  );
}
