/**
 * frontend/src/pages/Settings/DesktopTab.jsx — S7.7
 *
 * Settings › Desktop — macOS permission probes, policy mode radio,
 * kill-switch, session controls, and an audit list.
 *
 * Double-gated visibility:
 *   1. ALEC_CONNECTORS_V2 feature flag (checked by SettingsPage parent).
 *   2. Desktop build only — hidden when window.electronAPI is absent.
 */
import { useEffect, useState, useCallback } from 'react';
import { useDesktopStatus } from '../../hooks/useDesktopStatus.js';
import {
  probeDesktopPermissions,
  requestDesktopPermission,
  patchDesktopPolicy,
  startDesktopSession,
  endDesktopSession,
  getDesktopAudit,
} from '../../api/desktop.js';

const PERM_LABELS = {
  accessibility: 'Accessibility',
  screen_recording: 'Screen Recording',
  automation: 'Automation (osascript)',
};

const MODE_OPTIONS = [
  { value: 'always_ask', label: 'Always ask before any action' },
  { value: 'session',    label: 'Approve per session, ask for destructive' },
  { value: 'auto_reads', label: 'Auto-allow safe reads, ask for writes' },
];

export default function DesktopTab() {
  const { data, loading, refetch } = useDesktopStatus();
  const [audit, setAudit] = useState([]);
  const [busy, setBusy] = useState(false);

  const loadAudit = useCallback(async () => {
    try {
      const r = await getDesktopAudit(50);
      setAudit(r.audit || []);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadAudit(); }, [loadAudit]);

  const onProbe = async () => {
    setBusy(true);
    try {
      // Ask Electron to run native probes first (results get pushed back
      // through the next status fetch via backend's own probe endpoint).
      if (window?.electronAPI?.desktop?.probe) {
        await window.electronAPI.desktop.probe().catch(() => {});
      }
      await probeDesktopPermissions();
      await refetch();
    } finally { setBusy(false); }
  };

  const onRequest = async (id) => {
    setBusy(true);
    try {
      const r = await requestDesktopPermission(id);
      if (r?.deeplink && window?.alec?.openBrowser) {
        // Open System Settings pane via OS handler
        window.open(r.deeplink);
      }
      await onProbe();
    } finally { setBusy(false); }
  };

  const onMode = async (mode) => {
    setBusy(true);
    try {
      await patchDesktopPolicy({ mode });
      await refetch();
    } finally { setBusy(false); }
  };

  const onToggleKill = async () => {
    setBusy(true);
    try {
      const next = !data?.kill_switch;
      await patchDesktopPolicy({ kill_switch: next });
      await refetch();
    } finally { setBusy(false); }
  };

  const onSessionStart = async () => {
    setBusy(true);
    try { await startDesktopSession(); await refetch(); await loadAudit(); }
    finally { setBusy(false); }
  };
  const onSessionEnd = async () => {
    setBusy(true);
    try { await endDesktopSession(); await refetch(); await loadAudit(); }
    finally { setBusy(false); }
  };

  if (loading && !data) {
    return <div className="p-6 text-gray-400">Loading desktop status…</div>;
  }

  const permissions = data?.permissions || [];
  const mode = data?.policy?.mode || 'session';
  const killed = !!data?.kill_switch;
  const active = !!data?.active_session;

  return (
    <div className="p-6 space-y-6 text-gray-200">
      <h2 className="text-lg font-semibold text-white">Desktop control</h2>

      {/* macOS permissions */}
      <section className="rounded border border-alec-700 bg-alec-800 p-4">
        <h3 className="mb-3 text-sm font-medium text-white">macOS permissions</h3>
        <ul className="divide-y divide-alec-700">
          {permissions.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span className="flex items-center gap-2">
                <span className={`h-2 w-2 rounded-full ${p.granted ? 'bg-green-500' : 'bg-gray-500'}`} />
                <span>{PERM_LABELS[p.id] || p.id}</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs text-gray-400">
                  {p.granted ? 'Granted' : 'Not granted'}
                </span>
                <button
                  className="rounded bg-alec-700 px-2 py-1 text-xs hover:bg-alec-600 disabled:opacity-50"
                  disabled={busy}
                  onClick={() => onRequest(p.id)}
                >
                  {p.granted ? 'Revoke' : 'Request'}
                </button>
              </span>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <button className="text-xs text-blue-400 hover:underline" disabled={busy} onClick={onProbe}>
            Re-check permissions
          </button>
        </div>
      </section>

      {/* Policy */}
      <section className="rounded border border-alec-700 bg-alec-800 p-4">
        <h3 className="mb-3 text-sm font-medium text-white">Action policy</h3>
        <div className="space-y-2">
          {MODE_OPTIONS.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="desktop-mode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => onMode(opt.value)}
                disabled={busy}
              />
              {opt.label}
            </label>
          ))}
        </div>
      </section>

      {/* Kill-switch */}
      <section className="rounded border border-alec-700 bg-alec-800 p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-white">Kill-switch</h3>
          <p className="text-xs text-gray-400">
            {killed ? 'Desktop control is disabled for every caller.' : 'Desktop control is enabled.'}
          </p>
        </div>
        <button
          onClick={onToggleKill}
          disabled={busy}
          className={`rounded px-3 py-2 text-sm font-medium ${
            killed ? 'bg-green-600 hover:bg-green-500' : 'bg-red-600 hover:bg-red-500'
          } disabled:opacity-50`}
        >
          {killed ? 'Enable desktop control' : 'Disable desktop control'}
        </button>
      </section>

      {/* Session */}
      <section className="rounded border border-alec-700 bg-alec-800 p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-white">Approve-session</h3>
          <p className="text-xs text-gray-400">
            {active
              ? `Active until ${new Date(data.session_expires_at).toLocaleTimeString()}`
              : 'No active session (writes require per-action approval).'}
          </p>
        </div>
        {active ? (
          <button onClick={onSessionEnd} disabled={busy}
            className="rounded bg-alec-700 px-3 py-2 text-sm hover:bg-alec-600 disabled:opacity-50">
            End session
          </button>
        ) : (
          <button onClick={onSessionStart} disabled={busy}
            className="rounded bg-blue-600 px-3 py-2 text-sm hover:bg-blue-500 disabled:opacity-50">
            Start 1-hour session
          </button>
        )}
      </section>

      {/* Recent actions */}
      <section className="rounded border border-alec-700 bg-alec-800 p-4">
        <h3 className="mb-3 text-sm font-medium text-white">Recent actions</h3>
        {audit.length === 0 ? (
          <p className="text-xs text-gray-400">No desktop actions yet.</p>
        ) : (
          <ul className="divide-y divide-alec-700 max-h-80 overflow-auto">
            {audit.map(row => (
              <li key={row.id} className="py-2 text-xs">
                <span className="text-gray-400 mr-2">{row.created_at}</span>
                <span className="font-mono text-white">{row.action}</span>
                <span className="text-gray-400 ml-2">by {row.user_id}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
