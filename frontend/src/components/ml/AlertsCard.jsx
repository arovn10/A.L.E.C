/**
 * frontend/src/components/ml/AlertsCard.jsx
 *
 * Dashboard card — live feed of ML alerts (CI breaches, regime shifts,
 * demotions). Admin can acknowledge a row to hide it.
 */
import { useEffect, useState } from 'react';
import { listAlerts, ackAlert } from '../../api/ml';

const SEV_STYLE = {
  crit: 'text-red-400 border-red-500/40 bg-red-500/5',
  warn: 'text-amber-400 border-amber-500/40 bg-amber-500/5',
  info: 'text-alec-300 border-alec-600 bg-alec-700/20',
};

export default function AlertsCard() {
  const [alerts, setAlerts] = useState(null);
  const [err, setErr] = useState(null);

  async function load() {
    setErr(null);
    try { const { data } = await listAlerts(); setAlerts(data || []); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function onAck(id) {
    try { await ackAlert(id); setAlerts(a => a.filter(x => x.AlertId !== id)); }
    catch (e) { setErr(e.message); }
  }

  const unack = (alerts || []).filter(a => !a.Acknowledged);

  return (
    <div className="rounded-lg bg-alec-800 p-4 shadow">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-white">ML Alerts</h3>
        <button onClick={load} className="text-xs text-alec-300 hover:text-white">Refresh</button>
      </div>
      {err && <div className="text-red-400 text-sm">Error: {err}</div>}
      {!alerts && !err && <div className="text-alec-400 text-sm">Loading…</div>}
      {alerts && unack.length === 0 && (
        <div className="text-alec-400 text-sm">No open alerts. Breaches and regime shifts will show up here.</div>
      )}
      <ul className="space-y-2">
        {unack.slice(0, 25).map(a => (
          <li key={a.AlertId}
              className={`text-xs rounded border px-3 py-2 flex items-start justify-between gap-2 ${SEV_STYLE[a.Severity] || SEV_STYLE.info}`}>
            <div>
              <div className="uppercase tracking-wide text-[10px] opacity-80">
                {a.Severity} · {a.Kind}
              </div>
              <div className="font-mono text-white/90">{a.Target}</div>
              <div className="mt-1 opacity-90">{a.Message}</div>
              <div className="mt-1 opacity-60">{new Date(a.CreatedAt).toLocaleString()}</div>
            </div>
            <button onClick={() => onAck(a.AlertId)}
                    className="text-[11px] px-2 py-0.5 rounded bg-alec-700 hover:bg-alec-600 text-white whitespace-nowrap">
              Ack
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
