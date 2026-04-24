/**
 * frontend/src/pages/Admin.jsx — Sprint 3
 *
 * Admin People UI. Three tabs:
 *   - Users   : list/suspend/scope
 *   - Invites : create invite (with dashboard multi-select) + list outstanding
 *   - Me      : quick self-info so Alec can confirm Master identity
 *
 * Route-gated: the page renders but each action calls admin APIs that are
 * server-gated by mw.requireRole('Admin'). Non-admins get friendly errors.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  listUsers, setUserSuspended, grantScope, revokeScope,
  listInvites, createInvite, listDomoDashboards, getMe,
} from '../api/admin';

const ROLES = ['Viewer', 'Analyst', 'Admin', 'Master'];

function Section({ title, right, children }) {
  return (
    <section className="bg-alec-800/40 border border-alec-700 rounded-xl p-4 mb-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-200 uppercase tracking-wide">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Toast({ msg, kind = 'info' }) {
  if (!msg) return null;
  const color = kind === 'error' ? 'bg-red-900/40 border-red-700/40 text-red-200'
             : kind === 'ok'    ? 'bg-green-900/40 border-green-700/40 text-green-200'
             : 'bg-sky-900/40 border-sky-700/40 text-sky-200';
  return <div className={`text-xs rounded-md border px-3 py-2 mb-3 ${color}`}>{msg}</div>;
}

// ─────────────────────────────────────────────────────────────
// Users tab
// ─────────────────────────────────────────────────────────────
function UsersTab({ onError, onOk }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingScopes, setEditingScopes] = useState(null); // userId
  const [scopeInput, setScopeInput] = useState({ type: 'project', value: '' });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listUsers();
      setRows(res.data || []);
    } catch (e) { onError(e.message); }
    finally { setLoading(false); }
  }, [onError]);

  useEffect(() => { refresh(); }, [refresh]);

  async function toggleSuspend(u) {
    try {
      await setUserSuspended(u.userId, !u.suspended);
      onOk(`${u.email} ${!u.suspended ? 'suspended' : 'reinstated'}`);
      refresh();
    } catch (e) { onError(e.message); }
  }

  async function handleGrant(u) {
    const { type, value } = scopeInput;
    if (!value.trim()) return onError('Scope value required');
    try {
      await grantScope(u.userId, type, value.trim());
      onOk(`Granted ${type}=${value} to ${u.email}`);
      setScopeInput({ type, value: '' });
      refresh();
    } catch (e) { onError(e.message); }
  }
  async function handleRevoke(u, s) {
    try {
      await revokeScope(u.userId, s.type, s.value);
      onOk(`Revoked ${s.type}=${s.value} from ${u.email}`);
      refresh();
    } catch (e) { onError(e.message); }
  }

  if (loading) return <div className="text-gray-400 text-sm">Loading users…</div>;
  if (!rows.length) return <div className="text-gray-500 text-sm">No users yet.</div>;

  return (
    <div className="space-y-2">
      {rows.map(u => (
        <div key={u.userId} className="border border-alec-700 rounded-lg p-3 bg-alec-900/40">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-white font-medium">
                {u.fullName || '(no name)'} <span className="text-gray-500 font-normal">· {u.email}</span>
              </div>
              <div className="text-xs text-gray-400 mt-0.5">
                Role <span className="text-purple-300">{u.role}</span>
                {u.suspended && <span className="ml-2 text-red-400">· SUSPENDED</span>}
                {!u.claimed && <span className="ml-2 text-yellow-400">· unclaimed</span>}
                {u.lastLoginAt && <span className="ml-2">· last login {new Date(u.lastLoginAt).toLocaleString()}</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setEditingScopes(editingScopes === u.userId ? null : u.userId)}
                className="text-xs px-3 py-1 rounded-md bg-alec-700 hover:bg-alec-600 text-white transition-colors"
              >
                {editingScopes === u.userId ? 'Close' : 'Scopes'}
              </button>
              <button
                onClick={() => toggleSuspend(u)}
                className={`text-xs px-3 py-1 rounded-md transition-colors ${
                  u.suspended
                    ? 'bg-green-800/60 hover:bg-green-700 text-white'
                    : 'bg-red-900/60 hover:bg-red-800 text-white'
                }`}
              >
                {u.suspended ? 'Reinstate' : 'Suspend'}
              </button>
            </div>
          </div>

          {editingScopes === u.userId && (
            <div className="mt-3 pt-3 border-t border-alec-700/60">
              <div className="flex flex-wrap gap-1 mb-2">
                {(u.scopes || []).length === 0 && (
                  <span className="text-xs text-gray-500 italic">No explicit scopes (role-default only)</span>
                )}
                {(u.scopes || []).map((s, i) => (
                  <span key={i} className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-900/40 border border-purple-700/40 text-purple-200">
                    {s.type}={s.value}
                    <button
                      onClick={() => handleRevoke(u, s)}
                      className="ml-1 text-purple-300 hover:text-red-300"
                      title="Revoke"
                    >×</button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2 items-center">
                <select
                  value={scopeInput.type}
                  onChange={(e) => setScopeInput(s => ({ ...s, type: e.target.value }))}
                  className="bg-alec-900 border border-alec-700 text-xs text-white rounded px-2 py-1"
                >
                  <option value="project">project</option>
                  <option value="property">property</option>
                  <option value="domo_dashboard">domo_dashboard</option>
                  <option value="report">report</option>
                  <option value="*">*</option>
                </select>
                <input
                  value={scopeInput.value}
                  onChange={(e) => setScopeInput(s => ({ ...s, value: e.target.value }))}
                  placeholder="value (or *)"
                  className="flex-1 bg-alec-900 border border-alec-700 text-xs text-white rounded px-2 py-1"
                />
                <button
                  onClick={() => handleGrant(u)}
                  className="text-xs px-3 py-1 rounded-md bg-purple-700 hover:bg-purple-600 text-white"
                >Grant</button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Invites tab
// ─────────────────────────────────────────────────────────────
function InvitesTab({ onError, onOk }) {
  const [invites, setInvites] = useState([]);
  const [dashboards, setDashboards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ email: '', role: 'Viewer', dashboardIds: [] });
  const [lastUrl, setLastUrl] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [iRes, dRes] = await Promise.all([
        listInvites().catch(e => ({ data: [], _err: e.message })),
        listDomoDashboards().catch(e => ({ data: [], _err: e.message })),
      ]);
      setInvites(iRes.data || []);
      setDashboards(dRes.data || []);
    } catch (e) { onError(e.message); }
    finally { setLoading(false); }
  }, [onError]);

  useEffect(() => { refresh(); }, [refresh]);

  const toggleDashboard = (id) => setForm(f => ({
    ...f,
    dashboardIds: f.dashboardIds.includes(id)
      ? f.dashboardIds.filter(x => x !== id)
      : [...f.dashboardIds, id],
  }));

  async function handleCreate(e) {
    e.preventDefault();
    if (!form.email.trim()) return onError('Email required');
    const scopes = form.dashboardIds.map(id => ({ type: 'domo_dashboard', value: id }));
    try {
      const res = await createInvite({
        email: form.email.trim(), role: form.role, scopes,
      });
      onOk(`Invite created (expires ${new Date(res.expiresAt).toLocaleDateString()})`);
      setLastUrl(res.inviteUrl);
      setForm({ email: '', role: 'Viewer', dashboardIds: [] });
      refresh();
    } catch (e) { onError(e.message); }
  }

  const copyUrl = async () => {
    if (!lastUrl) return;
    try { await navigator.clipboard.writeText(lastUrl); onOk('Copied'); }
    catch { onError('Copy failed'); }
  };

  return (
    <>
      <Section title="Create invite">
        <form onSubmit={handleCreate} className="space-y-3">
          <div className="flex gap-2">
            <input
              type="email"
              required
              placeholder="email@example.com"
              value={form.email}
              onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
              className="flex-1 bg-alec-900 border border-alec-700 text-sm text-white rounded-md px-3 py-2 placeholder-gray-500"
            />
            <select
              value={form.role}
              onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}
              className="bg-alec-900 border border-alec-700 text-sm text-white rounded-md px-3 py-2"
            >
              {ROLES.filter(r => r !== 'Master').map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">
              Domo dashboards ({form.dashboardIds.length} selected)
            </div>
            <div className="flex flex-wrap gap-1 max-h-36 overflow-y-auto border border-alec-700 rounded-md p-2 bg-alec-900/40">
              {dashboards.length === 0 ? (
                <span className="text-xs text-gray-500 italic">No Domo dashboards in catalog yet.</span>
              ) : dashboards.map(d => {
                const on = form.dashboardIds.includes(d.id);
                return (
                  <button
                    type="button"
                    key={d.id}
                    onClick={() => toggleDashboard(d.id)}
                    className={`text-xs px-2 py-1 rounded-full border transition-colors ${
                      on
                        ? 'bg-purple-700 border-purple-500 text-white'
                        : 'bg-alec-900 border-alec-700 text-gray-300 hover:border-purple-500'
                    }`}
                    title={d.description || ''}
                  >
                    {on ? '✓ ' : '+ '}{d.name}
                  </button>
                );
              })}
            </div>
          </div>
          <button
            type="submit"
            className="text-sm px-4 py-2 rounded-md bg-purple-700 hover:bg-purple-600 text-white font-medium"
          >Send invite</button>
        </form>
        {lastUrl && (
          <div className="mt-3 p-2 bg-alec-900 rounded border border-alec-700 text-xs break-all flex items-center gap-2">
            <span className="text-gray-300 flex-1">{lastUrl}</span>
            <button onClick={copyUrl} className="px-2 py-0.5 rounded bg-alec-700 hover:bg-alec-600 text-white">Copy</button>
          </div>
        )}
      </Section>

      <Section title="Outstanding invites">
        {loading ? (
          <div className="text-gray-400 text-sm">Loading…</div>
        ) : invites.length === 0 ? (
          <div className="text-gray-500 text-sm">No invites on file.</div>
        ) : (
          <div className="space-y-1">
            {invites.map(i => (
              <div key={i.inviteId} className="flex items-center justify-between text-sm text-gray-300 px-2 py-1 border-b border-alec-800">
                <span>{i.email} <span className="text-xs text-purple-300">· {i.role}</span></span>
                <span className="text-xs text-gray-500">
                  {i.consumedAt
                    ? <span className="text-green-400">accepted {new Date(i.consumedAt).toLocaleDateString()}</span>
                    : new Date(i.expiresAt) < new Date()
                      ? <span className="text-red-400">expired</span>
                      : <>pending · expires {new Date(i.expiresAt).toLocaleDateString()}</>}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Me tab
// ─────────────────────────────────────────────────────────────
function MeTab({ onError }) {
  const [me, setMe] = useState(null);
  useEffect(() => {
    getMe().then(r => setMe(r.user)).catch(e => onError(e.message));
  }, [onError]);
  if (!me) return <div className="text-gray-400 text-sm">Loading…</div>;
  return (
    <pre className="text-xs text-gray-300 bg-alec-900/40 border border-alec-700 rounded-md p-3 overflow-x-auto">
{JSON.stringify(me, null, 2)}
    </pre>
  );
}

// ─────────────────────────────────────────────────────────────
// Page shell
// ─────────────────────────────────────────────────────────────
export default function Admin() {
  const [tab, setTab] = useState('users');
  const [toast, setToast] = useState(null);

  const tabs = useMemo(() => ([
    { id: 'users',   label: 'People' },
    { id: 'invites', label: 'Invites' },
    { id: 'me',      label: 'My identity' },
  ]), []);

  const onError = useCallback((msg) => {
    setToast({ kind: 'error', msg });
    setTimeout(() => setToast(null), 4000);
  }, []);
  const onOk = useCallback((msg) => {
    setToast({ kind: 'ok', msg });
    setTimeout(() => setToast(null), 3000);
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-lg font-semibold text-white">Admin</h1>
        <div className="flex gap-1 bg-alec-800 p-1 rounded-lg">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
                tab === t.id ? 'bg-purple-700 text-white' : 'text-gray-400 hover:text-white'
              }`}
            >{t.label}</button>
          ))}
        </div>
      </div>
      {toast && <Toast msg={toast.msg} kind={toast.kind} />}
      {tab === 'users'   && <UsersTab onError={onError} onOk={onOk} />}
      {tab === 'invites' && <InvitesTab onError={onError} onOk={onOk} />}
      {tab === 'me'      && <MeTab onError={onError} />}
    </div>
  );
}
